#requires -Version 5.1
[CmdletBinding()]
param(
    [switch] $SelfTest,
    [string] $SecureRoot,
    [string] $BackupId,
    [string] $ManifestSha256,
    [string] $CaFile,
    [string] $CaSha256,
    [string] $SessionPoolerHost,
    [int] $OperationTimeoutSeconds = 1800,
    [int] $MemoryGiB = 4
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$v6Sha = 'CB88F9CD43BA779D431A87C63738C784464F3ABCEA776701B0897C07B49CD975'
$targetKinds = @('schema','extension','table','constraint','routine')
$allKinds = @('schema','extension','table','column','defaultacl','view','policy','constraint','routine','index','trigger')
$catalogKeys = @('catalog') + @($allKinds | ForEach-Object { "catalog:$_" })
$differenceKinds = @('missing','extra','owner','acl_order_only','acl_privileges','acl_representation','version',
    'extension_schema','constraint_definition','routine_definition','relation_properties','unclassified')

function Read-Catalog([string[]] $Lines) {
    $catalog = @{}
    foreach ($line in $Lines) {
        if ($line -cnotmatch '^catalog(?:\||:)') { continue }
        if ($line -cnotmatch '^(catalog(?::[a-z]+)?)\|([0-9]{1,9})\|([0-9a-f]{64})$') { throw 'catalog_contract' }
        $key = $Matches[1]
        if ($key -cnotin $catalogKeys -or $catalog.ContainsKey($key)) { throw 'catalog_contract' }
        $catalog[$key] = [pscustomobject]@{ Count = [int]$Matches[2]; Digest = $Matches[3] }
    }
    if ($catalog.Count -ne $catalogKeys.Count) { throw 'catalog_contract' }
    $sum = ($allKinds | ForEach-Object { $catalog["catalog:$_"].Count } | Measure-Object -Sum).Sum
    if ($catalog['catalog'].Count -ne $sum) { throw 'catalog_contract' }
    return $catalog
}

function Test-CatalogMatch([hashtable] $Historical, [hashtable] $Live) {
    foreach ($key in $catalogKeys) {
        if ($Historical[$key].Count -ne $Live[$key].Count -or $Historical[$key].Digest -cne $Live[$key].Digest) {
            return $false
        }
    }
    return $true
}

function Read-Probe([string] $Payload, [bool] $ExpectFullComparison) {
    $lines = @($Payload.TrimEnd() -split '\r?\n')
    $catalog = Read-Catalog $lines
    $objects = @{}
    foreach ($kind in $targetKinds) { $objects[$kind] = @{} }
    $full = $null
    foreach ($line in $lines) {
        if ($line -cmatch '^catalog(?:\||:)') { continue }
        if ($ExpectFullComparison -and $null -eq $full -and $line -cmatch '^FULL\|([01])$') {
            $full = $Matches[1] -ceq '1'
            continue
        }
        if ($line -cnotmatch '^O\|([a-z]+)(?:\|[0-9a-f]{64}){10}$') { throw 'probe_contract' }
        $cells = $line.Split('|')
        $kind = $cells[1]
        $key = $cells[2]
        if ($kind -cnotin $targetKinds -or $objects[$kind].ContainsKey($key)) { throw 'probe_contract' }
        $objects[$kind][$key] = $cells[3..11]
    }
    foreach ($kind in $targetKinds) {
        if ($objects[$kind].Count -ne $catalog["catalog:$kind"].Count) { throw 'probe_contract' }
    }
    if ($ExpectFullComparison -and $null -eq $full) { throw 'probe_contract' }
    return [pscustomobject]@{ Catalog = $catalog; Objects = $objects; Full = $full }
}

function Compare-Objects($Source, $Restored) {
    $result = @{}
    foreach ($kind in $targetKinds) {
        $counts = [ordered]@{}
        foreach ($class in $differenceKinds) { $counts[$class] = 0 }
        $left = $Source.Objects[$kind]
        $right = $Restored.Objects[$kind]
        foreach ($key in $left.Keys) {
            if (-not $right.ContainsKey($key)) { $counts['missing']++; continue }
            $a = $left[$key]
            $b = $right[$key]
            if ($a[0] -ceq $b[0]) { continue }
            $classified = $false
            $properties = @{ 1 = 'owner'; 5 = 'version'; 6 = 'extension_schema'; 8 = 'relation_properties' }
            if ($kind -ceq 'constraint') { $properties[7] = 'constraint_definition' }
            if ($kind -ceq 'routine') { $properties[7] = 'routine_definition' }
            foreach ($index in $properties.Keys) {
                if ($a[$index] -cne $b[$index]) { $counts[$properties[$index]]++; $classified = $true }
            }
            if ($a[4] -cne $b[4]) {
                $counts['acl_privileges']++
                $classified = $true
            }
            elseif ($a[2] -cne $b[2]) {
                if ($a[3] -ceq $b[3]) { $counts['acl_order_only']++ }
                else { $counts['acl_representation']++ }
                $classified = $true
            }
            if (-not $classified) { $counts['unclassified']++ }
        }
        foreach ($key in $right.Keys) {
            if (-not $left.ContainsKey($key)) { $counts['extra']++ }
        }
        # Exact v6 equality always wins over inferred similarity.
        $same = $Source.Catalog["catalog:$kind"].Digest -ceq $Restored.Catalog["catalog:$kind"].Digest
        $sum = ($counts.Values | Measure-Object -Sum).Sum
        if ($same -ne ($sum -eq 0)) { throw 'probe_contract' }
        $result[$kind] = $counts
    }
    return $result
}

function New-ProtectedInput([string] $Key,[Security.SecureString] $Password) {
    $value = New-Object Security.SecureString
    try {
        foreach ($char in $Key.ToCharArray()) { $value.AppendChar($char) }
        if ($null -ne $Password) {
            $value.AppendChar(':')
            $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
            try {
                for ($i = 0; $i -lt $Password.Length; $i++) {
                    $value.AppendChar([char][Runtime.InteropServices.Marshal]::ReadInt16($pointer,2*$i))
                }
            }
            finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        }
        $value.MakeReadOnly()
        return $value
    }
    catch { $value.Dispose(); throw }
}

$stage = 'pinned_v6'
try {
    $v6Path = Join-Path $PSScriptRoot 'staging-backup-recovery-v6.ps1'
    $bytes = [IO.File]::ReadAllBytes($v6Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','') }
    finally { $sha.Dispose() }
    if ($actual -cne $v6Sha) { throw 'pinned_v6' }
    $v6 = [Text.Encoding]::UTF8.GetString($bytes)
    $tokens = $null
    $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput($v6,[ref]$tokens,[ref]$parseErrors)
    if ($parseErrors.Count) { throw 'pinned_v6' }
    $statements = @($ast.EndBlock.Statements)
    $main = $statements[-1]
    if ($main -isnot [Management.Automation.Language.TryStatementAst]) { throw 'pinned_v6' }
    # Import only definitions and initializers from the exact verified bytes.
    # Never execute the v6 dispatcher or its Backup arm.
    $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
    $definitions = @($statements[0..($statements.Count-2)] | Where-Object {
        $_.Extent.Text -cnotmatch '^\$repo\s*='
    } | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine
    . ([ScriptBlock]::Create($definitions))

    $stage = 'arguments'
    if ($OperationTimeoutSeconds -lt 60 -or $OperationTimeoutSeconds -gt 7200 -or
        $MemoryGiB -lt 2 -or $MemoryGiB -gt 24) { throw 'arguments' }
    if (-not $SelfTest -and ($BackupId -cnotmatch '^atlas-staging-[0-9a-f]{32}$' -or
        $ManifestSha256 -cnotmatch '^[a-fA-F0-9]{64}$' -or $CaSha256 -cnotmatch '^[a-fA-F0-9]{64}$' -or
        ($SessionPoolerHost -and $SessionPoolerHost -cnotmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$') -or
        -not $SecureRoot -or -not $CaFile)) { throw 'arguments' }

    $stage = 'catalog_contract'
    $settingsEnd = $summarySql.IndexOf('WITH r AS (')
    $objectsStart = $summarySql.IndexOf('WITH objects AS (')
    $objectsEnd = $summarySql.IndexOf(' , catalog_kinds(kind)')
    $catalogSelect = "SELECT k || '|' || n || '|' || digest FROM catalog_digests ORDER BY k COLLATE ""C"";"
    $selectStart = $summarySql.IndexOf($catalogSelect)
    if ($settingsEnd -lt 1 -or $objectsStart -le $settingsEnd -or $objectsEnd -le $objectsStart -or
        $selectStart -le $objectsEnd) { throw 'catalog_contract' }
    $comparisonSql = $summarySql.Substring(0,$settingsEnd) +
        $summarySql.Substring($objectsStart,$selectStart-$objectsStart) +
        ", exact_categories(line) AS ($($catalogSelect.TrimEnd(';')))" + @'
, picked AS (
 SELECT v, v->>0 AS k,
 CASE v->>0
   WHEN 'schema' THEN jsonb_build_array(v->>1)
   WHEN 'extension' THEN jsonb_build_array(v->>1)
   WHEN 'table' THEN jsonb_build_array(v->>1,v->>2)
   ELSE jsonb_build_array(v->>1,v->>2,v->>3)
 END AS identity,
 CASE v->>0 WHEN 'schema' THEN v->>2 WHEN 'table' THEN v->>4 WHEN 'routine' THEN v->>4 END AS owner_name,
 CASE v->>0 WHEN 'schema' THEN (v->>3)::aclitem[] WHEN 'table' THEN (v->>5)::aclitem[]
   WHEN 'routine' THEN (v->>5)::aclitem[] END AS acl,
 (CASE v->>0 WHEN 'schema' THEN 'n' WHEN 'table' THEN CASE v->>3 WHEN 'S' THEN 's' ELSE 'r' END
   WHEN 'routine' THEN 'f' END)::"char" AS acl_type
 FROM objects WHERE v->>0 IN ('schema','extension','table','constraint','routine')
), fields AS (
 SELECT k, identity, v, owner_name, acl::text AS acl_raw,
   CASE WHEN acl IS NOT NULL THEN ARRAY(SELECT x::text FROM unnest(acl) AS x ORDER BY x::text COLLATE "C") END AS acl_sorted,
   CASE WHEN acl_type IS NOT NULL THEN COALESCE((
     SELECT jsonb_agg(g ORDER BY g::text COLLATE "C")
     FROM (
       SELECT jsonb_build_array(grantor::regrole::text,
         CASE WHEN grantee=0 THEN NULL ELSE grantee::regrole::text END,
         privilege_type,is_grantable) AS g
       FROM aclexplode(COALESCE(acl, acldefault(acl_type, owner_name::regrole)))
     ) AS grants
   ),'[]'::jsonb) END AS acl_privileges,
   CASE k WHEN 'extension' THEN v->>2 END AS version,
   CASE k WHEN 'extension' THEN v->>3 END AS extension_schema,
   CASE k WHEN 'constraint' THEN v->>4 WHEN 'routine' THEN v->>6 END AS definition,
   CASE k WHEN 'table' THEN jsonb_build_array(v->3,v->6,v->7) END AS properties
 FROM picked
), fingerprints(line) AS (
 SELECT 'O|' || k || '|' || (
 SELECT string_agg(encode(sha256(convert_to(
   jsonb_build_array(:'diag_key',k,pos,values_by_field.value)::text,'UTF8')),'hex'),'|' ORDER BY pos)
 FROM jsonb_array_elements(jsonb_build_array(identity,v,owner_name,acl_raw,acl_sorted,acl_privileges,
   version,extension_schema,definition,properties)) WITH ORDINALITY AS values_by_field(value,pos)
 )
 FROM fields
)
SELECT line FROM (
 SELECT line FROM exact_categories
 UNION ALL
 SELECT line FROM fingerprints
) AS diagnostics ORDER BY line COLLATE "C";
'@
    # Both outputs use one statement and the same v6 objects CTE and settings.
    $common += @'

collect_catalog() {
  [[ "$diag_key" =~ ^[0-9a-f]{64}$ ]] || return 10
  {
    printf '%s\n' 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'
    printf '\\set diag_key %s\n' "$diag_key"
    cat <<'ATLAS_CATALOG_SQL'
__COMPARISON_SQL__
ATLAS_CATALOG_SQL
    printf '%s\n' 'COMMIT;'
  } | psql -XqAtw -v ON_ERROR_STOP=1
}
'@.Replace('__COMPARISON_SQL__',$comparisonSql)

    # The metadata container receives only the CA mount. Validate the exact
    # pinned connection prefix even during synthetic runs. Do not run it then.
    $anchor = [regex]::Match($v6,"(?ms)^\s*\x24backupShell = @'\r?\n(?<body>.*?)\r?\ntest ""\x24probe"" = t\r?$")
    if (-not $anchor.Success) { throw 'pinned_v6' }
    $sourceShell = $anchor.Groups['body'].Value + [char]10 + 'test "$probe" = t'
    $sourceShell = $sourceShell.Replace('test -w /backup','test ! -e /backup')
    $sourceShell = $sourceShell.Replace('IFS= read -r PGPASSWORD',@'
IFS= read -r input
diag_key=${input%%:*}
[[ "$input" == "$diag_key:"* && "$diag_key" =~ ^[0-9a-f]{64}$ ]]
PGPASSWORD=${input#*:}
unset input
'@)
    if (-not $sourceShell.Contains('PGSSLMODE=verify-full') -or
        -not $sourceShell.Contains('default_transaction_read_only=on') -or
        -not $sourceShell.Contains('test ! -e /backup') -or
        $sourceShell -cmatch '\b(pg_dump|pg_restore|archive_capture)\b') { throw 'pinned_v6' }

    $stage = 'runtime'
    # Run the pinned Docker and PostgreSQL setup and version guards, stopping
    # before dispatcher output or any mode-specific action.
    $setup = @($main.Body.Statements | Select-Object -First 8)
    if ($setup.Count -ne 8 -or $setup[-1].Extent.Text -cnotmatch '^if \(\$probe\.Trim') { throw 'pinned_v6' }
    . ([ScriptBlock]::Create((@($setup | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine)))

    if ($SelfTest) {
        $stage = 'synthetic'
        Test-ManifestGuards
        $samples = Container 'Synthetic catalog comparison' @'
local_only
export PGUSER=supabase_admin
diag_key="$(printf '1%.0s' {1..64})"
create_cluster /tmp/source supabase_admin
boot /tmp/source
psql -Xqw -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE synthetic_reader;
CREATE ROLE synthetic_writer;
CREATE SCHEMA synthetic;
CREATE SCHEMA synthetic_alternate;
CREATE SCHEMA synthetic_removed;
CREATE EXTENSION hstore WITH SCHEMA synthetic;
CREATE TABLE synthetic.acl_order (n integer);
GRANT SELECT ON synthetic.acl_order TO synthetic_reader;
GRANT SELECT ON synthetic.acl_order TO synthetic_writer;
CREATE TABLE synthetic.acl_grant (n integer);
GRANT SELECT ON synthetic.acl_grant TO synthetic_reader;
CREATE TABLE synthetic.owned (n integer);
CREATE TABLE synthetic.removed (n integer);
CREATE TABLE synthetic.constrained (n integer CONSTRAINT check_n CHECK (n >= 0));
CREATE FUNCTION synthetic.same_name(value integer) RETURNS integer
 LANGUAGE SQL AS $$ SELECT value + 1 $$;
CREATE FUNCTION synthetic.same_name(value text) RETURNS text
 LANGUAGE SQL AS $$ SELECT value $$;
SQL
mkdir -m 700 /tmp/fixture
archive_capture /tmp/fixture
printf 'SOURCE\n'
collect_catalog
pg_ctl -D /tmp/source -m fast -w stop >/dev/null

create_cluster /tmp/target supabase_admin
boot /tmp/target
replay /tmp/fixture
summary >/tmp/clean-summary
cmp -s /tmp/fixture/source-summary.txt /tmp/clean-summary
printf 'CLEAN\nFULL|1\n'
collect_catalog

psql -Xqw -v ON_ERROR_STOP=1 <<'SQL'
REVOKE SELECT ON synthetic.acl_order FROM synthetic_reader, synthetic_writer;
GRANT SELECT ON synthetic.acl_order TO synthetic_writer;
GRANT SELECT ON synthetic.acl_order TO synthetic_reader;
SQL
summary >/tmp/order-summary
if cmp -s /tmp/fixture/source-summary.txt /tmp/order-summary; then exit 11; else test "$?" = 1; fi
printf 'ORDER_ONLY\nFULL|0\n'
collect_catalog

psql -Xqw -v ON_ERROR_STOP=1 <<'SQL'
ALTER SCHEMA synthetic_alternate OWNER TO synthetic_reader;
CREATE SCHEMA synthetic_extra;
DROP SCHEMA synthetic_removed;
DROP EXTENSION hstore;
CREATE EXTENSION hstore WITH SCHEMA synthetic_alternate VERSION '1.7';
ALTER TABLE synthetic.owned OWNER TO synthetic_writer;
GRANT SELECT ON synthetic.acl_grant TO synthetic_reader WITH GRANT OPTION;
ALTER TABLE synthetic.constrained DROP CONSTRAINT check_n;
ALTER TABLE synthetic.constrained ADD CONSTRAINT check_n CHECK (n >= 1);
DROP TABLE synthetic.removed;
CREATE TABLE synthetic.extra (n integer);
CREATE OR REPLACE FUNCTION synthetic.same_name(value integer) RETURNS integer
 LANGUAGE SQL AS $$ SELECT value + 2 $$;
SQL
summary >/tmp/changed-summary
if cmp -s /tmp/fixture/source-summary.txt /tmp/changed-summary; then exit 11; else test "$?" = 1; fi
printf 'CHANGED\nFULL|0\n'
collect_catalog
pg_ctl -D /tmp/target -m fast -w stop >/dev/null
'@ @('--network','none') $null 120
        $sampleMatch = [regex]::Match($samples.Replace([string][char]13,'').TrimEnd(),
            '(?s)\ASOURCE\n(?<source>.*?)\nCLEAN\n(?<clean>.*?)\nORDER_ONLY\n(?<order>.*?)\nCHANGED\n(?<changed>.*)\z')
        if (-not $sampleMatch.Success) { throw 'synthetic' }
        $source = Read-Probe $sampleMatch.Groups['source'].Value $false
        $clean = Read-Probe $sampleMatch.Groups['clean'].Value $true
        $orderOnly = Read-Probe $sampleMatch.Groups['order'].Value $true
        $changed = Read-Probe $sampleMatch.Groups['changed'].Value $true
        if (-not $clean.Full -or $orderOnly.Full -or $changed.Full -or
            -not (Test-CatalogMatch $source.Catalog $clean.Catalog)) {
            throw 'synthetic'
        }
        $cleanStats = Compare-Objects $source $clean
        foreach ($kind in $targetKinds) {
            if (($cleanStats[$kind].Values | Measure-Object -Sum).Sum -ne 0) { throw 'synthetic' }
        }
        $orderStats = Compare-Objects $source $orderOnly
        foreach ($kind in $targetKinds) {
            $expectedOrder = [int]($kind -ceq 'table')
            if (($orderStats[$kind].Values | Measure-Object -Sum).Sum -ne $expectedOrder -or
                $orderStats[$kind]['acl_order_only'] -ne $expectedOrder) { throw 'synthetic' }
        }
        # Even a non-target category drift prevents historical classification.
        $changedHistory = Read-Catalog @($sampleMatch.Groups['source'].Value.TrimEnd() -split '\n')
        $changedHistory['catalog:column'].Digest = '0' * 64
        if (Test-CatalogMatch $changedHistory $source.Catalog) { throw 'synthetic' }
        $stats = Compare-Objects $source $changed
        $expected = @{
            schema = @{ missing=1; extra=1; owner=1 }
            extension = @{ version=1; extension_schema=1 }
            table = @{ missing=1; extra=1; owner=1; acl_order_only=1; acl_privileges=2 }
            constraint = @{ constraint_definition=1 }
            routine = @{ routine_definition=1 }
        }
        foreach ($kind in $expected.Keys) {
            foreach ($class in $expected[$kind].Keys) {
                if ($stats[$kind][$class] -ne $expected[$kind][$class] -or $stats[$kind]['unclassified']) {
                    throw 'synthetic'
                }
            }
        }
        $syntaxProbe = $sampleMatch.Groups['source'].Value + [char]10 + 'INVALID'
        try { $null = Read-Probe $syntaxProbe $false; throw 'synthetic' }
        catch { if ($_.Exception.Message -cne 'probe_contract') { throw } }
        Write-Output 'PASS class=synthetic_original_restore count=1'
        Write-Output 'PASS class=synthetic_historical_gate count=1'
        Write-Output 'PASS class=synthetic_opaque_contract count=1'
        Write-Output 'PASS class=synthetic_catalog_groups count=5'
        Write-Output 'PASS class=synthetic_acl_order_without_acceptance count=1'
        Write-Output 'PASS class=synthetic_manifest_guard count=1'
        return
    }

    $stage = 'storage_or_manifest'
    $root = Get-EncryptedRoot
    Confirm-SensitiveRuntime
    $folder = Join-Path $root $BackupId
    Confirm-Manifest $folder $BackupId $ManifestSha256
    $historical = Read-Catalog @([IO.File]::ReadLines((Join-Path $folder 'source-summary.txt')))
    $stage = 'source_prerequisite'
    $ca = Get-PhysicalPath $CaFile $false
    if ($ca -notmatch '\.(pem|crt|cer)$' -or (Get-FileHash -Algorithm SHA256 -LiteralPath $ca).Hash -ine $CaSha256 -or
        $null -eq $Host.UI -or [Console]::IsInputRedirected -or
        (Read-Host 'Confirm STAGING project reference') -cne $project) { throw 'source_prerequisite' }

    $hostName = "db.$project.supabase.co"
    $login = 'postgres'
    if ($SessionPoolerHost) { $hostName = $SessionPoolerHost; $login = "postgres.$project" }
    $sourceShell = $sourceShell.Replace('__HOST__',$hostName).Replace('__USER__',$login)
    $sourceShell = $sourceShell.Replace('__CA_HASH__',$CaSha256.ToLowerInvariant()) + [char]10 + 'collect_catalog'

    $keyBytes = New-Object 'byte[]' 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($keyBytes); $key = [BitConverter]::ToString($keyBytes).Replace('-','').ToLowerInvariant() }
    finally { $random.Dispose(); [Array]::Clear($keyBytes,0,$keyBytes.Length) }
    $stage = 'source_probe'
    $password = Read-Host 'STAGING postgres password' -AsSecureString
    try {
        if ($password.Length -eq 0) { throw 'source_prerequisite' }
        $secureInput = New-ProtectedInput $key $password
        try {
            $mounts = @('--mount',"type=bind,source=$ca,target=/atlas-ca.crt,readonly")
            if ($SessionPoolerHost) {
                $livePayload = Container 'Metadata source' $sourceShell (@('--network','bridge') + $mounts) $secureInput $OperationTimeoutSeconds
            }
            else {
                $livePayload = Invoke-IPv6Network {
                    param($temporaryNetwork)
                    Container 'Metadata source' $sourceShell (@('--network',$temporaryNetwork) + $mounts) $secureInput $OperationTimeoutSeconds
                }
            }
        }
        finally { $secureInput.Dispose() }
    }
    finally { $password.Dispose() }

    $stage = 'source_contract'
    $live = Read-Probe $livePayload $false
    $stage = 'historical_source_mismatch'
    if (-not (Test-CatalogMatch $historical $live.Catalog)) { throw 'historical_source_mismatch' }
    $stage = 'storage_or_manifest'
    Confirm-Manifest $folder $BackupId $ManifestSha256
    $stage = 'isolated_restore'
    $secureInput = New-ProtectedInput $key $null
    try {
        $restorePayload = Container 'Metadata isolated restore' @'
local_only
private_vm
test ! -w /backup
validate_catalog_summary /backup/source-summary.txt
IFS= read -r diag_key
[[ "$diag_key" =~ ^[0-9a-f]{64}$ ]]
export PGUSER=supabase_admin
create_cluster /tmp/target supabase_admin
boot /tmp/target
replay /backup
summary >/tmp/restored
validate_catalog_summary /tmp/restored
if cmp -s /backup/source-summary.txt /tmp/restored; then
  printf 'FULL|1\n'
else
  test "$?" = 1
  printf 'FULL|0\n'
fi
collect_catalog
pg_ctl -D /tmp/target -m fast -w stop >/dev/null
'@ @('--network','none','--mount',"type=bind,source=$folder,target=/backup,readonly") $secureInput $OperationTimeoutSeconds
    }
    finally { $secureInput.Dispose() }
    $stage = 'storage_or_manifest'
    Confirm-Manifest $folder $BackupId $ManifestSha256
    $stage = 'restore_contract'
    $restored = Read-Probe $restorePayload $true
    $stats = Compare-Objects $live $restored
    if ($restored.Full -and -not (Test-CatalogMatch $historical $restored.Catalog)) { throw 'restore_contract' }
    foreach ($kind in $targetKinds) {
        $pairs = @($differenceKinds | ForEach-Object { "$_=$($stats[$kind][$_])" })
        Write-Output ("DIFF category=$kind " + ($pairs -join ' '))
    }
    if ($restored.Full) { Write-Output 'PASS class=full_v6_match'; return }
    Write-Output 'BLOCKED class=full_v6_mismatch'
    exit 1
}
catch {
    # Do not expose diagnostics, SQL, identifiers, digests or native output.
    Write-Output "BLOCKED class=$stage"
    exit 1
}
