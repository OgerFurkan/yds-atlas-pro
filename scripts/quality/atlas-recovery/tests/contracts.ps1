# Exercises the retained on-disk format without reading or creating any package.
# The test key is temporary process memory and deliberately does not exercise DPAPI.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$modules = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $modules 'recovery.config.json') -Raw | ConvertFrom-Json
. (Join-Path $modules 'security.ps1')
. (Join-Path $modules 'packages.ps1')
$ascii = [Text.Encoding]::ASCII
$files = @($config.artifacts)
$PackageId = '1' * 32
$sourceId = 'synthetic-' + ('2' * 32)

function Get-TrustKey { return ,([byte[]](1..32)) }
function Package-FileHash([string] $Folder,[string] $Name) { 'a' * 64 }

$headers = @{
    ImageV2 = 'atlas-recovery-v8-image-v2'
    LegacyV7 = 'atlas-recovery-v7-synthetic'
    LegacyV8 = 'atlas-recovery-v8'
}
foreach ($name in @('ImageV2','LegacyV7','LegacyV8')) {
    $format = $config.formats.$name
    $image = $config.images.($format.image)
    $fields = @($headers[$name],"package=$PackageId","source=$sourceId")
    if ($name -eq 'ImageV2') {
        $fields += @("image_index=$($image.index)","image_manifest=$($image.manifest)","image_platform=$($config.platform)")
    }
    $expected = $fields + @(foreach ($file in $files) { ('a' * 64) + "  $file" })
    $manifest = ($expected -join [char]10) + [char]10
    if ((Get-Manifest 'memory') -cne $manifest) { throw "$name manifest" }
    $hash = Bytes-Hash $ascii.GetBytes($manifest)
    $history = 'b' * 64
    $record = ((@($fields) + @("manifest=$hash","history=$history")) -join [char]10) + [char]10
    $signed = $record + "mac=$(Sign-Receipt $record)" + [char]10
    $parsed = ConvertFrom-RecoveryReceipt $signed
    if ($parsed.Manifest -cne $hash -or $parsed.History -cne $history) { throw "$name receipt" }
    Expect-Rejection { ConvertFrom-RecoveryReceipt ($signed.Replace($history, ('0' * 64))) } 'independent_trust'
    Expect-Rejection { ConvertFrom-RecoveryReceipt ($signed.Replace($headers[$name],'invalid-format')) } 'independent_trust'
    Expect-Rejection { ConvertFrom-RecoveryReceipt ($signed.Replace($sourceId,('synthetic-' + '3' * 32))) } 'independent_trust'
    if ($name -eq 'ImageV2') {
        $changed = $record.Replace($image.manifest,('sha256:' + '0' * 64))
        $wrong = $changed + "mac=$(Sign-Receipt $changed)" + [char]10
        Expect-Rejection { ConvertFrom-RecoveryReceipt $wrong } 'independent_trust'
    }
    Write-Output "PASS class=manifest_receipt format=$name"
}

if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
    Add-Type -TypeDefinition @'
using System;
using System.Threading;
public sealed class AtlasRecoveryLockFixture : IDisposable {
    private readonly ManualResetEvent held = new ManualResetEvent(false);
    private readonly ManualResetEvent stop = new ManualResetEvent(false);
    private readonly Thread owner;
    public AtlasRecoveryLockFixture(Mutex mutex, bool abandon) {
        owner = new Thread(delegate() {
            mutex.WaitOne();
            held.Set();
            if (abandon) return;
            stop.WaitOne();
            mutex.ReleaseMutex();
        });
        owner.IsBackground = true;
        owner.Start();
        if (!held.WaitOne(5000)) throw new TimeoutException();
        if (abandon && !owner.Join(5000)) throw new TimeoutException();
    }
    public void Dispose() {
        stop.Set();
        if (!owner.Join(5000)) throw new TimeoutException();
        stop.Dispose();
        held.Dispose();
    }
}
'@
    $mutex = [Threading.Mutex]::new($false,"Local\AtlasRecoverySynthetic-$([guid]::NewGuid().ToString('N'))")
    try {
        $held = [AtlasRecoveryLockFixture]::new($mutex,$false)
        try { Expect-Rejection { Enter-RecoveryLock $mutex } 'operation_in_progress' }
        finally { $held.Dispose() }
        $abandoned = [AtlasRecoveryLockFixture]::new($mutex,$true)
        try {
            Expect-Rejection { Enter-RecoveryLock $mutex } 'previous_operation_unverified'
            Enter-RecoveryLock $mutex
            $mutex.ReleaseMutex()
        }
        finally { $abandoned.Dispose() }
    }
    finally { $mutex.Dispose() }
    Write-Output 'PASS class=publication_mutex'
}
