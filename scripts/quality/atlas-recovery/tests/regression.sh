expect_status() (
  local expected="$1" actual
  shift
  trap - ERR
  set +e
  (set -e; "$@") >/tmp/prototype-negative.out 2>/tmp/prototype-negative.err
  actual=$?
  set -e
  test "$actual" -eq "$expected"
)

prepare_files() {
  local folder="$1" file
  mkdir -m 700 "$folder"
  for file in "${artifact_names[@]}"; do : > "$folder/$file"; done
}

vault_without_key() {
  expect_status 1 psql -XqAtw -v ON_ERROR_STOP=1 \
    -c "SELECT vault.create_secret('synthetic-fixture', 'atlas-key-probe') IS NOT NULL"
  grep -Fq 'no server secret key defined' /tmp/prototype-negative.err
  test "$(psql -XqAtw -v ON_ERROR_STOP=1 -c 'SELECT count(*) FROM vault.secrets')" = 0
}

mutate_row() { psql -Xqw -v ON_ERROR_STOP=1 -c 'UPDATE prototype_app.words SET score=88 WHERE id=1'; }
mutate_sequence() { psql -Xqw -v ON_ERROR_STOP=1 -c "BEGIN; SELECT nextval('prototype_app.words_id_seq'); ROLLBACK;" >/dev/null; }
mutate_role() { psql -Xqw -v ON_ERROR_STOP=1 -c 'ALTER ROLE prototype_marker CONNECTION LIMIT 3'; }
mutate_schema() { psql -Xqw -v ON_ERROR_STOP=1 -c 'CREATE TABLE prototype_app.late_ddl(n int)'; }

legacy_drift() {
  prepare_files /tmp/v8-dml
  expect_status 84 capture_package /tmp/v8-dml mutate_row
  prepare_files /tmp/v8-sequence
  expect_status 83 capture_package /tmp/v8-sequence mutate_sequence
  prepare_files /tmp/v8-role
  expect_status 82 capture_package /tmp/v8-role mutate_role
  prepare_files /tmp/v8-schema
  expect_status 82 capture_package /tmp/v8-schema mutate_schema
  ! compgen -G '/tmp/atlas-snapshot.*' >/dev/null
  test "$(psql -XqAtw -c "SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'atlas_backup_snapshot_%'")" = 0
}

check_general_source() {
  local folder="$1"
  grep -Eq '^O\|.*auth[.]v8_managed.*"provider_managed"' "$folder/history.jsonl"
  grep -Eq '^O\|.*public[.]v8_application.*"application"' "$folder/history.jsonl"
  grep -Eq '^O\|.*public[.]v8_dependent.*"extension_dependent"' "$folder/history.jsonl"
  grep -Eq '^X\|.*"pgcrypto".*extensions[.]digest.*"postgres"' "$folder/history.jsonl"
  grep -Eq '^A\|.*"extension member", "pgcrypto".*extensions[.]digest.*"v8_reader", "v8_consumer", "EXECUTE", false' "$folder/history.jsonl"
  psql -Xqw -v ON_ERROR_STOP=1 -c 'CREATE TABLE auth.v8_unknown (id int)'
  psql -Xqw -v ON_ERROR_STOP=1 -c "CREATE TYPE auth.v8_unknown_type AS ENUM ('synthetic')"
  catalog_history > /tmp/atlas-unknown-history
  grep -Eq '^O\|.*auth[.]v8_unknown.*"unknown"' /tmp/atlas-unknown-history
  grep -Eq '^O\|.*auth[.]v8_unknown_type.*"unknown"' /tmp/atlas-unknown-history
  expect_status 1 catalog_plan /tmp/atlas-unknown-history
}

check_general_roles() {
  create_cluster /tmp/atlas-negative supabase_admin
  boot /tmp/atlas-negative
  pins=('pgcrypto:extensions:1.3:postgres')
  expect_status 34 check_extension_roles
  pins=('pgcrypto:extensions:999.999:supabase_admin')
  expect_status 33 check_extension_roles
  psql -Xqw -v ON_ERROR_STOP=1 -c 'CREATE ROLE postgres NOLOGIN NOSUPERUSER'
  pins=('pg_stat_statements:extensions:1.11:postgres')
  expect_status 34 check_extension_roles
  pg_ctl -D /tmp/atlas-negative -m fast -w stop >/dev/null
}

check_general_target() {
  test "$(psql -XqAtw -v ON_ERROR_STOP=1 -c "
    SELECT string_agg(e.extname||':'||n.nspname||':'||e.extversion||':'||pg_get_userbyid(e.extowner),',' ORDER BY e.extname)
    FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
    WHERE e.extname IN ('pg_stat_statements','pgcrypto','plpgsql','supabase_vault','uuid-ossp')")" = \
    'pg_stat_statements:extensions:1.11:postgres,pgcrypto:extensions:1.3:postgres,plpgsql:pg_catalog:1.0:supabase_admin,supabase_vault:vault:0.3.2:supabase_admin,uuid-ossp:extensions:1.1:postgres'
  test "$(psql -XqAtw -v ON_ERROR_STOP=1 -c 'TABLE public.v8_application')" = 7
  vault_without_key
  local -a pins=('uuid-ossp:extensions:1.1:supabase_admin')
  expect_status 32 verify_versions
}

reject_incomplete_package() {
  local folder="$1" manifest="$2" history="$3" file
  local bad=/tmp/atlas-incomplete
  mkdir -m 700 "$bad"
  for file in "${artifact_names[@]}"; do
    if [[ "$file" != history.jsonl ]]; then cp -- "$folder/$file" "$bad/$file"; fi
  done
  cp -- "$folder/manifest.txt" "$bad/manifest.txt"
  expect_status 1 restore_package "$bad" "$manifest" "$history"
  cp -- "$folder/history.jsonl" "$bad/history.jsonl"
  printf 'synthetic corruption\n' >> "$bad/database.dump"
  expect_status 1 restore_package "$bad" "$manifest" "$history"
  expect_status 1 restore_package "$folder" "$(printf '0%.0s' {1..64})" "$history"
  test ! -e /tmp/target
}

apply_synthetic_deletion_gate() {
  # No network listeners. Only the disposable two-account fixture can pass this guard.
  [[ "$phase" == deletion-rehearsal && "$layout" == general && "$handoff" == 0 ]] || return 91
  [[ "$deletion_owner" == 11111111111141118111111111111111 ]] || return 91
  psql -Xqw -v ON_ERROR_STOP=1 -v owner="$deletion_owner" <<'SQL'
BEGIN;
DELETE FROM auth.users WHERE id=:'owner'::uuid;
DO $check$ BEGIN
  IF (SELECT count(*) FROM auth.users) <> 1 OR (SELECT count(*) FROM auth.sessions) <> 1
    OR NOT EXISTS (SELECT FROM auth.sessions WHERE user_id='22222222-2222-4222-8222-222222222222')
    OR (SELECT count(*) FROM public.words) <> 1 OR NOT EXISTS (SELECT FROM public.words WHERE id=2 AND score=89)
    OR NOT EXISTS (SELECT FROM public.atlas_lexicon_entries WHERE word_key='measure')
    OR NOT EXISTS (SELECT FROM public.atlas_lexicon_entry_revisions WHERE revision=2)
    OR NOT EXISTS (SELECT FROM public.atlas_lexicon_jobs WHERE status='ready')
    OR NOT EXISTS (SELECT FROM public.atlas_tooltip_queue WHERE status='pending')
  THEN RAISE EXCEPTION 'synthetic deletion replay failed'; END IF;
END $check$;
COMMIT;
SQL
}

run_regression() (
  local step=source_fixture
  exec 3>&1
  trap 'printf "FAIL|%s|%s\n" "$step" "$LINENO" >&3; exit 0' ERR
  exec 2>/tmp/atlas-test.err
  package=12345678123456781234567812345678
  source_id=synthetic-12345678123456781234567812345678
  local folder=/tmp/atlas-fixture marker history_hash manifest_hash
  create_cluster /tmp/source supabase_admin
  boot /tmp/source
  psql -Xqw -v ON_ERROR_STOP=1 -f "/atlas-tests/$layout-fixture.sql"
  if [[ "$layout" == general ]]; then vault_without_key; fi
  if [[ "$phase" == deletion-rehearsal ]]; then psql -Xqw -v ON_ERROR_STOP=1 -f /atlas-tests/deletion-fixture.sql; fi
  step=capture
  prepare_files "$folder"
  capture_package "$folder" >/tmp/atlas-capture-proof
  IFS='|' read -r marker history_hash manifest_hash < /tmp/atlas-capture-proof
  test "$marker" = SOURCE
  render_manifest "$folder" > "$folder/manifest.txt"
  step=negative
  reject_incomplete_package "$folder" "$manifest_hash" "$history_hash"
  if [[ "$layout" == general ]]; then check_general_source "$folder"; else legacy_drift; fi
  if [[ "$phase" == deletion-rehearsal ]]; then apply_synthetic_deletion_gate; fi
  pg_ctl -D /tmp/source -m fast -w stop >/dev/null
  if [[ "$layout" == general ]]; then check_general_roles; fi
  step=restore
  restore_package "$folder" "$manifest_hash" "$history_hash" >/tmp/atlas-restore-proof
  grep -Eq '^PASS\|full_v6_history_acl\|[0-9]{1,9}$' /tmp/atlas-restore-proof
  printf 'PASS|%s\n' "$layout"
)

# Both clusters and both synthetic keys live only in this container's tmpfs.
run_vault_recovery() {
  umask 077
  local keydir
  keydir=$(mktemp -d /tmp/atlas-vault.XXXXXXXX)
  for key in original wrong; do
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$keydir/$key"
    test "$(wc -c < "$keydir/$key")" -eq 64
  done
  ! cmp -s "$keydir/original" "$keydir/wrong"
  cp "$keydir/original" /tmp/atlas-vault-selected
  vault_boot() {
    pg_ctl -D "$1" -l "$keydir/server.log" -o "-c listen_addresses= -c unix_socket_directories=/tmp -c unix_socket_permissions=0700 -c log_min_messages=panic -c shared_preload_libraries=supabase_vault -c vault.getkey_script=/atlas-runtime/vault-getkey.sh" -w -t 30 start >/dev/null
  }
  vault_expect_plain() {
    psql -XqAtw -v ON_ERROR_STOP=1 -c "SELECT decrypted_secret = 'synthetic-vault-fixture' FROM vault.decrypted_secrets WHERE name = 'atlas-probe'"
  }
  vault_cipher() {
    psql -XqAtw -v ON_ERROR_STOP=1 -c "SELECT encode(sha256(convert_to(secret,'UTF8')),'hex') FROM vault.secrets WHERE name = 'atlas-probe'"
  }
  create_cluster "$keydir/source" supabase_admin
  vault_boot "$keydir/source"
  psql -Xqw -v ON_ERROR_STOP=1 -c "CREATE SCHEMA vault; CREATE EXTENSION supabase_vault WITH SCHEMA vault VERSION '0.3.2'; SELECT vault.create_secret('synthetic-vault-fixture','atlas-probe');" >/dev/null
  test "$(vault_expect_plain)" = t
  local cipher
  cipher=$(vault_cipher)
  [[ "$cipher" =~ ^[0-9a-f]{64}$ ]]
  test "$(psql -XqAtw -v ON_ERROR_STOP=1 -c "SELECT secret <> 'synthetic-vault-fixture' FROM vault.secrets WHERE name = 'atlas-probe'")" = t
  pg_dump -w --format=custom --lock-wait-timeout=15s --file="$keydir/archive.dump"
  pg_ctl -D "$keydir/source" -m fast -w stop >/dev/null
  create_cluster "$keydir/target" supabase_admin
  cp "$keydir/wrong" /tmp/atlas-vault-selected
  vault_boot "$keydir/target"
  pg_restore -w --exit-on-error --single-transaction -d postgres "$keydir/archive.dump"
  test "$(vault_cipher)" = "$cipher"
  expect_status 1 vault_expect_plain
  pg_ctl -D "$keydir/target" -m fast -w stop >/dev/null
  cp "$keydir/original" /tmp/atlas-vault-selected
  vault_boot "$keydir/target"
  test "$(vault_expect_plain)" = t
  pg_ctl -D "$keydir/target" -m fast -w stop >/dev/null
  printf 'PASS|vault\n'
}
