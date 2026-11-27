#requires -Version 5.1
[CmdletBinding()]
param(
    [switch] $SelfTest,
    [string] $SecureRoot,
    [string] $BackupId,
    [string] $ManifestSha256,
    [string] $PlanPath,
    [string] $PlanSha256,
    [int] $OperationTimeoutSeconds = 1800,
    [int] $MemoryGiB = 4
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$stage = 'pinned_tools'
$diagSha = '25CCEBE818D45C181BB40CD873FAD9E67E7AEC5C3D10A7F1F5DFAEE631F8612D'
$dependencyClasses = @('extension_member','extension_dependent','application','unknown')

function Join-Statements($Statements) {
    return (@($Statements | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine)
}

function Read-CompatibilityPlan {
    $path = Get-PhysicalPath $PlanPath $false
    if (-not $path.StartsWith($root.TrimEnd('\') + '\',[StringComparison]::OrdinalIgnoreCase)) {
        throw 'plan'
    }
    Assert-Acl $path $false
    if ((Get-Item -LiteralPath $path).Length -gt 16384) { throw 'plan' }
    $bytes = [IO.File]::ReadAllBytes($path)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-','') }
    finally { $hash.Dispose() }
    if ($actual -ine $PlanSha256) { throw 'plan' }
    $plan = [Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF) | ConvertFrom-Json
    if (@($plan.PSObject.Properties).Count -ne 2 -or
        $plan.applicationSchemas -isnot [array] -or $plan.extensions -isnot [array] -or
        $plan.applicationSchemas.Count -lt 1 -or $plan.extensions.Count -lt 1) { throw 'plan' }
    $schemas = @{}
    foreach ($schema in $plan.applicationSchemas) {
        if ($schema -isnot [string] -or $schema -cnotmatch '^[a-z_][a-z0-9_]{0,62}$' -or
            $schema -cnotmatch '^(?!pg_|information_schema$)' -or $schemas.ContainsKey($schema)) {
            throw 'plan'
        }
        $schemas[$schema] = $true
    }
    $records = @{}
    foreach ($item in $plan.extensions) {
        if (@($item.PSObject.Properties).Count -ne 4 -or
            $item.name -isnot [string] -or $item.name -cnotmatch '^[a-z_][a-z0-9_-]{0,62}$' -or
            $item.schema -isnot [string] -or $item.schema -cnotmatch '^[a-z_][a-z0-9_]{0,62}$' -or
            $item.owner -isnot [string] -or $item.owner -cnotmatch '^[a-z_][a-z0-9_]{0,62}$' -or
            $item.version -isnot [string] -or $item.version -cnotmatch '^[0-9A-Za-z][0-9A-Za-z_.+-]{0,63}$' -or
            $records.ContainsKey($item.name)) { throw 'plan' }
        $records[$item.name] = "$($item.name):$($item.schema):$($item.version):$($item.owner)"
    }
    $planText = ($plan.applicationSchemas -join ',') + '|' + ($records.Values -join ',')
    if ($planText.Length -gt 447) { throw 'plan' }
    return $planText
}

function Read-Dependencies([string] $Payload) {
    $base = @(($Payload.TrimEnd() -split '\r?\n') | Where-Object { $_ -cnotmatch '^D\|' })
    $probe = Read-Probe ($base -join [char]10) $true
    $scopes = @{}
    foreach ($kind in $targetKinds) { $scopes[$kind] = @{} }
    foreach ($line in ($Payload.TrimEnd() -split '\r?\n')) {
        if ($line -cnotmatch '^D\|') { continue }
        if ($line -cnotmatch '^D\|([a-z]+)\|([0-9a-f]{64})\|([a-z_]+)$') { throw 'dependency_contract' }
        $kind = $Matches[1]
        $key = $Matches[2]
        $class = $Matches[3]
        if ($kind -cnotin $targetKinds -or $class -cnotin $dependencyClasses -or
            $scopes[$kind].ContainsKey($key) -or -not $probe.Objects[$kind].ContainsKey($key)) {
            throw 'dependency_contract'
        }
        $scopes[$kind][$key] = $class
    }
    foreach ($kind in $targetKinds) {
        if ($scopes[$kind].Count -ne $probe.Objects[$kind].Count) { throw 'dependency_contract' }
    }
    return [pscustomobject]@{ Probe=$probe; Scopes=$scopes }
}

function Measure-Dependencies($Stock,$Compatible) {
    $out = @{}
    foreach ($kind in $targetKinds) {
        $counts = [ordered]@{}
        foreach ($label in $dependencyClasses) { $counts[$label] = 0 }
        $keys = @($Stock.Probe.Objects[$kind].Keys) + @($Compatible.Probe.Objects[$kind].Keys)
        foreach ($key in ($keys | Sort-Object -Unique)) {
            $before = $Stock.Probe.Objects[$kind][$key]
            $after = $Compatible.Probe.Objects[$kind][$key]
            if ($null -ne $before -and $null -ne $after -and $before[0] -ceq $after[0]) { continue }
            $b = $Stock.Scopes[$kind][$key]
            $a = $Compatible.Scopes[$kind][$key]
            if ($null -eq $a) { $class = $b }
            elseif ($null -eq $b -or $a -ceq $b) { $class = $a }
            else { $class = 'unknown' }
            $counts[$class]++
        }
        $out[$kind] = $counts
    }
    return $out
}

try {
    $diagPath = Join-Path $PSScriptRoot 'staging-backup-v6-catalog-diagnose.ps1'
    $bytes = [IO.File]::ReadAllBytes($diagPath)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-','') }
    finally { $hash.Dispose() }
    if ($actual -cne $diagSha) { throw 'pinned_tools' }
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput([Text.Encoding]::UTF8.GetString($bytes),[ref]$tokens,[ref]$errors)
    if ($errors.Count) { throw 'pinned_tools' }
    $statements = @($ast.EndBlock.Statements)
    $main = $statements[-1]
    if ($main -isnot [Management.Automation.Language.TryStatementAst]) { throw 'pinned_tools' }
    . ([ScriptBlock]::Create((Join-Statements $statements[0..($statements.Count-2)])))
    $init = @()
    foreach ($s in $main.Body.Statements) {
        if ($s.Extent.Text -cmatch '^if \(\$SelfTest\)') { break }
        $init += $s
    }
    if (-not $init.Count -or $init[-1].Extent.Text -cnotmatch '^\.\s*\(') { throw 'pinned_tools' }
    # Import the pinned local setup only. It verifies v6 and does not run the
    # diagnostic dispatcher, the copied source connection, or Backup mode.
    $runSelfTest = [bool]$SelfTest
    $SelfTest = $true
    $compatScriptRoot = $PSScriptRoot
    . ([ScriptBlock]::Create((Join-Statements $init).Replace('$PSScriptRoot','$compatScriptRoot')))
    $SelfTest = $runSelfTest

    $stage = 'dependency_contract'
    # This tool only restores. Omit the unused backup pipeline from the
    # Windows container argument, while keeping all restore and runtime guards.
    $backupOnlyStart = $common.IndexOf('metadata_state() {')
    $backupOnlyEnd = $common.IndexOf('# Catalogue groups are part of the original source summary')
    if ($backupOnlyStart -lt 0 -or $backupOnlyEnd -le $backupOnlyStart) { throw 'pinned_tools' }
    $common = $common.Remove($backupOnlyStart,$backupOnlyEnd-$backupOnlyStart)
    $endSelect = $comparisonSql.IndexOf('SELECT line FROM (')
    if ($endSelect -lt 0) { throw 'dependency_contract' }
    $baseCtes = $comparisonSql.Substring(0,$endSelect).Replace('WITH objects AS (','WITH RECURSIVE objects AS (')
    $compatSql = $baseCtes + @'
, extension_members(classid,objid) AS (
 SELECT d.classid,d.objid FROM pg_depend d
 WHERE d.deptype='e' AND d.refclassid='pg_extension'::regclass
 UNION
 SELECT 'pg_extension'::regclass::oid, e.oid FROM pg_extension e
), reachable(classid,objid) AS (
 SELECT classid,objid FROM extension_members
 UNION
 SELECT d.classid,d.objid FROM pg_depend d
 JOIN reachable r ON r.classid=d.refclassid AND r.objid=d.refobjid
 WHERE d.deptype IN ('e','x','n','a','i','P','S')
), classified AS (
 SELECT k AS kind, identity,
  CASE WHEN address.objid IS NULL THEN 'unknown'
   WHEN EXISTS (SELECT 1 FROM extension_members m WHERE (m.classid,m.objid)=(address.classid,address.objid)) THEN 'extension_member'
   WHEN EXISTS (SELECT 1 FROM reachable r WHERE (r.classid,r.objid)=(address.classid,address.objid)) THEN 'extension_dependent'
   WHEN v->>1 = ANY (string_to_array(:'app_schemas',',')) THEN 'application'
   ELSE 'unknown' END AS scope
 FROM picked
 LEFT JOIN LATERAL (
    SELECT 'pg_namespace'::regclass::oid AS classid, n.oid AS objid
    FROM pg_namespace n WHERE v->>0='schema' AND n.nspname=v->>1
    UNION ALL
    SELECT 'pg_extension'::regclass::oid,e.oid FROM pg_extension e WHERE v->>0='extension' AND e.extname=v->>1
    UNION ALL
    SELECT 'pg_class'::regclass::oid,c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE v->>0='table' AND (n.nspname,c.relname)=(v->>1,v->>2)
    UNION ALL
    SELECT 'pg_constraint'::regclass::oid,q.oid FROM pg_constraint q JOIN pg_class c ON c.oid=q.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE v->>0='constraint' AND (n.nspname,c.relname,q.conname)=(v->>1,v->>2,v->>3)
    UNION ALL
    SELECT 'pg_proc'::regclass::oid,p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE v->>0='routine' AND p.prokind IN ('f','p') AND
          (n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))=(v->>1,v->>2,v->>3)
 ) address ON true
 WHERE v->>0 IN ('schema','extension','table','constraint','routine')
), dependencies(line) AS (
 SELECT 'D|' || kind || '|' || encode(sha256(convert_to(
  jsonb_build_array(:'diag_key',kind,1,identity)::text,'UTF8')),'hex') || '|' || scope
 FROM classified
)
SELECT line FROM (
 SELECT line FROM exact_categories
 UNION ALL SELECT line FROM fingerprints
 UNION ALL SELECT line FROM dependencies
) AS diagnostics ORDER BY line COLLATE "C";
'@
    $format = '    printf ''\\set diag_key %s\n'' "$diag_key"'
    $formatWithSchemas = '    printf ''\\set diag_key %s\n\\set app_schemas %s\n'' "$diag_key" "$app_schemas"'
    if (-not $common.Contains($comparisonSql) -or -not $common.Contains($format)) { throw 'dependency_contract' }
    $common = $common.Replace($comparisonSql,$compatSql).Replace($format,$formatWithSchemas)
    $common += @'

read_plan() {
  local payload
  IFS= read -r payload
  IFS='|' read -r diag_key app_schemas requested remainder <<< "$payload"
  [[ -z "$remainder" && "$diag_key" =~ ^[0-9a-f]{64}$ ]] || return 30
  [[ "$app_schemas" =~ ^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$ ]] || return 30
  IFS=',' read -r -a pins <<< "$requested"
  (( ${#pins[@]} > 0 )) || return 30
  for item in "${pins[@]}"; do
    [[ "$item" =~ ^[a-z_][a-z0-9_-]*:[a-z_][a-z0-9_]*:[0-9A-Za-z][0-9A-Za-z_.+-]*:[a-z_][a-z0-9_]*$ ]] || return 30
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

catalog_result() {
  summary >/tmp/compat-summary
  validate_catalog_summary /tmp/compat-summary
  if cmp -s "$1/source-summary.txt" /tmp/compat-summary; then
    printf 'FULL|1\n'
  else
    test "$?" = 1
    printf 'FULL|0\n'
  fi
  collect_catalog
}

# Every unselected TOC item remains in its original order. Each selected
# extension is rendered in isolation, so COPY data and function bodies are
# never scanned or edited. The only SQL edit is the pinned VERSION option.
prepare_pin_segments() {
  local file="$1" row n s v o id line available slot=0
  local -A selected_versions=() selected_names=() selected_schemas=()
  mkdir -m 700 /tmp/atlas-compat || return 31
  pg_restore -w --list "$file" >/tmp/atlas-compat/toc || return 31
  for row in "${pins[@]}"; do
    IFS=: read -r n s v o <<< "$row"
    available=$(psql -XqAtw -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_available_extension_versions
      WHERE (name,version)=('$n','$v')") || return 31
    [[ "$available" == 1 ]] || return 33
    id=$(awk -v n="$n" '$4=="EXTENSION" && $5=="-" && $6==n {print $1; count++}
         END {if(count!=1) exit 1}' /tmp/atlas-compat/toc) || return 31
    [[ "$id" =~ ^[0-9]+\;$ && -z "${selected_versions[$id]:-}" ]] || return 31
    selected_versions[$id]="$v"
    selected_names[$id]="$n"
    selected_schemas[$id]="$s"
  done
  : >/tmp/atlas-compat/part.0 || return 31
  while IFS= read -r line; do
    if [[ -z "$line" || "$line" == \;* ]]; then continue; fi
    [[ "$line" =~ ^[0-9]+\;\  ]] || return 31
    id="${line%% *}"
    if [[ -n "${selected_versions[$id]:-}" ]]; then
      ((slot+=1))
      printf '%s\n' "$line" >/tmp/atlas-compat/part."$slot" || return 31
      pg_restore -w --exit-on-error -L /tmp/atlas-compat/part."$slot" --file=- "$file" |
        awk -v name="${selected_names[$id]}" -v ns="${selected_schemas[$id]}" -v v="${selected_versions[$id]}" '
          /^CREATE EXTENSION IF NOT EXISTS / {
            expect = "CREATE EXTENSION IF NOT EXISTS "
            rest = substr($0,length(expect)+1)
            if (rest != name " WITH SCHEMA " ns ";" &&
                rest != "\"" name "\" WITH SCHEMA " ns ";" &&
                rest != name " WITH SCHEMA \"" ns "\";" &&
                rest != "\"" name "\" WITH SCHEMA \"" ns "\";") exit 1
            if (++matched != 1) exit 1
            sub(/;$/, " VERSION \047" v "\047;")
          }
          {print}
          END {if(matched!=1) exit 1}' > /tmp/atlas-compat/sql."$slot" || return 31
      ((slot+=1))
      : >/tmp/atlas-compat/part."$slot" || return 31
    else
      printf '%s\n' "$line" >>/tmp/atlas-compat/part."$slot" || return 31
    fi
  done </tmp/atlas-compat/toc
  (( slot == 2 * ${#pins[@]} )) || return 31
  parts_end="$slot"
}

restore_pinned() {
  local folder="$1" part
  assert_bootstrap
  prepare_pin_segments "$folder/database.dump" || return $?
  prepare_bootstrap_roles "$folder/roles.sql" /tmp/roles-replay.sql
  psql -Xqw -v ON_ERROR_STOP=1 --single-transaction -f /tmp/roles-replay.sql >/dev/null
  assert_bootstrap
  (
    for ((part=0;part<=parts_end;part++)); do
      if [[ -f /tmp/atlas-compat/sql."$part" ]]; then
        cat /tmp/atlas-compat/sql."$part" || exit 31
      elif [[ -s /tmp/atlas-compat/part."$part" ]]; then
        pg_restore -w --exit-on-error -L /tmp/atlas-compat/part."$part" --file=- "$folder/database.dump" || exit 31
      fi
    done
  ) > /tmp/atlas-compat/replay.sql || return 31
  psql -Xqw -v ON_ERROR_STOP=1 --single-transaction -f /tmp/atlas-compat/replay.sql >/dev/null
  rm -f -- /tmp/atlas-compat/replay.sql
  verify_versions
}
'@

    if ($SelfTest) {
        $stage = 'synthetic'
        $synthetic = New-ProtectedInput (('1' * 64) + '|synthetic_app|hstore:synthetic_ext:1.7:supabase_admin') $null
        try {
            $payload = Container 'Synthetic pinned extensions' @'
local_only
read_plan
export PGUSER=supabase_admin
create_cluster /tmp/source supabase_admin
boot /tmp/source
psql -Xqw -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE synthetic_definer NOLOGIN;
CREATE ROLE synthetic_allowed NOLOGIN;
CREATE ROLE synthetic_denied NOLOGIN;
CREATE SCHEMA synthetic_app AUTHORIZATION synthetic_definer;
CREATE SCHEMA synthetic_ext;
CREATE SCHEMA synthetic_unknown;
CREATE EXTENSION hstore WITH SCHEMA synthetic_ext VERSION '1.7';
CREATE TABLE synthetic_app.extension_dependency (value synthetic_ext.hstore);
CREATE TABLE synthetic_unknown.unmapped (value integer);
SET ROLE synthetic_definer;
CREATE TABLE synthetic_app.private_values (n integer CONSTRAINT check_value CHECK(n >= 0));
INSERT INTO synthetic_app.private_values VALUES (87);
CREATE FUNCTION synthetic_app.read_value() RETURNS integer SECURITY DEFINER
 SET search_path = pg_catalog, synthetic_app LANGUAGE sql
 AS $$ SELECT max(n) FROM synthetic_app.private_values $$;
REVOKE ALL ON FUNCTION synthetic_app.read_value() FROM PUBLIC;
GRANT USAGE ON SCHEMA synthetic_app TO synthetic_allowed, synthetic_denied;
GRANT EXECUTE ON FUNCTION synthetic_app.read_value() TO synthetic_allowed;
RESET ROLE;
SQL
mkdir -m 700 /tmp/fixture
role_dump /tmp/fixture/roles.sql
pg_dump -w --format=custom --file=/tmp/fixture/database.dump
summary >/tmp/fixture/source-summary.txt
pg_ctl -D /tmp/source -m fast -w stop >/dev/null
create_cluster /tmp/stock supabase_admin
boot /tmp/stock
replay /tmp/fixture
printf 'STOCK\n'
catalog_result /tmp/fixture
pg_ctl -D /tmp/stock -m fast -w stop >/dev/null

create_cluster /tmp/compatible supabase_admin
boot /tmp/compatible
plan_version=("${pins[@]}")
pins=('hstore:synthetic_ext:999.999:supabase_admin')
set +e
(set -e; restore_pinned /tmp/fixture) >/tmp/unavailable.out 2>/tmp/unavailable.err
rc=$?
set -e
test "$rc" = 33
test "$(psql -XqAtw -c "SELECT count(*) FROM pg_roles WHERE rolname='synthetic_definer'")" = 0
test "$(psql -XqAtw -c "SELECT count(*) FROM pg_extension WHERE extname='hstore'")" = 0
rm -f -- /tmp/atlas-compat/toc
rmdir /tmp/atlas-compat
pins=("${plan_version[@]}")
restore_pinned /tmp/fixture

test "$(psql -XqAtw -v ON_ERROR_STOP=1 <<'SQL'
SET ROLE synthetic_allowed;
SELECT synthetic_app.read_value();
SQL
)" = 87
test "$(psql -XqAtw -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*) FROM pg_proc p
CROSS JOIN LATERAL aclexplode(p.proacl) a
WHERE p.oid='synthetic_app.read_value()'::regprocedure AND p.prosecdef
 AND p.proowner='synthetic_definer'::regrole AND a.grantor='synthetic_definer'::regrole
 AND a.grantee='synthetic_allowed'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable;
SQL
)" = 1
test "$(psql -XqAtw -v ON_ERROR_STOP=1 <<'SQL'
SELECT NOT has_function_privilege('synthetic_denied','synthetic_app.read_value()','EXECUTE')
 AND NOT has_table_privilege('synthetic_allowed','synthetic_app.private_values','SELECT')
 AND NOT has_table_privilege('synthetic_denied','synthetic_app.private_values','SELECT');
SQL
)" = t
set +e
psql -Xqw -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate > /tmp/denied.out 2>/tmp/denied.err <<'SQL'
SET ROLE synthetic_denied;
SELECT synthetic_app.read_value();
SQL
denied=$?
psql -Xqw -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate > /tmp/constraint.out 2>/tmp/constraint.err <<'SQL'
INSERT INTO synthetic_app.private_values VALUES(-1);
SQL
constraint=$?
set -e
test "$denied" = 3
grep -q '42501' /tmp/denied.err
test "$constraint" = 3
grep -q '23514' /tmp/constraint.err
printf 'COMPATIBLE\n'
catalog_result /tmp/fixture
psql -Xqw -v ON_ERROR_STOP=1 <<'SQL'
ALTER SCHEMA synthetic_unknown OWNER TO synthetic_denied;
ALTER TABLE synthetic_app.extension_dependency ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_app.private_values DROP CONSTRAINT check_value;
ALTER TABLE synthetic_app.private_values ADD CONSTRAINT check_value CHECK(n > 0);
ALTER FUNCTION synthetic_app.read_value() SET search_path = pg_catalog;
SQL
printf 'CHANGED\n'
catalog_result /tmp/fixture
pg_ctl -D /tmp/compatible -m fast -w stop >/dev/null
'@ @('--network','none') $synthetic 120
        }
        finally { $synthetic.Dispose() }
        $split = [regex]::Match($payload.Replace([string][char]13,'').TrimEnd(),
            '(?s)\ASTOCK\n(?<stock>.*?)\nCOMPATIBLE\n(?<compatible>.*?)\nCHANGED\n(?<changed>.*)\z')
        if (-not $split.Success) { throw 'synthetic' }
        $stock = Read-Dependencies $split.Groups['stock'].Value
        $compatible = Read-Dependencies $split.Groups['compatible'].Value
        $changed = Read-Dependencies $split.Groups['changed'].Value
        if ($stock.Probe.Full -or -not $compatible.Probe.Full -or $changed.Probe.Full) { throw 'synthetic' }
        $changes = Compare-Objects $compatible.Probe $stock.Probe
        $dependencies = Measure-Dependencies $stock $compatible
        $changedDependencies = Measure-Dependencies $changed $compatible
        if ($changes['extension']['version'] -ne 1 -or $dependencies['extension']['extension_member'] -ne 1 -or
            'extension_member' -cnotin @($compatible.Scopes['routine'].Values) -or
            'extension_dependent' -cnotin @($compatible.Scopes['table'].Values) -or
            'application' -cnotin @($compatible.Scopes['table'].Values) -or
            'unknown' -cnotin @($compatible.Scopes['table'].Values) -or
            'application' -cnotin @($compatible.Scopes['schema'].Values) -or
            'application' -cnotin @($compatible.Scopes['constraint'].Values) -or
            $changedDependencies['schema']['unknown'] -ne 1 -or
            $changedDependencies['table']['extension_dependent'] -ne 1 -or
            $changedDependencies['constraint']['application'] -ne 1 -or
            $changedDependencies['routine']['application'] -ne 1) { throw 'synthetic' }
        Write-Output 'PASS class=synthetic_dependency_groups count=5'
        Write-Output 'PASS class=synthetic_pinned_full_v6_match count=1'
        Write-Output 'PASS class=synthetic_extension_unavailable_blocked count=1'
        Write-Output 'PASS class=synthetic_security_definer_and_denial count=1'
        return
    }

    $stage = 'arguments'
    if ($BackupId -cnotmatch '^atlas-staging-[0-9a-f]{32}$' -or
        $ManifestSha256 -cnotmatch '^[a-fA-F0-9]{64}$' -or $PlanSha256 -cnotmatch '^[a-fA-F0-9]{64}$' -or
        -not $SecureRoot -or -not $PlanPath) { throw 'arguments' }
    $stage = 'storage_or_manifest'
    $root = Get-EncryptedRoot
    Confirm-SensitiveRuntime
    $folder = Join-Path $root $BackupId
    Confirm-Manifest $folder $BackupId $ManifestSha256
    $stage = 'plan'
    $planText = Read-CompatibilityPlan
    $keyBytes = New-Object 'byte[]' 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($keyBytes); $key = [BitConverter]::ToString($keyBytes).Replace('-','').ToLowerInvariant() }
    finally { $rng.Dispose(); [Array]::Clear($keyBytes,0,$keyBytes.Length) }
    $securePlan = New-ProtectedInput "$key|$planText" $null
    try {
        $mounts = @('--network','none','--mount',"type=bind,source=$folder,target=/backup,readonly")
        $prefix = @'
local_only
private_vm
test ! -w /backup
validate_catalog_summary /backup/source-summary.txt
read_plan
export PGUSER=supabase_admin
create_cluster /tmp/target supabase_admin
boot /tmp/target
'@ + [char]10
        $suffix = [char]10 + @'
catalog_result /backup
pg_ctl -D /tmp/target -m fast -w stop >/dev/null
'@
        $stage = 'stock_restore'
        $stock = Read-Dependencies (Container 'Stock LOCAL restore' ($prefix + 'replay /backup' + $suffix) $mounts $securePlan $OperationTimeoutSeconds)
        $stage = 'storage_or_manifest'
        Confirm-Manifest $folder $BackupId $ManifestSha256
        $stage = 'extension_compatibility'
        $compatible = Read-Dependencies (Container 'Pinned LOCAL restore' ($prefix + 'restore_pinned /backup' + $suffix) $mounts $securePlan $OperationTimeoutSeconds)
        $stage = 'storage_or_manifest'
        Confirm-Manifest $folder $BackupId $ManifestSha256
    }
    finally { $securePlan.Dispose() }
    # Only an exact offline v6 match is a reliable historical reference.
    $stage = 'full_v6_mismatch'
    if (-not $compatible.Probe.Full) { throw 'full_v6_mismatch' }
    $stage = 'dependency_contract'
    $null = Compare-Objects $compatible.Probe $stock.Probe
    $counts = Measure-Dependencies $stock $compatible
    foreach ($kind in $targetKinds) {
        $pairs = @($dependencyClasses | ForEach-Object { "$_=$($counts[$kind][$_])" })
        Write-Output ("DIFF category=$kind " + ($pairs -join ' '))
    }
    Write-Output 'PASS class=full_v6_match'
}
catch {
    # Do not report identifiers, definitions, fingerprints, or native output.
    if ($stage -ceq 'extension_compatibility') {
        switch -CaseSensitive ($_.Exception.Message) {
            'Pinned LOCAL restore failed (exit 33). Native output withheld.' { $stage = 'extension_version_unavailable' }
            'Pinned LOCAL restore failed (exit 32). Native output withheld.' { $stage = 'extension_identity_mismatch' }
        }
    }
    Write-Output "BLOCKED class=$stage"
    exit 1
}
