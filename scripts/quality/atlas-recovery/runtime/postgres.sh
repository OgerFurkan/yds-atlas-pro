set -Eeuo pipefail
umask 077
ulimit -c 0
export LC_ALL=C TMPDIR=/tmp
summary_sql() {
  cat /atlas-runtime/summary.sql
  sequence_sql
}
summary() { summary_sql | psql -XqAtw -v ON_ERROR_STOP=1; }
sequence_sql() { cat /atlas-runtime/sequences.sql; }
sequence_state() { sequence_sql | psql -XqAtw -v ON_ERROR_STOP=1; }
ram_only() {
  test "$(cat /sys/fs/cgroup/memory.swap.max)" = 0
  awk '$2=="/tmp" && $3=="tmpfs" && $4~/(^|,)nosuid(,|$)/ && $4~/(^|,)noexec(,|$)/ {ok=1}
       END {exit !ok}' /proc/mounts
  awk '$2=="/" && $4~/(^|,)ro(,|$)/ {ok=1} END {exit !ok}' /proc/mounts
  test "$(ulimit -c)" = 0
  for path in /etc/hosts /etc/hostname /etc/resolv.conf; do test ! -w "$path"; done
}
private_vm() {
  # tmpfs is swappable by default. Do not rely on the location of a WSL swap VHD.
  test -r /proc/swaps || return 1
  awk 'NR==1 && $1=="Filename" {header=1} END {exit !(header && NR==1)}' /proc/swaps || return 1
  local pattern
  pattern="$(cat /proc/sys/kernel/core_pattern)" || return 1
  case "$pattern" in ''|\|*) return 1;; esac
}
local_only() {
  ram_only
  awk 'NR>2 {n++; ok=($1=="lo:")} END {exit !(n==1&&ok)}' /proc/net/dev
  unset PGPORT PGSSLMODE PGSSLROOTCERT PGPASSWORD PGOPTIONS
  export PGHOST=/tmp PGUSER=atlas_restore_owner PGDATABASE=postgres
}
boot() {
  pg_ctl -D "$1" -l /tmp/server.log -o "-c listen_addresses= -c unix_socket_directories=/tmp -c unix_socket_permissions=0700 -c log_min_messages=panic -c log_statement=none" -w -t 60 start >/dev/null
}
create_cluster() {
  initdb -D "$1" -U "$2" --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null 2>/tmp/init.err
}
role_dump() { pg_dumpall -w --roles-only --no-role-passwords --file="$1"; }
normalize_dump() { sed '/^\\restrict /d; /^\\unrestrict /d'; }
metadata_state() {
  pg_dump -w --schema-only --create --lock-wait-timeout=15s | normalize_dump | sha256sum || return
  pg_dumpall -w --globals-only --no-role-passwords | normalize_dump | sha256sum
}

snapshot_cleanup() {
  if [[ -n "${snapshot_input:-}" ]]; then exec {snapshot_input}>&-; unset snapshot_input; fi
  if [[ -n "${snapshot_output:-}" ]]; then exec {snapshot_output}<&-; unset snapshot_output; fi
  if [[ -n "${snapshot_pid:-}" ]]; then
    kill "$snapshot_pid" 2>/dev/null || true
    wait "$snapshot_pid" 2>/dev/null || true
    unset snapshot_pid
  fi
}
archive_cleanup() {
  snapshot_cleanup
  if [[ -n "${archive_guard:-}" ]]; then
    rm -f -- "$archive_guard"/{sequence-before,sequence-from-summary,sequence-after,metadata-before,metadata-after,roles-before,roles-after}
    rmdir -- "$archive_guard"
    unset archive_guard
  fi
}
snapshot_send() {
  # Ignore SIGPIPE for this small write only. A dead exporter is a failed backup.
  (trap '' PIPE; printf '%s\n' "$@" >&"$snapshot_input") 2>/dev/null
}
snapshot_open() {
  local during="${snapshot_seconds:-120}"
  snapshot_app="atlas_backup_snapshot_$BASHPID"
  coproc ATLAS_EXPORTER { PGAPPNAME="$snapshot_app" exec psql -XqAtw -v ON_ERROR_STOP=1; }
  snapshot_pid=$ATLAS_EXPORTER_PID
  exec {snapshot_input}>&"${ATLAS_EXPORTER[1]}" {snapshot_output}<&"${ATLAS_EXPORTER[0]}" || return 81
  snapshot_send "SET transaction_timeout = '${during}s';" \
    "SET idle_in_transaction_session_timeout = '${during}s';" \
    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;' \
    "SELECT CASE WHEN current_setting('transaction_isolation') = 'repeatable read'
      AND current_setting('transaction_read_only') = 'on' THEN pg_export_snapshot() END;" || return 81
  IFS= read -r -t "${snapshot_reply_seconds:-15}" -u "$snapshot_output" snapshot_id || return 81
  [[ "$snapshot_id" =~ ^[[:xdigit:]]+-[[:xdigit:]]+-[0-9]+$ ]] || return 81
}
snapshot_summary() {
  { printf "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET TRANSACTION SNAPSHOT '%s';\n" "$snapshot_id"
    summary_sql
    printf 'COMMIT;\n'
  } | psql -XqAtw -v ON_ERROR_STOP=1
}
snapshot_close() {
  local reply
  snapshot_send 'COMMIT;' "SELECT 'ATLAS_EXPORTER_DONE';" '\q' || return 81
  IFS= read -r -t "${snapshot_reply_seconds:-15}" -u "$snapshot_output" reply || return 81
  [[ "$reply" == ATLAS_EXPORTER_DONE ]] || return 81
  wait "$snapshot_pid" || return 81
  unset snapshot_pid
  snapshot_cleanup
}
archive_begin() {
  archive_guard=$(mktemp -d /tmp/atlas-snapshot.XXXXXXXX) || return
  trap archive_cleanup EXIT
  sequence_state > "$archive_guard/sequence-before" || return 83
  metadata_state > "$archive_guard/metadata-before" || return 82
  role_dump "$1/roles.sql" || return 82
  normalize_dump < "$1/roles.sql" > "$archive_guard/roles-before" || return 82
  snapshot_open
}
archive_finish() {
  local folder="$1"
  snapshot_summary > "$folder/source-summary.txt" || return 81
  validate_catalog_summary "$folder/source-summary.txt" || return 81
  pg_dump -w --snapshot="$snapshot_id" --format=custom --lock-wait-timeout=15s --file="$folder/database.dump" || return 81
  snapshot_close || return 81

  # COPY data and catalog reads are MVCC; nextval/setval are not. Observe the
  # state on both sides of the archive and in the source comparison itself.
  awk '/^seq:/' "$folder/source-summary.txt" > "$archive_guard/sequence-from-summary" || return 83
  sequence_state > "$archive_guard/sequence-after" || return 83
  cmp -s "$archive_guard/sequence-before" "$archive_guard/sequence-from-summary" || return 83
  cmp -s "$archive_guard/sequence-before" "$archive_guard/sequence-after" || return 83
  metadata_state > "$archive_guard/metadata-after" || return 82
  cmp -s "$archive_guard/metadata-before" "$archive_guard/metadata-after" || return 82
  pg_dumpall -w --roles-only --no-role-passwords | normalize_dump > "$archive_guard/roles-after" || return 82
  cmp -s "$archive_guard/roles-before" "$archive_guard/roles-after" || return 82
  # Catch sequence changes during the metadata checks as well.
  sequence_state > "$archive_guard/sequence-after" || return 83
  cmp -s "$archive_guard/sequence-before" "$archive_guard/sequence-after" || return 83
  archive_cleanup
  trap - EXIT
}
# Shared capture path for Backup and the concurrent synthetic regression.
# Only SelfTest supplies a writer hook; Backup uses the default no-op.
archive_capture() {
  local folder="$1" hook="${2:-:}"
  archive_begin "$folder"
  "$hook"
  archive_finish "$folder"
  pg_restore --list "$folder/database.dump" >/dev/null
}
# Catalogue groups are part of the original source summary, not live data fetched later.
validate_catalog_summary() {
  awk -F '|' '
    BEGIN {split("schema extension table column defaultacl view policy constraint routine index trigger",a," "); allowed["catalog"]=1; for(i in a) allowed["catalog:" a[i]]=1}
    $1=="catalog" || $1~/^catalog:/ {
      if (NF!=3 || !($1 in allowed) || $2!~/^[0-9]+$/ || length($3)!=64 || $3!~/^[0-9a-f]+$/) {bad=1; next}
      seen[$1]++; if($1=="catalog") total=$2+0; else subtotal+=$2+0
    }
    END {for(k in allowed) if(seen[k]!=1) bad=1; if(total!=subtotal || bad) exit 1}
  ' "$1"
}
catalog_diff_flags() {
  local source="$1" restored="$2" group a b flags=''
  validate_catalog_summary "$source" || return 2
  validate_catalog_summary "$restored" || return 2
  for group in schema extension table column defaultacl view policy constraint routine index trigger; do
    a=$(awk -F '|' -v k="catalog:$group" '$1==k {print}' "$source") || return 2
    b=$(awk -F '|' -v k="catalog:$group" '$1==k {print}' "$restored") || return 2
    if [[ "$a" = "$b" ]]; then flags="$flags $group=1"; else flags="$flags $group=0"; fi
  done
  printf '%s' "$flags"
}
# The STAGING source bootstrap identity was verified in pg_roles (OID 10).
# Suppress exactly the duplicate CREATE for the already-created bootstrap role,
# only in a private RAM replay file. Every other line is preserved byte-for-byte
# for pg_dumpall's newline-terminated output. No GRANT or ALTER is rewritten.
prepare_bootstrap_roles() {
  local src="$1" dst="$2"
  awk '
    $0 == "CREATE ROLE supabase_admin;" || $0 == "CREATE ROLE \"supabase_admin\";" {
      if (pending) bad=1
      n++; pending=1; next
    }
    {
      if (pending && $0 !~ /^ALTER ROLE (supabase_admin|"supabase_admin") WITH /) bad=1
      if ($0 ~ /^ALTER ROLE (supabase_admin|"supabase_admin") WITH /) {a++; if (!pending) bad=1}
      pending=0; print
    }
    END {if (n != 1 || a != 1 || pending || bad) exit 1}
  ' "$src" > "$dst"
}
assert_bootstrap() {
  test "$(psql -XqAtw -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_catalog.pg_roles WHERE oid=10 AND rolname='supabase_admin' AND rolsuper AND rolname=current_user")" = 1
}
replay() {
  assert_bootstrap
  prepare_bootstrap_roles "$1/roles.sql" /tmp/roles-replay.sql
  psql -Xqw -v ON_ERROR_STOP=1 --single-transaction -f /tmp/roles-replay.sql >/dev/null
  assert_bootstrap
  pg_restore -w --exit-on-error --single-transaction --dbname=postgres "$1/database.dump"
}
