# Package checks and PostgreSQL replay for both historical catalog layouts.
artifact_names=(database.dump extension-plan.txt history.jsonl roles.sql source-summary.txt)

digest_file() { sha256sum "$1" | cut -d' ' -f1; }

require_entries() (
  shopt -s dotglob nullglob
  local folder="$1" name
  shift
  local found=("$folder"/*)
  test "$#" -eq "${#found[@]}"
  for name in "$@"; do test -f "$folder/$name"; test ! -L "$folder/$name"; done
)

render_manifest() {
  local folder="$1" name digest
  printf '%s\n' "$format" "package=$package" "source=$source_id"
  if [[ "$format" == atlas-recovery-v8-image-v2 ]]; then
    printf '%s\n' "image_index=$image_index" "image_manifest=$image_manifest" "image_platform=$image_platform"
  fi
  for name in "${artifact_names[@]}"; do
    test -s "$folder/$name"
    digest=$(digest_file "$folder/$name")
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]]
    printf '%s  %s\n' "$digest" "$name"
  done
}

catalog_history() {
  local snapshot="${1:-}"
  {
    printf '%s\n' 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'
    if [[ -n "$snapshot" ]]; then
      [[ "$snapshot" =~ ^[[:xdigit:]]+-[[:xdigit:]]+-[0-9]+$ ]] || exit 81
      printf "SET TRANSACTION SNAPSHOT '%s';\n" "$snapshot"
    fi
    if [[ "$layout" == legacy ]]; then
      cat /atlas-runtime/history-legacy.sql
    else
      cat /atlas-runtime/history.sql
    fi
    printf '%s\n' 'COMMIT;'
  } | psql -XqAtw -v ON_ERROR_STOP=1
}

derive_plan() {
  if [[ "$layout" == legacy ]]; then
    # Pre-existing archives encode plan rows with no version header.
    awk -F '|' '$1=="P" && NF==2 {print $2; n++} END {if (!n) exit 1}' "$1"
  else
    catalog_plan "$1"
  fi
}

capture_package() {
  local folder="$1" hook="${2:-:}" evidence name
  require_entries "$folder" "${artifact_names[@]}"
  for name in "${artifact_names[@]}"; do test ! -s "$folder/$name"; done
  evidence=$(mktemp -d /tmp/atlas-capture.XXXXXXXX)
  summary > "$evidence/summary.before"
  catalog_history > "$evidence/history.before"
  archive_begin "$folder" || return
  "$hook" || return
  catalog_history "$snapshot_id" > "$folder/history.jsonl" || return 81
  archive_finish "$folder" || return
  summary > "$evidence/summary.after"
  catalog_history > "$evidence/history.after"
  cmp -s "$evidence/summary.before" "$folder/source-summary.txt" || return 84
  cmp -s "$evidence/summary.after" "$folder/source-summary.txt" || return 84
  cmp -s "$evidence/history.before" "$folder/history.jsonl" || return 84
  cmp -s "$evidence/history.after" "$folder/history.jsonl" || return 84
  derive_plan "$folder/history.jsonl" > "$folder/extension-plan.txt"
  pg_restore --list "$folder/database.dump" >/dev/null
  render_manifest "$folder" > "$evidence/manifest"
  printf 'SOURCE|%s|%s\n' "$(digest_file "$evidence/history.before")" "$(digest_file "$evidence/manifest")"
}

load_plan() {
  local plan="$1" row
  pins=()
  if [[ "$layout" == general ]]; then
    IFS= read -r row < "$plan"
    test "$row" = atlas-v8-extension-plan-v2
    while IFS= read -r row; do pins+=("$row"); done < <(tail -n +2 "$plan")
  else
    mapfile -t pins < "$plan"
  fi
  for row in "${pins[@]}"; do
    [[ "$row" =~ ^[a-z_][a-z0-9_-]*:[a-z_][a-z0-9_]*:[0-9A-Za-z][0-9A-Za-z_.+-]*:(postgres|supabase_admin)$ ]] || return 34
  done
}

replay_extensions() {
  local folder="$1" row n s v o ext_id line id batch=0 slot file
  local -A extensions=() named=() selected=()
  local restore_dir
  restore_dir=$(mktemp -d /tmp/atlas-replay.XXXXXXXX)
  assert_bootstrap
  pg_restore -w --list "$folder/database.dump" > "$restore_dir/toc"
  for row in "${pins[@]}"; do
    IFS=: read -r n s v o <<< "$row"
    [[ -z "${named[$n]:-}" ]] || return 31
    named["$n"]=1
    ext_id=$(awk -v n="$n" '$4=="EXTENSION" && $5=="-" && $6==n {print $1; count++}
      END {if(count!=1) exit 1}' "$restore_dir/toc") || return 31
    [[ "$ext_id" =~ ^[0-9]+\;$ && -z "${extensions[$ext_id]:-}" ]] || return 31
    extensions["$ext_id"]="$row"
  done
  # Group ordinary TOC entries unchanged. The extension entry itself is
  # supplied from the independently validated catalog, in its original slot.
  : > "$restore_dir/list.0"
  while IFS= read -r line; do
    if [[ -z "$line" || "$line" == \;* ]]; then continue; fi
    [[ "$line" =~ ^[0-9]+\;\  ]] || return 31
    id="${line%% *}"
    if [[ -n "${extensions[$id]:-}" ]]; then
      ((batch+=1))
      selected["$batch"]="${extensions[$id]}"
      ((batch+=1))
      : > "$restore_dir/list.$batch"
    else
      printf '%s\n' "$line" >> "$restore_dir/list.$batch"
    fi
  done < "$restore_dir/toc"
  test "$batch" -eq "$((2 * ${#pins[@]}))"
  prepare_bootstrap_roles "$folder/roles.sql" /tmp/roles-replay.sql
  psql -Xqw -v ON_ERROR_STOP=1 --single-transaction -f /tmp/roles-replay.sql >/dev/null
  assert_bootstrap
  check_extension_roles || return
  (
    for ((slot=0;slot<=batch;slot++)); do
      if [[ -n "${selected[$slot]:-}" ]]; then
        IFS=: read -r n s v o <<< "${selected[$slot]}"
        # load_plan restricted every interpolated identifier and version.
        printf 'SET LOCAL ROLE "%s";\nCREATE EXTENSION "%s" WITH SCHEMA "%s" VERSION '\''%s'\'';\nRESET ROLE;\n' "$o" "$n" "$s" "$v" || exit 31
      else
        file="$restore_dir/list.$slot"
        if [[ -s "$file" ]]; then
          pg_restore -w --exit-on-error -L "$file" --file=- "$folder/database.dump" || exit 31
        fi
      fi
    done
  ) > "$restore_dir/replay.sql" || return 31
  psql -Xqw -v ON_ERROR_STOP=1 --single-transaction -f "$restore_dir/replay.sql" >/dev/null
  verify_versions
}

restore_package() {
  local folder="$1" manifest="$2" history="$3" start elapsed bootstrap
  [[ "$manifest" =~ ^[0-9a-f]{64}$ && "$history" =~ ^[0-9a-f]{64}$ ]]
  require_entries "$folder" "${artifact_names[@]}" manifest.txt
  test "$(digest_file "$folder/manifest.txt")" = "$manifest"
  test "$(digest_file "$folder/history.jsonl")" = "$history"
  render_manifest "$folder" > /tmp/atlas-expected-manifest
  cmp -s /tmp/atlas-expected-manifest "$folder/manifest.txt"
  derive_plan "$folder/history.jsonl" > /tmp/atlas-checked-plan
  cmp -s /tmp/atlas-checked-plan "$folder/extension-plan.txt"
  validate_catalog_summary "$folder/source-summary.txt"
  load_plan /tmp/atlas-checked-plan

  create_cluster /tmp/target supabase_admin
  boot /tmp/target
  catalog_history >/tmp/atlas-bootstrap-history
  bootstrap=$(grep '^E|\["plpgsql",' /tmp/atlas-bootstrap-history)
  test "$bootstrap" = "$(grep '^E|\["plpgsql",' "$folder/history.jsonl")"
  start=$(awk '{print int($1*1000)}' /proc/uptime)
  if (( ${#pins[@]} )); then replay_extensions "$folder"; else replay "$folder"; fi
  summary >/tmp/atlas-restored-summary
  catalog_history >/tmp/atlas-restored-history
  validate_catalog_summary /tmp/atlas-restored-summary
  cmp -s "$folder/source-summary.txt" /tmp/atlas-restored-summary
  cmp -s "$folder/history.jsonl" /tmp/atlas-restored-history
  render_manifest "$folder" > /tmp/atlas-final-manifest
  cmp -s /tmp/atlas-expected-manifest /tmp/atlas-final-manifest

  elapsed=$(( $(awk '{print int($1*1000)}' /proc/uptime) - start ))
  if [[ "$(psql -XqAtw -v ON_ERROR_STOP=1 -c "SELECT to_regclass('auth.users') IS NOT NULL")" == t ]]; then
    [[ "$phase" == deletion-rehearsal && "$handoff" == 0 ]] || return 91
    apply_synthetic_deletion_gate
    apply_synthetic_deletion_gate
  elif [[ "$phase" == deletion-rehearsal ]]; then
    return 91
  fi
  if [[ "$layout" == legacy ]]; then legacy_assertions; fi
  if [[ "$layout" == general && "$phase" == compatibility ]]; then check_general_target; fi
  pg_ctl -D /tmp/target -m fast -w stop >/dev/null
  if [[ "$handoff" == 1 ]]; then postgrest_handoff; fi
  printf 'PASS|full_v6_history_acl|%s\n' "$elapsed"
}

catalog_plan() {
  # Every planned extension must match a recorded version, schema and owner.
  awk -F'|' '
    BEGIN { print "atlas-v8-extension-plan-v2" }
    $0 !~ /^[EOAMDTPX]\|/ {bad=1}
    index($0,"O|")==1 && $0 ~ /"unknown", [0-9]+\]$/ {bad=1}
    index($0,"T|")==1 && $0 ~ /"unknown"\]$/ {bad=1}
    index($0,"E|")==1 {
      if ($0 !~ /^E\|\["[a-z_][a-z0-9_-]*", "[a-z_][a-z0-9_]*", "[0-9A-Za-z][0-9A-Za-z_.+-]*", "(supabase_admin|postgres)"\]$/) {
        bad=1; next
      }
      name=$2
      sub(/^\["/,"",name); sub(/"\]$/,"",name); gsub(/", "/,":",name)
      if (available[name]++ || (name~/^plpgsql:/ && name!~/^plpgsql:pg_catalog:[^:]+:supabase_admin$/)) bad=1
      if (name~/^plpgsql:pg_catalog:/) bootstrap++
      else ext++
    }
    index($0,"P|")==1 {
      n=split($2,plan,":")
      if(NF!=2 || n!=4 || plan[1]!~/^[a-z_][a-z0-9_-]*$/ || plan[1]=="plpgsql" ||
         plan[2]!~/^[a-z_][a-z0-9_]*$/ || plan[3]!~/^[0-9A-Za-z][0-9A-Za-z_.+-]*$/ ||
         (plan[4]!="supabase_admin" && plan[4]!="postgres") || seen[plan[1]]++) bad=1
      else { print $2; required[$2]=1; pinned++ }
    }
    END {
      for (p in required) if (available[p]!=1) bad=1
      if (bad || bootstrap!=1 || ext!=pinned) exit 1
    }
  ' "$1"
}

check_extension_roles() {
  local row n s v o result
  for row in "${pins[@]}"; do
    [[ "$row" =~ ^[a-z_][a-z0-9_-]*:[a-z_][a-z0-9_]*:[0-9A-Za-z][0-9A-Za-z_.+-]*:(postgres|supabase_admin)$ ]] || return 34
    IFS=: read -r n s v o <<< "$row"
    result=$(psql -XqAtw -v ON_ERROR_STOP=1 -c "SELECT CASE WHEN r.oid IS NULL THEN 'missing_role'
      WHEN NOT r.rolsuper AND e.superuser AND NOT e.trusted THEN 'privilege_required'
      ELSE 'ok' END FROM pg_available_extension_versions e LEFT JOIN pg_roles r ON r.rolname='$o'
      WHERE e.name='$n' AND e.version='$v'") || return 31
    case "$result" in
      ok) ;;
      '') return 33 ;;
      *) return 34 ;;
    esac
  done
}

verify_versions() {
  local row n s v o
  for row in "${pins[@]}"; do
    IFS=: read -r n s v o <<< "$row"
    test "$(psql -XqAtw -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_extension e
      JOIN pg_namespace n ON n.oid=e.extnamespace JOIN pg_roles r ON r.oid=e.extowner
      WHERE (e.extname,n.nspname,e.extversion,r.rolname)=('$n','$s','$v','$o')")" = 1 || return 32
  done
}
