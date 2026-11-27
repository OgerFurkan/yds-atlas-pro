#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Compatibility','Acceptance','Initialize','Create','ScheduledSynthetic','VerifyScheduled','Verify','Restore','StagingBackup','StagingRestore')]
    [string] $Mode = 'Compatibility',
    [ValidateSet('ImageV2','LegacyV7','LegacyV8')][string] $FormatName = 'ImageV2',
    [string] $SessionId,
    [string] $PackageId,
    [switch] $WithPostgrest,
    [switch] $WithDeletionLedger,
    [switch] $WithVault,
    [string] $PostgrestSession
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$stage = 'arguments'
$modules = Join-Path $PSScriptRoot 'atlas-recovery'
$entryPath = $PSCommandPath
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$ascii = [Text.Encoding]::ASCII
$script:cleanupUnverified = $false

function Assert-RecoveryFiles {
    if ((Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash -cne $configHash) { throw 'recovery_code' }
    foreach ($item in $config.files.PSObject.Properties) {
        if ((Get-FileHash -LiteralPath (Join-Path $modules $item.Name) -Algorithm SHA256).Hash -cne $item.Value) {
            throw 'recovery_code'
        }
    }
}

function Assert-Clean([string] $Before) {
    Assert-RecoveryFiles
    if ($script:cleanupUnverified -or (Get-DockerInventory) -cne $Before) { throw 'cleanup' }
}

function Invoke-RecoveryChild([string] $Phase) {
    $args = @('-NoProfile','-NonInteractive','-File',$entryPath,'-Mode',$Phase,'-SessionId',$SessionId)
    if ($Phase -ne 'Initialize') { $args += @('-PackageId',$PackageId) }
    Invoke-Private "Recovery child $Phase" (Join-Path $PSHOME 'powershell.exe') $args $null 240
}

function Invoke-PostgrestTest([string] $Kind) {
    $node = (Get-Command node.exe -CommandType Application).Source
    $handoff = [Guid]::NewGuid().ToString('N')
    $apiName = "atlas-recovery-postgrest-$handoff"
    $sessionArg = if ($Kind -eq 'ram') { '-' } else { $SessionId }
    $packageArg = if ($Kind -eq 'ram') { '-' } else { $PackageId }
    try {
        $args = @((Join-Path $modules 'tests/postgrest.mjs'),$entryPath,$sessionArg,$packageArg,$handoff,
            $image.index,$image.manifest,$config.platform,$config.dockerContext,$config.dockerEndpoint,$config.postgrestImage,$Kind)
        Invoke-Private 'Restored database PostgREST test' $node $args $null 280
    }
    finally { Remove-OwnedContainer $apiName 'atlas.prototype.sidecar' $handoff }
}

function Invoke-RamRegression {
    $before = Get-DockerInventory
    try {
        $answer = if ($WithDeletionLedger) {
            $gate = New-SyntheticDeletionGate
            $owner = Confirm-SyntheticDeletionGate $gate
            (Invoke-RecoveryContainer 'deletion-rehearsal' $format $image '' $owner '').Trim()
        } elseif ($WithPostgrest) {
            (Invoke-PostgrestTest 'ram').Trim()
        }
        else {
            (Invoke-RecoveryContainer 'compatibility' $format $image '' '' $PostgrestSession).Trim()
        }
        if ($answer -cmatch '\AFAIL\|(source_fixture|capture|negative|restore)\|[0-9]{1,4}\z') {
            Write-Output $answer
            throw 'compatibility'
        }
        $expected = if ($WithDeletionLedger) { 'PASS|general' } elseif ($WithPostgrest) { 'PASS class=postgrest_recovered_database' }
            elseif ($format.imageEvidence -and -not $PostgrestSession) { 'PASS|general' }
            else { 'PASS|legacy' }
        if ($answer -cne $expected) { throw 'compatibility' }
    }
    finally { Assert-Clean $before }
    if ($WithDeletionLedger) { Write-Output 'PASS class=synthetic_deletion_rehearsal' }
    elseif ($WithPostgrest) { Write-Output $expected }
    elseif ($expected -ceq 'PASS|general') {
        Write-Output 'PASS class=general_compatibility'
        if (-not $WithVault) { Write-Output 'NOT_RUN class=vault_ciphertext_and_key_recovery' }
    }
    else { Write-Output 'PASS class=legacy_compatibility' }
}

try {
    if ($Mode -in @('StagingBackup','StagingRestore')) { $stage = 'staging_locked'; throw $stage }
    if ($WithVault -and ($Mode -ne 'Compatibility' -or $FormatName -ne 'ImageV2' -or
        $WithDeletionLedger -or $WithPostgrest -or $PostgrestSession)) { throw $stage }
    if ($WithDeletionLedger -and ($Mode -ne 'Compatibility' -or $FormatName -ne 'ImageV2' -or $WithPostgrest -or $PostgrestSession)) { throw $stage }
    if ($FormatName -ne 'ImageV2' -and $Mode -notin @('Compatibility','Verify','Restore')) { throw $stage }
    if ($WithPostgrest -and ($Mode -ne 'Compatibility' -or $FormatName -ne 'ImageV2' -or $PostgrestSession)) { throw $stage }
    if ($PostgrestSession -and ($PostgrestSession -cnotmatch '\A[0-9a-f]{32}\z' -or
        $Mode -notin @('Compatibility','Restore') -or $FormatName -ne 'ImageV2')) { throw $stage }
    if ($Mode -eq 'Compatibility') {
        if ($SessionId -or $PackageId) { throw $stage }
    }
    else {
        if ($Mode -eq 'Acceptance' -and -not $SessionId) { $SessionId = [Guid]::NewGuid().ToString('N') }
        if ($Mode -in @('Acceptance','ScheduledSynthetic') -and -not $PackageId) { $PackageId = [Guid]::NewGuid().ToString('N') }
        if ($SessionId -cnotmatch '\A[0-9a-f]{32}\z' -or
            ($Mode -ne 'Initialize' -and $PackageId -cnotmatch '\A[0-9a-f]{32}\z') -or
            ($Mode -eq 'Initialize' -and $PackageId)) { throw $stage }
    }

    $stage = 'recovery_code'
    $configPath = Join-Path $modules 'recovery.config.json'
    $configHash = '94DF7BBD23AD7DA13DC00F96E61BAD951EDDBCCE2529E4A24F03ED81164CB3B4'
    $bytes = [IO.File]::ReadAllBytes($configPath)
    $stream = [IO.MemoryStream]::new($bytes)
    try {
        if ((Get-FileHash -InputStream $stream -Algorithm SHA256).Hash -cne $configHash) { throw 'recovery_code' }
    }
    finally { $stream.Dispose() }
    $config = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    Assert-RecoveryFiles
    . (Join-Path $modules 'security.ps1')
    . (Join-Path $modules 'docker.ps1')
    . (Join-Path $modules 'packages.ps1')
    . (Join-Path $modules 'deletion-decisions.ps1')
    $format = $config.formats.$FormatName
    $image = $config.images.($format.image)
    $files = @($config.artifacts)
    $memory = [int64]$config.memoryGiB * 1GB
    $bundleHashes = (@(foreach ($item in $config.files.PSObject.Properties) {
        if ($item.Name -match '\A(runtime|tests)/[a-z0-9.-]+\z' -and $item.Name -notlike '*.mjs') {
            "$($item.Value.ToLowerInvariant())  /atlas-$($item.Name)"
        }
    }) -join [char]10)

    if ($Mode -ne 'Compatibility') {
        $stage = 'storage_encryption'
        $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw $stage }
        Add-Type -AssemblyName System.Security
        $packageRoot = Join-Path 'D:\' "$($format.rootPrefix)-$SessionId"
        $trustRoot = Join-Path $env:LOCALAPPDATA "$($format.trustPrefix)-$SessionId"
        Assert-EncryptionForCreation
        $sourceId = "synthetic-$SessionId"
        $packagePath = Join-Path $packageRoot "$($format.packagePrefix)-$PackageId"
        $receiptPath = Join-Path $trustRoot "$PackageId.receipt"
        $entropy = $ascii.GetBytes($format.header + '|' + $sourceId)
    }

    $stage = 'runtime'
    Initialize-Docker
    Confirm-Image $image
    $before = Get-DockerInventory
    if ((Invoke-RecoveryContainer 'probe' $format $image '').Trim() -cne 'PASS|probe') { throw 'runtime_probe' }
    Assert-Clean $before
    if ($Mode -eq 'Compatibility') {
        $stage = 'compatibility'
        Invoke-RamRegression
        if ($WithVault) {
            $stage = 'vault_rehearsal'
            try {
                if ((Invoke-RecoveryContainer 'vault-rehearsal' $format $image '').Trim() -cne 'PASS|vault') {
                    throw $stage
                }
            }
            finally { Assert-Clean $before }
            Write-Output 'PASS class=vault_ciphertext_and_synthetic_keys'
        }
        return
    }
    if ($Mode -eq 'Initialize') {
        $stage = 'initialize'
        Initialize-PackageStorage
        Assert-Clean $before
        Write-Output "PASS class=initialized pid=$PID"
        return
    }
    if ($Mode -eq 'Acceptance') {
        $stage = 'acceptance'
        Invoke-RamRegression
        $initialized = (Invoke-RecoveryChild Initialize).Trim()
        if ($initialized -cnotmatch '\APASS class=initialized pid=[0-9]+\z') { throw 'child_contract' }
        $created = (Invoke-RecoveryChild Create).Trim()
        $creator = [regex]::Match($created,'\APASS class=created pid=([0-9]+)\z')
        if (-not $creator.Success) { throw 'child_contract' }
        $recovered = (Invoke-PostgrestTest 'persistent').Trim()
        $restorer = [regex]::Match($recovered,'\APASS class=restored pid=([0-9]+) restore_ms=[0-9]{1,9}\z')
        if (-not $restorer.Success -or $creator.Groups[1].Value -ceq $restorer.Groups[1].Value) { throw 'child_contract' }
        $null = Test-Package $packagePath
        Test-Rejections
        Expect-Rejection { Assert-Unoccupied } 'already_exists'
        if (@(Get-ChildItem -Force -LiteralPath $packageRoot | Where-Object Name -Like '.pending-*').Count) { throw 'cleanup' }
        $null = Test-Package $packagePath
        Assert-Clean $before
        $initialized
        $created
        $recovered
        Write-Output 'PASS class=postgrest_recovered_database'
        Write-Output "PASS class=negative_tests package=$PackageId session=$SessionId"
        return
    }
    $stage = 'storage_encryption'
    Assert-Storage $packageRoot
    Assert-Storage $trustRoot
    if ($Mode -in @('Create','ScheduledSynthetic')) {
        $stage = 'create'
        # A task owner and an interactive invocation must share the same session lock.
        $mutex = [Threading.Mutex]::new($false,"Global\AtlasRecovery-SyntheticPublisher")
        $owned = $false
        $event = @{ Created = $false }
        $eventPath = Join-Path $trustRoot "$PackageId.backup-event"
        try {
            Enter-RecoveryLock $mutex
            $owned = $true
            $clock = [Diagnostics.Stopwatch]::StartNew()
            if ($Mode -eq 'ScheduledSynthetic') {
                # A signed event is required before the package can become visible.
                Publish-Package $before {
                    param($sealed)
                    $finished = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                    $record = "atlas-backup-event-v2|synthetic|$sourceId|$PackageId|$finished|$($sealed.Manifest)|$($sealed.History)"
                    New-File $eventPath ($ascii.GetBytes($record + "|$(Sign-Receipt $record)"))
                    $event.Created = $true
                }
                Write-Output "PASS class=scheduled_synthetic package=$PackageId backup_ms=$($clock.ElapsedMilliseconds)"
            }
            else {
                Publish-Package $before
                Write-Output "PASS class=created pid=$PID"
            }
        }
        finally {
            try {
                if ($event.Created -and -not [IO.Directory]::Exists($packagePath) -and -not $script:cleanupUnverified) {
                    Assert-PrivatePath $eventPath $false
                    [IO.File]::Delete($eventPath)
                }
            }
            finally {
                if ($owned) { $mutex.ReleaseMutex() }
                $mutex.Dispose()
            }
        }
        return
    }
    $stage = 'package_verification'
    $sealed = Test-Package $packagePath
    if ($Mode -eq 'VerifyScheduled') {
        $stage = 'backup_event'
        $eventPath = Join-Path $trustRoot "$PackageId.backup-event"
        Assert-PrivatePath $eventPath $false
        if ((Get-Item -LiteralPath $eventPath).Length -gt 512) { throw $stage }
        $fields = [IO.File]::ReadAllText($eventPath,$ascii).Split('|')
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        if ($fields.Count -ne 8 -or $fields[0] -cne 'atlas-backup-event-v2' -or
            $fields[1] -cne 'synthetic' -or $fields[2] -cne $sourceId -or $fields[3] -cne $PackageId -or
            $fields[4] -cnotmatch '\A[1-9][0-9]{0,14}\z' -or [int64]$fields[4] -gt $now -or
            $fields[5] -cne $sealed.Manifest -or $fields[6] -cne $sealed.History -or
            $fields[7] -cnotmatch '\A[0-9a-f]{64}\z' -or
            -not (Equal-Mac (Sign-Receipt ($fields[0..6] -join '|')) $fields[7])) { throw $stage }
        Assert-Clean $before
        Write-Output "PASS class=scheduled_verified package=$PackageId completed_ms=$($fields[4]) verified_ms=$now"
        return
    }
    if ($Mode -eq 'Restore') {
        $stage = 'restore'
        $payload = "$PackageId|$sourceId|$($sealed.Manifest)|$($sealed.History)"
        $result = (Invoke-RecoveryContainer 'restore' $format $image $packagePath $payload $PostgrestSession).Trim()
        $proof = [regex]::Match($result,'\APASS\|full_v6_history_acl\|([0-9]{1,9})\z')
        if (-not $proof.Success) { throw 'restore_contract' }
        $null = Test-Package $packagePath
        Assert-Clean $before
        Write-Output "PASS class=restored pid=$PID restore_ms=$($proof.Groups[1].Value)"
        return
    }
    Assert-Clean $before
    Write-Output 'PASS class=verified'
}
catch {
    Write-Output "BLOCKED class=$stage"
    exit 1
}
