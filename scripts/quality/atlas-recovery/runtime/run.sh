# Entrypoint arguments come from the verified, non-secret host config.
source /atlas-runtime/postgres.sh
source /atlas-runtime/archive.sh
phase="$1" format="$2" image_index="$3" image_manifest="$4" image_platform="$5" handoff="$6"
local_only
private_vm
test ! -w /atlas-runtime
test ! -w /atlas-tests
[[ "$image_index" =~ ^sha256:[0-9a-f]{64}$ && "$image_manifest" =~ ^sha256:[0-9a-f]{64}$ &&
   "$image_platform" == linux/amd64 && "$handoff" =~ ^[01]$ ]]
case "$format" in
  atlas-recovery-v7-synthetic|atlas-recovery-v8|atlas-recovery-v8-image-v2) ;;
  *) exit 1 ;;
esac
export PGUSER=supabase_admin
source /atlas-tests/legacy-checks.sh
source /atlas-tests/regression.sh
layout=legacy

case "$phase" in
  probe)
    for cmd in pg_dump pg_dumpall pg_restore psql; do
      "$cmd" --version | grep 'PostgreSQL) 17\.11$' >/dev/null
    done
    for pair in 'pg_dump --format' 'pg_dump --lock-wait-timeout' 'pg_dump --snapshot' \
      'pg_dumpall --no-role-passwords' 'pg_dumpall --globals-only' 'pg_restore --single-transaction'; do
      read -r cmd flag <<< "$pair"
      "$cmd" --help | grep -F -e "$flag" >/dev/null
    done
    printf 'PASS|probe\n' ;;
  vault-rehearsal)
    test ! -e /backup
    test "$format" = atlas-recovery-v8-image-v2
    test "$handoff" = 0
    run_vault_recovery ;;
  deletion-rehearsal)
    test ! -e /backup
    test "$format" = atlas-recovery-v8-image-v2
    test "$handoff" = 0
    read -r deletion_owner
    [[ "$deletion_owner" =~ ^[0-9a-f]{32}$ ]]
    layout=general
    run_regression ;;
  compatibility)
    test ! -e /backup
    if [[ "$format" == atlas-recovery-v8-image-v2 && "$handoff" == 0 ]]; then layout=general; fi
    run_regression ;;
  create)
    IFS='|' read -r package source_id marker extra
    [[ "$package" =~ ^[0-9a-f]{32}$ && "$source_id" =~ ^synthetic-[0-9a-f]{32}$ && "$marker" == synthetic && -z "$extra" ]]
    test -w /backup
    create_cluster /tmp/source supabase_admin
    boot /tmp/source
    psql -Xqw -v ON_ERROR_STOP=1 -f /atlas-tests/legacy-fixture.sql
    capture_package /backup
    pg_ctl -D /tmp/source -m fast -w stop >/dev/null ;;
  restore)
    IFS='|' read -r package source_id manifest historical extra
    [[ "$package" =~ ^[0-9a-f]{32}$ && "$source_id" =~ ^synthetic-[0-9a-f]{32}$ && -z "$extra" ]]
    test ! -w /backup
    require_entries /backup "${artifact_names[@]}" manifest.txt
    candidate=$(mktemp -d /tmp/atlas-sealed.XXXXXXXX)
    for file in "${artifact_names[@]}" manifest.txt; do cp -- "/backup/$file" "$candidate/$file"; done
    restore_package "$candidate" "$manifest" "$historical" ;;
  *) exit 1 ;;
esac
