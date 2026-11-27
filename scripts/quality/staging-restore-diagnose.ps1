#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('RestoreDiagnose')][string] $Mode,
    [string] $SecureRoot,
    [ValidatePattern('^atlas-staging-[0-9a-f]{32}$')][string] $BackupId,
    [ValidatePattern('^[a-fA-F0-9]{64}$')][string] $ManifestSha256,
    [ValidateRange(60,7200)][int] $OperationTimeoutSeconds = 1800,
    [ValidateRange(2,24)][int] $MemoryGiB = 4
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$project = 'mxsjocfbsquveeuogspe'
$context = 'desktop-linux'
$imageTag = 'supabase/postgres:17.11.0.018'
$artifacts = @('database.dump','roles.sql','source-summary.txt')
$memory = [int64] $MemoryGiB * 1GB
$script:cleanupUnverified = $false

function Quote-Argument([string] $value) {
    return '"' + [regex]::Replace([regex]::Replace($value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Invoke-Private {
    param([string] $Label, [string] $Executable, [string[]] $Arguments, [Security.SecureString] $Secret,
        [int] $TimeoutSeconds = 20)
    if ($null -ne $Secret -and $Secret.Length -gt 512) { throw 'Password exceeds the secure input limit.' }
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $Executable
    $start.Arguments = ($Arguments | ForEach-Object { Quote-Argument $_ }) -join ' '
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($key in @($start.EnvironmentVariables.Keys)) {
        if ($key -match '^(DOCKER_(HOST|CONTEXT|TLS.*|CERT_PATH)|PG.*|SUPABASE_ACCESS_TOKEN)$') {
            $start.EnvironmentVariables.Remove($key)
        }
    }
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    $started = $false
    try {
        if (-not $process.Start()) { throw "Process start failed: $Label" }
        $started = $true
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        try {
            if ($null -ne $Secret) {
                $characters = New-Object 'char[]' ($Secret.Length + 1)
                $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
                try {
                    for ($i = 0; $i -lt $Secret.Length; $i++) {
                        $char = [char][Runtime.InteropServices.Marshal]::ReadInt16($ptr, 2 * $i)
                        if ($char -in ([char]0), ([char]10), ([char]13)) { throw 'Unsupported password character.' }
                        $characters[$i] = $char
                    }
                    $characters[$Secret.Length] = [char]10
                    $bytes = [Text.Encoding]::UTF8.GetBytes($characters)
                    try { $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length) }
                    finally { [Array]::Clear($bytes, 0, $bytes.Length) }
                }
                finally {
                    [Array]::Clear($characters, 0, $characters.Length)
                    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
                }
            }
        }
        finally { $process.StandardInput.Close() }
        $remaining = [Math]::Max(0, ($TimeoutSeconds * 1000) - [int]$clock.ElapsedMilliseconds)
        if (-not $process.WaitForExit($remaining)) { throw "$Label timed out." }
        $remaining = [Math]::Max(0, ($TimeoutSeconds * 1000) - [int]$clock.ElapsedMilliseconds)
        if (-not [Threading.Tasks.Task]::WaitAll(@($stdout,$stderr), $remaining)) { throw "$Label timed out." }
        $result = $stdout.GetAwaiter().GetResult()
        $diagnostics = $stderr.GetAwaiter().GetResult()
        # Subprocess output may contain SQL, user data, or credentials.
        if ($process.ExitCode -ne 0 -or -not [string]::IsNullOrWhiteSpace($diagnostics)) {
            throw "$Label failed (exit $($process.ExitCode)). Native output withheld."
        }
        return $result
    }
    finally {
        try {
            if ($started -and -not $process.HasExited) {
                try { $process.Kill() }
                catch { if (-not $process.HasExited) { throw } }
                if (-not $process.WaitForExit(5000)) { throw "$Label process could not be stopped." }
            }
        }
        finally { $process.Dispose() }
    }
}
function Docker([string] $Label, [string[]] $Arguments, [Security.SecureString] $Secret, [int] $TimeoutSeconds = 20) {
    Invoke-Private $Label $script:dockerExe (@('--context',$context) + $Arguments) $Secret $TimeoutSeconds
}

function Get-PhysicalPath([string] $Path, [bool] $Directory) {
    if ($Path -notmatch '^[A-Za-z]:\\' -or $Path -match '[,\r\n"]') { throw 'Use a local absolute Windows path.' }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item -is [IO.DirectoryInfo]) -ne $Directory) { throw 'Unexpected path type.' }
    $ancestor = $item
    while ($null -ne $ancestor) {
        if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not allowed.' }
        if ($ancestor -is [IO.DirectoryInfo]) { $ancestor = $ancestor.Parent } else { $ancestor = $ancestor.Directory }
    }
    return $item.FullName
}

function Assert-Acl([string] $Path, [bool] $Root) {
    $acl = Get-Acl -LiteralPath $Path
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $allowed = @($sid,'S-1-5-18','S-1-5-32-544')
    if ($Root -and ((-not $acl.AreAccessRulesProtected) -or
        $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid)) {
        throw 'Secure folder must be owned by this user with ACL inheritance disabled.'
    }
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed) {
            throw 'Secure storage grants access to an additional identity.'
        }
    }
}

function Get-EncryptedRoot {
    if (-not (Test-Path -LiteralPath $SecureRoot -PathType Container)) {
        throw 'The secure backup directory does not exist.'
    }
    $root = Get-PhysicalPath $SecureRoot $true
    foreach ($path in @($repo,$env:OneDrive,$env:OneDriveConsumer,$env:OneDriveCommercial)) {
        if ([string]::IsNullOrWhiteSpace($path)) { continue }
        $base = [IO.Path]::GetFullPath($path).TrimEnd('\')
        if ($root.TrimEnd('\').Equals($base,[StringComparison]::OrdinalIgnoreCase) -or
            $root.StartsWith($base + '\',[StringComparison]::OrdinalIgnoreCase)) {
            throw 'Backup storage must be outside the repository and OneDrive.'
        }
    }
    if ($root.Length -le 3 -or $root -match '(?i)(^|\\)OneDrive(?:[ -][^\\]*)?(\\|$)') {
        throw 'Use a dedicated directory outside OneDrive.'
    }
    Assert-Acl $root $true
    foreach ($drive in (@($root.Substring(0,2),$env:SystemDrive) | Select-Object -Unique)) {
        $disk = [IO.DriveInfo]::new($drive)
        if ($disk.DriveType -ne 'Fixed' -or $disk.DriveFormat -ne 'NTFS') { throw 'Fixed NTFS volumes are required.' }
        try { $volume = Get-BitLockerVolume -MountPoint $drive -ErrorAction Stop }
        catch { throw 'Cannot verify BitLocker for backup and Windows system volumes.' }
        if ($volume.ProtectionStatus.ToString() -ne 'On' -or $volume.VolumeStatus.ToString() -ne 'FullyEncrypted') {
            throw 'Backup and Windows system volumes require active full BitLocker encryption.'
        }
    }
    return $root
}

function Assert-ArtifactDirectory([string] $Folder) {
    $full = Get-PhysicalPath $Folder $true
    Assert-Acl $full $false
    foreach ($item in Get-ChildItem -Force -LiteralPath $full) {
        $null = Get-PhysicalPath $item.FullName $false
        Assert-Acl $item.FullName $false
    }
}

function Confirm-Manifest([string] $Folder, [string] $Id, [string] $ExpectedHash) {
    Assert-ArtifactDirectory $Folder
    $names = @(Get-ChildItem -LiteralPath $Folder -Force | ForEach-Object Name)
    if (Compare-Object ($names | Sort-Object) ((@($artifacts) + 'manifest.json') | Sort-Object)) {
        throw 'Backup file inventory mismatch.'
    }
    if ($ExpectedHash -and
        (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Folder 'manifest.json')).Hash -ine $ExpectedHash) {
        throw 'Manifest SHA-256 does not match the independently recorded value.'
    }
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $Folder 'manifest.json') | ConvertFrom-Json
    if ($manifest.format -ne 4 -or $manifest.consistency -cne 'shared-snapshot-app-writers-paused' -or
        $manifest.project -ne $project -or $manifest.postgres -ne '17.11' -or
        $manifest.image -ne $script:image -or $manifest.scope -ne 'postgres-logical' -or
        $manifest.id -cne $Id -or @($manifest.files).Count -ne $artifacts.Count) {
        throw 'Unexpected backup manifest metadata.'
    }
    foreach ($name in $artifacts) {
        $entry = @($manifest.files | Where-Object { $_.name -ceq $name })
        $path = Join-Path $Folder $name
        if ($entry.Count -ne 1 -or $entry[0].bytes -le 0 -or
            (Get-Item -LiteralPath $path).Length -ne $entry[0].bytes -or
            (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash -cne $entry[0].sha256) {
            throw 'Backup SHA-256 or size verification failed.'
        }
    }
}

function Remove-PendingBackup([string] $Root, [string] $Folder, [string] $Id) {
    $expected = Join-Path $Root ('.pending-' + $Id)
    if ($Id -cnotmatch '^atlas-staging-[0-9a-f]{32}$' -or $Folder -cne $expected) {
        throw 'Temporary cleanup path verification failed.'
    }
    Assert-ArtifactDirectory $Folder
    $items = @(Get-ChildItem -Force -LiteralPath $Folder)
    if (@($items | Where-Object { $_.Name -cnotin (@($artifacts) + 'manifest.json') }).Count -ne 0) {
        throw 'Unexpected file in the temporary backup. Private quarantine retained.'
    }
    foreach ($item in $items) { Remove-Item -LiteralPath $item.FullName }
    # Directory.Delete without recursion fails closed if an unexpected entry appeared.
    [IO.Directory]::Delete($Folder, $false)
}

function Write-Manifest([string] $Folder, [string] $Id) {
    Assert-ArtifactDirectory $Folder
    $files = foreach ($name in $artifacts) {
        $path = Join-Path $Folder $name
        [ordered]@{ name = $name; bytes = (Get-Item -LiteralPath $path).Length
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash }
    }
    $manifest = Join-Path $Folder 'manifest.json'
    [ordered]@{ format = 4; consistency = 'shared-snapshot-app-writers-paused'; id = $Id; project = $project; postgres = '17.11'; image = $script:image
        scope = 'postgres-logical'; createdUtc = [DateTime]::UtcNow.ToString('o'); files = @($files)
    } | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath $manifest
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $manifest).Hash
    Confirm-Manifest $Folder $Id $hash
    return $hash
}

# This is object and data validation within one database. The target is a fresh
# database. Its database-wide owner, ACL, locale and role/database overrides
# are not compared or restored here. Other databases and service settings
# are outside the logical archive.
# psql summaries contain only counts and digests and never reach the terminal.
$summarySql = @'
SET search_path = pg_catalog, public;
SET TIME ZONE 'UTC';
SET datestyle = 'ISO, YMD';
SET intervalstyle = 'postgres';
SET extra_float_digits = 3;
SET bytea_output = 'hex';
WITH r AS (
 SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin,
        rolreplication, rolconnlimit, rolvaliduntil, rolbypassrls, rolconfig
 FROM pg_roles WHERE rolname NOT LIKE 'pg\_%' AND rolname <> 'atlas_restore_owner'
)
SELECT 'roles|' || count(*) || '|' || encode(sha256(convert_to(coalesce(
 string_agg(to_jsonb(r)::text, E'\n' ORDER BY rolname COLLATE "C"), ''), 'UTF8')), 'hex') FROM r;
WITH m AS (
 SELECT CASE WHEN roleid < 16384 AND member < 16384 THEN 'builtin'
             ELSE grantor::regrole::text END AS grantor, roleid::regrole::text AS role,
  member::regrole::text AS member, admin_option, inherit_option, set_option
 FROM pg_auth_members WHERE member::regrole::text <> 'atlas_restore_owner'
)
SELECT 'members|' || count(*) || '|' || encode(sha256(convert_to(coalesce(
 string_agg(to_jsonb(m)::text, E'\n' ORDER BY to_jsonb(m)::text COLLATE "C"), ''), 'UTF8')), 'hex') FROM m;
WITH objects AS (
 SELECT jsonb_build_array('schema', nspname, nspowner::regrole::text, nspacl::text) AS v
 FROM pg_namespace WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'
 UNION ALL
 SELECT jsonb_build_array('extension', extname, extversion, extnamespace::regnamespace::text) FROM pg_extension
 UNION ALL
 SELECT jsonb_build_array('table', n.nspname, c.relname, c.relkind, c.relowner::regrole::text,
  c.relacl::text, c.relrowsecurity, c.relforcerowsecurity)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','S','f')
 UNION ALL
 SELECT jsonb_build_array('column', n.nspname, c.relname, a.attname, format_type(a.atttypid,a.atttypmod),
  a.attnotnull, a.attidentity, a.attgenerated,pg_get_expr(d.adbin,d.adrelid),
  ARRAY(SELECT x::text FROM unnest(a.attacl) AS x ORDER BY x::text COLLATE "C"))
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
  AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT jsonb_build_array('defaultacl',d.defaclrole::regrole::text,n.nspname,d.defaclobjtype,
  ARRAY(SELECT x::text FROM unnest(d.defaclacl) AS x ORDER BY x::text COLLATE "C"))
 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
 UNION ALL
 SELECT jsonb_build_array('view',n.nspname,c.relname,pg_get_viewdef(c.oid,false),
  ARRAY(SELECT x FROM unnest(c.reloptions) AS x ORDER BY x COLLATE "C"))
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('v','m')
 UNION ALL
 SELECT jsonb_build_array('policy',schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check) FROM pg_policies
 UNION ALL
 SELECT jsonb_build_array('constraint',n.nspname,c.relname,x.conname,pg_get_constraintdef(x.oid))
 FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
 UNION ALL
 SELECT jsonb_build_array('routine',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),
  p.proowner::regrole::text,p.proacl::text,pg_get_functiondef(p.oid))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema' AND p.prokind IN ('f','p')
 UNION ALL
 SELECT jsonb_build_array('index',schemaname,tablename,indexname,indexdef)
 FROM pg_indexes WHERE schemaname NOT LIKE 'pg\_%' AND schemaname <> 'information_schema'
 UNION ALL
 SELECT jsonb_build_array('trigger',n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid))
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema' AND NOT t.tgisinternal
)
SELECT 'catalog|' || count(*) || '|' || encode(sha256(convert_to(coalesce(
 string_agg(v::text, E'\n' ORDER BY v::text COLLATE "C"), ''), 'UTF8')), 'hex') FROM objects;
WITH lo AS (
 SELECT oid, lomowner::regrole::text AS owner, lomacl::text AS acl, encode(sha256(lo_get(oid)),'hex') AS digest
 FROM pg_largeobject_metadata
)
SELECT 'largeobjects|' || count(*) || '|' || encode(sha256(convert_to(coalesce(
 string_agg(to_jsonb(lo)::text, E'\n' ORDER BY oid), ''), 'UTF8')), 'hex') FROM lo;
SELECT format($q$SELECT %L || '|' || count(*) || '|' || encode(sha256(convert_to(
 coalesce(string_agg(d, '' ORDER BY d COLLATE "C"), ''), 'UTF8')), 'hex')
 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS d FROM ONLY %I.%I t) rows$q$,
 'table:' || encode(sha256(convert_to(format('%I.%I', n.nspname,c.relname),'UTF8')),'hex'),n.nspname,c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname NOT LIKE 'pg\_%' AND n.nspname<>'information_schema'
 ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"
\gexec
'@

# Sequence values are live even in an imported MVCC snapshot.
$sequenceSql = @'
SELECT format($q$SELECT %L || '|' || last_value || '|' || is_called FROM %I.%I$q$,
 'seq:' || encode(sha256(convert_to(format('%I.%I',n.nspname,c.relname),'UTF8')),'hex'),n.nspname,c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg\_%' AND n.nspname<>'information_schema'
 ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"
\gexec
'@

$common = @'
set -Eeuo pipefail
umask 077
ulimit -c 0
export LC_ALL=C TMPDIR=/tmp
summary_sql() {
  cat <<'SUMMARY_SQL'
__SUMMARY__
SUMMARY_SQL
  sequence_sql
}
summary() { summary_sql | psql -XqAtw -v ON_ERROR_STOP=1; }
sequence_sql() {
  cat <<'SEQUENCE_SQL'
__SEQUENCES__
SEQUENCE_SQL
}
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
replay() {
  psql -Xqw -v ON_ERROR_STOP=1 --single-transaction -f "$1/roles.sql" >/dev/null
  pg_restore -w --exit-on-error --single-transaction --dbname=postgres "$1/database.dump"
}
'@
$common = $common.Replace('__SUMMARY__',$summarySql).Replace('__SEQUENCES__',$sequenceSql)
function Container([string] $Label,[string] $Code,[string[]] $Flags,
    [Security.SecureString] $Secret,[int] $TimeoutSeconds = 60) {
    $name = 'atlas-backup-' + [Guid]::NewGuid().ToString('N')
    $tag = "atlas.backup.owner=$name"
    $args = @('create','-i','--name',$name,'--label',$tag,'--pull','never','--read-only','--log-driver','none',
        '--security-opt','no-new-privileges','--cap-drop','ALL','--user','100:101',
        '--memory',"$memory",'--memory-swap',"$memory",'--tmpfs',"/tmp:rw,nosuid,nodev,noexec,mode=1777,size=$memory")
    $shell = ($common + [char]10 + $Code).Replace([string][char]13,'')
    try {
        $id = (Docker 'Temporary container create' ($args + $Flags +
            @('--entrypoint','/bin/bash',$script:image,'-c',$shell))).Trim()
        if ($id -cnotmatch '^[a-f0-9]{64}$') { throw 'Unexpected temporary container ID.' }
        $details = Docker 'Temporary container inspection' @('container','inspect','--format','{{json .}}',$id) | ConvertFrom-Json
        $hc = $details.HostConfig
        if ($details.Name -cne "/$name" -or $details.Config.Labels.'atlas.backup.owner' -cne $name -or
            $details.Image -cne $script:image -or $details.Config.User -cne '100:101' -or
            $hc.LogConfig.Type -cne 'none' -or $details.LogPath -or -not $hc.ReadonlyRootfs -or $hc.Privileged -or
            $hc.Memory -ne $memory -or $hc.MemorySwap -ne $memory -or $hc.PublishAllPorts -or
            ($null -ne $hc.PortBindings -and @($hc.PortBindings.PSObject.Properties).Count -ne 0) -or
            $hc.NetworkMode -cne $Flags[1] -or -not $hc.Tmpfs.'/tmp') {
            throw 'Temporary container isolation cannot be verified.'
        }
        $binds = @($Flags | Where-Object { $_ -like 'type=bind,*' })
        $mounts = @($details.Mounts | Where-Object { $_.Destination -ne '/tmp' -or $_.Type -ne 'tmpfs' })
        if ($mounts.Count -ne $binds.Count) { throw 'Unexpected temporary container mounts.' }
        foreach ($bind in $binds) {
            if ($bind -notmatch '^type=bind,source=([^,]+),target=(/backup|/atlas-ca\.crt)(,readonly)?$') {
                throw 'Unexpected temporary bind specification.'
            }
            $source = $Matches[1]
            $target = $Matches[2]
            $readOnly = $Matches.ContainsKey(3)
            $mount = @($mounts | Where-Object { $_.Type -ceq 'bind' -and $_.Destination -ceq $target })
            $hostMount = @($hc.Mounts | Where-Object { $_.Type -ceq 'bind' -and $_.Target -ceq $target })
            if ($mount.Count -ne 1 -or $hostMount.Count -ne 1 -or $hostMount[0].Source -cne $source -or
                $mount[0].RW -eq $readOnly) { throw 'Temporary bind mount verification failed.' }
        }
        return Docker $Label @('container','start','--attach','--interactive',$id) $Secret $TimeoutSeconds
    }
    finally {
        # Exact random label plus name check. Never remove containers by prefix, volume or image.
        $script:cleanupUnverified = $true
        $owned = (Docker 'Temporary cleanup lookup' @('container','ls','-aq','--no-trunc','--filter',"label=$tag")).Trim()
        if ($owned) {
            if ($owned -cnotmatch '^[a-f0-9]{64}$') { throw 'Unexpected temporary cleanup result.' }
            $cleanup = Docker 'Temporary cleanup ownership' @('container','inspect','--format',
                '{{.Name}}|{{index .Config.Labels "atlas.backup.owner"}}',$owned)
            if ($cleanup.Trim() -cne "/$name|$name") { throw 'Temporary cleanup ownership verification failed.' }
            $null = Docker 'Temporary container removal' @('container','rm','--force',$owned)
            if ((Docker 'Temporary cleanup verification' @('container','ls','-aq','--filter',"label=$tag")).Trim()) {
                throw 'Temporary container cleanup could not be confirmed.'
            }
        }
        $script:cleanupUnverified = $false
    }
}

# Direct STAGING connections use a dedicated, disposable IPv6 bridge.
# No global daemon settings or existing networks are changed.
function Invoke-IPv6Network([scriptblock] $Body) {
    $networkName = 'atlas-backup-ipv6-' + [Guid]::NewGuid().ToString('N')
    $networkTag = "atlas.backup.network=$networkName"
    $networkId = $null
    try {
        $networkId = (Docker 'Temporary IPv6 network create' @('network','create','--driver','bridge',
            '--ipv6','--label',$networkTag,$networkName)).Trim()
        if ($networkId -cnotmatch '^[a-f0-9]{64}$') { throw 'Unexpected temporary network ID.' }
        $networkDetails = Docker 'Temporary IPv6 network inspection' @('network','inspect','--format','{{json .}}',$networkId) | ConvertFrom-Json
        if ($networkDetails.Id -cne $networkId -or $networkDetails.Name -cne $networkName -or
            $networkDetails.Labels.'atlas.backup.network' -cne $networkName -or
            $networkDetails.Driver -cne 'bridge' -or $networkDetails.Scope -cne 'local' -or
            $networkDetails.EnableIPv6 -ne $true -or $networkDetails.Internal -ne $false -or
            ($null -ne $networkDetails.Containers -and @($networkDetails.Containers.PSObject.Properties).Count -ne 0)) {
            throw 'Temporary IPv6 network verification failed.'
        }
        & $Body $networkName
    }
    finally {
        # Find only this invocation's random label. Also covers an interrupted create response.
        $ownedNetwork = (Docker 'Temporary IPv6 cleanup lookup' @('network','ls','-q','--no-trunc','--filter',"label=$networkTag")).Trim()
        if ($ownedNetwork) {
            if ($ownedNetwork -cnotmatch '^[a-f0-9]{64}$' -or
                ($networkId -and $networkId -cne $ownedNetwork)) {
                throw 'Temporary IPv6 cleanup ID verification failed.'
            }
            $ownedDetails = Docker 'Temporary IPv6 cleanup inspection' @('network','inspect','--format','{{json .}}',$ownedNetwork) | ConvertFrom-Json
            if ($ownedDetails.Id -cne $ownedNetwork -or $ownedDetails.Name -cne $networkName -or
                $ownedDetails.Labels.'atlas.backup.network' -cne $networkName -or
                ($null -ne $ownedDetails.Containers -and @($ownedDetails.Containers.PSObject.Properties).Count -ne 0)) {
                throw 'Temporary IPv6 cleanup ownership or endpoint verification failed.'
            }
            $null = Docker 'Temporary IPv6 network removal' @('network','rm',$ownedNetwork)
        }
        if ((Docker 'Temporary IPv6 cleanup verification' @('network','ls','-q','--filter',"label=$networkTag")).Trim()) {
            throw 'Temporary IPv6 network cleanup could not be confirmed.'
        }
        if ($networkId -cmatch '^[a-f0-9]{64}$' -and
            (Docker 'Temporary IPv6 ID cleanup verification' @('network','ls','-q','--no-trunc','--filter',"id=$networkId")).Trim()) {
            throw 'Temporary IPv6 network ID still exists.'
        }
    }
}

function Confirm-SensitiveRuntime {
    $state = Container 'WSL storage safety probe' @'
local_only
if private_vm; then printf 'SAFE\n'; else printf 'UNVERIFIED\n'; fi
'@ @('--network','none')
    if ($state.Trim() -cne 'SAFE') {
        throw 'WSL swap or piped core dumps prevent verification of private temporary storage.'
    }
}

function Assert-MaintenanceEvidence([bool] $Paused, [string] $EvidenceId) {
    if (-not $Paused -or $EvidenceId -cnotmatch '^[A-Za-z0-9._-]{3,80}$') {
        throw 'Application writer pause and independent maintenance evidence ID are required.'
    }
}

function Test-ManifestGuards {
    # Only these public synthetic fixture bytes ever touch the host test directory.
    $root = Get-PhysicalPath $env:LOCALAPPDATA $true
    $id = 'atlas-staging-' + [Guid]::NewGuid().ToString('N')
    $folder = Join-Path $root ('.pending-' + $id)
    $null = New-Item -Path $folder -ItemType Directory
    try {
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $acl.SetOwner($sid)
        $acl.SetAccessRuleProtection($true, $false)
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $folder -AclObject $acl
        $archive = Join-Path $folder 'database.dump'
        [IO.File]::WriteAllText($archive, 'synthetic archive')
        try {
            Confirm-Manifest $folder $id ('0' * 64)
            throw 'Incomplete synthetic backup was accepted.'
        }
        catch { if ($_.Exception.Message -ne 'Backup file inventory mismatch.') { throw } }
        foreach ($name in @('roles.sql','source-summary.txt')) {
            [IO.File]::WriteAllText((Join-Path $folder $name), 'synthetic metadata')
        }
        $hash = Write-Manifest $folder $id
        $manifestPath = Join-Path $folder 'manifest.json'
        $legacy = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
        $legacy.format = 3
        $legacy | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath $manifestPath
        $legacyHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash
        try {
            Confirm-Manifest $folder $id $legacyHash
            throw 'Legacy synthetic manifest was accepted.'
        }
        catch { if ($_.Exception.Message -ne 'Unexpected backup manifest metadata.') { throw } }
        $hash = Write-Manifest $folder $id
        $bind = Container 'Synthetic read-only bind' @'
local_only
test -s /backup/manifest.json
test ! -w /backup
test ! -w /backup/database.dump
printf 'OK\n'
'@ @('--network','none','--mount',"type=bind,source=$folder,target=/backup,readonly")
        if ($bind.Trim() -cne 'OK') { throw 'Synthetic read-only mount was not verified.' }
        try {
            Confirm-Manifest $folder $id ('0' * 64)
            throw 'Synthetic backup with an incorrect manifest hash was accepted.'
        }
        catch { if ($_.Exception.Message -ne 'Manifest SHA-256 does not match the independently recorded value.') { throw } }
        [IO.File]::WriteAllText($archive, 'synthetic tamper!')
        try {
            Confirm-Manifest $folder $id $hash
            throw 'Corrupted synthetic backup was accepted.'
        }
        catch { if ($_.Exception.Message -ne 'Backup SHA-256 or size verification failed.') { throw } }
    }
    finally { Remove-PendingBackup $root $folder $id }
    if (Test-Path -LiteralPath $folder) { throw 'Synthetic temporary backup cleanup failed.' }
}

try {
    $script:dockerExe = (Get-Command docker.exe -CommandType Application).Source
    if ((Docker 'Docker endpoint' @('context','inspect',$context,'--format','{{.Endpoints.docker.Host}}')).Trim() -cne
        'npipe:////./pipe/dockerDesktopLinuxEngine') { throw 'Docker Desktop local pipe verification failed.' }
    $version = (Docker 'Docker version' @('version','--format','{{.Client.Version}} / {{.Server.Version}}')).Trim()
    $meta = Docker 'Docker local image' @('image','inspect','--format','{{json .}}',$imageTag) | ConvertFrom-Json
    $script:image = $meta.Id
    if ($script:image -notmatch '^sha256:[a-f0-9]{64}$' -or
        ($null -ne $meta.Config.PSObject.Properties['Volumes'] -and $meta.Config.Volumes)) {
        throw 'Unexpected image metadata or image-declared volumes.'
    }
    $probe = Container 'PostgreSQL tool support' @'
local_only
for command in pg_dump pg_dumpall pg_restore psql; do
  "$command" --version | grep 'PostgreSQL) 17\.11$' >/dev/null
done
for pair in 'pg_dump --format' 'pg_dump --lock-wait-timeout' 'pg_dump --snapshot' \
    'pg_dumpall --no-role-passwords' 'pg_dumpall --globals-only' 'pg_restore --single-transaction'; do
  read -r command flag <<< "$pair"
  "$command" --help | grep -F -e "$flag" >/dev/null
done
printf 'OK\n'
'@ @('--network','none')
    if ($probe.Trim() -cne 'OK') { throw 'PostgreSQL tool or isolation verification failed.' }
    Write-Output "Docker $version | PostgreSQL 17.11"

    if (-not $SecureRoot) { throw 'SecureRoot is required.' }
    $root = Get-EncryptedRoot
    Confirm-SensitiveRuntime
    if (-not $BackupId -or -not $ManifestSha256) { throw 'BackupId and independently recorded ManifestSha256 are required.' }
    $folder = Join-Path $root $BackupId
    Confirm-Manifest $folder $BackupId $ManifestSha256
    $result = Container 'Isolated LOCAL restore' @'
local_only
private_vm
test ! -w /backup
# All native output stays inside the already verified private tmpfs.
# Only a closed vocabulary stage, numeric status and fixed classification leave it.
classify_restore_error() {
  local stage="$1" status="$2" code
  if [[ "$status" = 0 ]]; then printf 'stderr_present'; return; fi
  if [[ "$stage" = roles ]]; then
    code=$(awk '/^psql:\/backup\/roles[.]sql:[0-9]+: (ERROR|FATAL):[[:space:]]+[0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z][[:space:]]*$/ {print $NF; exit}' /tmp/diag.err)
    case "$code" in
      42501|42704|42710|0A000|42601|22023|XX000|55000|42P17|25006|28000|2BP01|42P01|42883|23505|22000|22P02) printf 'sqlstate_%s' "$code"; return;;
    esac
  elif [[ "$stage" = archive ]]; then
    if grep -Eq '^pg_restore: error: could not execute query: ERROR:[[:space:]]+permission denied' /tmp/diag.err; then printf 'hint_permission'; return; fi
    if grep -Eq '^pg_restore: error: could not execute query: ERROR:[[:space:]]+extension .* is not available' /tmp/diag.err; then printf 'hint_extension_unavailable'; return; fi
    if grep -Eq '^pg_restore: error: could not execute query: ERROR:[[:space:]]+.*already exists' /tmp/diag.err; then printf 'hint_duplicate'; return; fi
    if grep -Eq '^pg_restore: error: could not execute query: ERROR:[[:space:]]+.*does not exist' /tmp/diag.err; then printf 'hint_missing_object'; return; fi
  elif [[ "$stage" = compare && "$status" = 1 ]]; then
    printf 'summary_mismatch'; return
  fi
  printf 'unknown'
}
run_restore_stage() {
  local stage="$1" output="$2" status classification
  shift 2
  # No conditional invocation of a shell function: keep errexit active inside it.
  set +e
  (set -e; "$@") > "$output" 2>/tmp/diag.err
  status=$?
  set -e
  if [[ "$status" != 0 ]] || grep -q '[^[:space:]]' /tmp/diag.err; then
    classification=$(classify_restore_error "$stage" "$status")
    printf 'DIAG stage=%s exit=%s class=%s\n' "$stage" "$status" "$classification"
    # The host checks the closed result and fails AFTER its existing cleanup.
    exit 0
  fi
}
run_restore_stage init /tmp/diag.out create_cluster /tmp/target atlas_restore_owner
run_restore_stage boot /tmp/diag.out boot /tmp/target
run_restore_stage roles /tmp/diag.out psql -Xqw -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate --single-transaction -f /backup/roles.sql
run_restore_stage archive /tmp/diag.out pg_restore -w --exit-on-error --single-transaction --dbname=postgres /backup/database.dump
run_restore_stage summary /tmp/restored summary
run_restore_stage compare /tmp/diag.out cmp -s /backup/source-summary.txt /tmp/restored
run_restore_stage stop /tmp/diag.out pg_ctl -D /tmp/target -m fast -w stop
printf 'OK\n'
'@ @('--network','none','--mount',"type=bind,source=$folder,target=/backup,readonly") $null $OperationTimeoutSeconds
    # Container has already returned through the original verified cleanup.
    Confirm-Manifest $folder $BackupId $ManifestSha256
    $outcome = $result.Trim()
    if ($outcome -ceq 'OK') {
        Write-Output 'PASS isolated LOCAL restore and source summary comparison. The container and RAM data are disposable.'
        return
    }
    if ($outcome -cmatch '^DIAG stage=(init|boot|roles|archive|summary|compare|stop) exit=([0-9]{1,3}) class=(unknown|stderr_present|summary_mismatch|hint_permission|hint_extension_unavailable|hint_duplicate|hint_missing_object|sqlstate_(42501|42704|42710|0A000|42601|22023|XX000|55000|42P17|25006|28000|2BP01|42P01|42883|23505|22000|22P02))$') {
        Write-Output $outcome
        Write-Output 'BLOCKED: restore diagnostic failed. Backup integrity rechecked. Temporary container cleanup completed.'
        exit 1
    }
    throw 'Unexpected restore diagnostic result.'
}
catch {
    # Never print native errors, SQL, rows, paths or connection values.
    if ($_.Exception.Message -match '^[\p{L}\p{N} .:/()_-]{1,180}$') {
        Write-Output "BLOCKED: $($_.Exception.Message)"
    }
    else { Write-Output 'BLOCKED: local prerequisite or verification failed.' }
    exit 1
}
