legacy_assertions() {

test "$(psql -XqAtw -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*) FROM pg_auth_members WHERE roleid='prototype_marker'::regrole
 AND member='prototype_authenticated'::regrole AND grantor='supabase_admin'::regrole
 AND admin_option AND inherit_option AND NOT set_option;
SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
 WHERE p.oid='prototype_app.read_private()'::regprocedure AND p.prosecdef AND p.proowner='prototype_owner'::regrole
 AND a.grantor='prototype_owner'::regrole AND a.grantee='prototype_allowed'::regrole
 AND a.privilege_type='EXECUTE' AND NOT a.is_grantable;
SQL
)" = $'1\n1'
for n in 1 2; do
  subject="10000000-0000-0000-0000-00000000000$n"
  other="10000000-0000-0000-0000-00000000000$((3 - n))"
  test "$(psql -XqAtw -v ON_ERROR_STOP=1 -v subject="$subject" -v other="$other" <<'SQL'
BEGIN;
SET LOCAL ROLE prototype_authenticated;
SET LOCAL request.jwt.claims TO '{}';
SELECT set_config('request.jwt.claims', json_build_object('sub', :'subject')::text, true) IS NOT NULL;
SELECT count(*)=1 FROM prototype_app.words WHERE owner_id=:'subject';
SELECT count(*)=0 FROM prototype_app.words WHERE owner_id=:'other';
WITH writes AS (UPDATE prototype_app.words SET label='synthetic own' WHERE owner_id=:'subject' RETURNING id)
 SELECT count(*)=1 FROM writes;
WITH writes AS (UPDATE prototype_app.words SET label='synthetic foreign' WHERE owner_id=:'other' RETURNING id)
 SELECT count(*)=0 FROM writes;
ROLLBACK;
SQL
)" = $'t\nt\nt\nt\nt'
done

test "$(psql -XqAtw -v ON_ERROR_STOP=1 -c 'SET ROLE prototype_allowed; SELECT prototype_app.read_private()')" = 87
execute_denied() { printf '%s;\n' "$1" | psql -Xqw -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate; }
expect_status 3 execute_denied 'SET ROLE prototype_denied; SELECT prototype_app.read_private()'
grep -q '42501' /tmp/prototype-negative.err
expect_status 3 execute_denied 'SET ROLE prototype_allowed; SELECT * FROM prototype_app.private'
grep -q '42501' /tmp/prototype-negative.err

test "$(psql -XqAtw -v ON_ERROR_STOP=1 -c "SELECT last_value||'|'||is_called FROM prototype_app.words_id_seq; SELECT count(*) FROM prototype_app.words WHERE touched=1")" = $'2|true\n2'
expect_status 3 execute_denied "UPDATE prototype_app.words SET score=-1 WHERE id=1"
grep -q '23514' /tmp/prototype-negative.err
test "$(psql -XqAtw -v ON_ERROR_STOP=1 -c "BEGIN; UPDATE prototype_app.words SET label='synthetic trigger check' WHERE id=1 RETURNING touched; ROLLBACK;")" = 2

}

postgrest_handoff() {
  # After the full comparison, expose just the fixture login on loopback in
  # this disposable network namespace. The recovery itself used UNIX sockets.
  cat > /tmp/target/pg_hba.conf <<'HBA'
local all all trust
host postgres prototype_authenticator 127.0.0.1/32 trust
host all all 127.0.0.1/32 reject
HBA
  pg_ctl -D /tmp/target -l /tmp/server.log -o \
    "-c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c unix_socket_permissions=0700 -c log_min_messages=panic -c log_statement=none" \
    -w -t 30 start >/dev/null
  : > /tmp/prototype-postgrest-ready
  for ((watch=0;watch<40;watch++)); do
    [[ ! -f /tmp/prototype-postgrest-done ]] || break
    sleep 1
  done
  test -f /tmp/prototype-postgrest-done
  pg_ctl -D /tmp/target -m fast -w stop >/dev/null
}
