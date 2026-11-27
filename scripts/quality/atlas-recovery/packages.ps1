function Enter-RecoveryLock([Threading.Mutex] $Mutex) {
    try {
        if (-not $Mutex.WaitOne(0)) { throw 'operation_in_progress' }
    }
    catch [Threading.AbandonedMutexException] {
        $Mutex.ReleaseMutex()
        throw 'previous_operation_unverified'
    }
}

function Get-PackageFields {
    $format.header
    "package=$PackageId"
    "source=$sourceId"
    if ($format.imageEvidence) {
        "image_index=$($image.index)"
        "image_manifest=$($image.manifest)"
        "image_platform=$($config.platform)"
    }
}

function Get-Manifest([string] $Folder) {
    $lines = @(Get-PackageFields)
    foreach ($name in $files) { $lines += "$(Package-FileHash $Folder $name)  $name" }
    return ($lines -join [char]10) + [char]10
}

function Read-Receipt {
    if (-not [IO.File]::Exists($receiptPath)) { throw 'independent_trust' }
    Assert-PrivatePath $receiptPath $false
    if ((Get-Item -LiteralPath $receiptPath).Length -gt 1024) { throw 'independent_trust' }
    $text = $ascii.GetString([IO.File]::ReadAllBytes($receiptPath))
    ConvertFrom-RecoveryReceipt $text
}

function ConvertFrom-RecoveryReceipt([string] $Text) {
    $prefix = [regex]::Escape((@(Get-PackageFields) -join [char]10))
    $match = [regex]::Match($Text,'\A' + $prefix +
        '\nmanifest=(?<manifest>[0-9a-f]{64})\nhistory=(?<history>[0-9a-f]{64})\nmac=(?<mac>[0-9a-f]{64})\n\z')
    if (-not $match.Success) { throw 'independent_trust' }
    $record = $Text.Substring(0,$Text.LastIndexOf('mac=',[StringComparison]::Ordinal))
    if (-not (Equal-Mac (Sign-Receipt $record) $match.Groups['mac'].Value)) { throw 'independent_trust' }
    return @{ Manifest = $match.Groups['manifest'].Value; History = $match.Groups['history'].Value }
}

function Initialize-PackageStorage {
    if ((Test-Path -LiteralPath $packageRoot) -or (Test-Path -LiteralPath $trustRoot)) { throw 'already_exists' }
    New-PrivateDirectory $packageRoot
    New-PrivateDirectory $trustRoot
    Assert-Storage $packageRoot
    Assert-Storage $trustRoot
    $key = New-Object 'byte[]' 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($key)
        New-File (Join-Path $trustRoot 'trust.dpapi') ([Security.Cryptography.ProtectedData]::Protect(
            $key,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser))
    }
    finally { $rng.Dispose(); [Array]::Clear($key,0,$key.Length) }
}

function Publish-Package($Before,[scriptblock] $BeforePublish) {
    Assert-Unoccupied
    $key = Get-TrustKey
    [Array]::Clear($key,0,$key.Length)
    $pending = Join-Path $packageRoot ('.pending-' + $PackageId)
    New-PrivateDirectory $pending
    $receiptCreated = $false
    try {
        foreach ($name in $files) { New-File (Join-Path $pending $name) ([byte[]]@()) }
        $answer = (Invoke-RecoveryContainer 'create' $format $image $pending "$PackageId|$sourceId|synthetic").Trim()
        $proof = [regex]::Match($answer,'\ASOURCE\|([0-9a-f]{64})\|([0-9a-f]{64})\z')
        if (-not $proof.Success) { throw 'source_contract' }
        $sourceHistory = $proof.Groups[1].Value
        if ((Package-FileHash $pending 'history.jsonl') -cne $sourceHistory) { throw 'source_contract' }
        foreach ($name in $files) {
            $path = Join-Path $pending $name
            Assert-PrivatePath $path $false
            $stream = [IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::None)
            try { $stream.Flush($true) } finally { $stream.Dispose() }
        }
        $manifest = $ascii.GetBytes((Get-Manifest $pending))
        $hash = Bytes-Hash $manifest
        if ($hash -cne $proof.Groups[2].Value) { throw 'source_contract' }
        New-File (Join-Path $pending 'manifest.txt') $manifest
        $fields = @(Get-PackageFields) + @("manifest=$hash","history=$sourceHistory")
        $record = ($fields -join [char]10) + [char]10
        New-File $receiptPath ($ascii.GetBytes($record + "mac=$(Sign-Receipt $record)" + [char]10))
        $receiptCreated = $true
        $sealed = Test-Package $pending
        Assert-Clean $Before
        if ($BeforePublish) { & $BeforePublish $sealed }
        [IO.Directory]::Move($pending,$packagePath)
    }
    finally {
        if (Test-Path -LiteralPath $pending) {
            if ($script:cleanupUnverified) { throw 'cleanup' }
            Remove-Candidate $pending ($files + 'manifest.txt')
        }
        if ($receiptCreated -and -not (Test-Path -LiteralPath $packagePath) -and -not $script:cleanupUnverified) {
            Assert-PrivatePath $receiptPath $false
            [IO.File]::Delete($receiptPath)
        }
    }
}

function Package-FileHash([string] $Folder,[string] $Name) {
    $path = Join-Path $Folder $Name
    Assert-PrivatePath $path $false
    if ((Get-Item -LiteralPath $path).Length -le 0) { throw 'package_integrity' }
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
}

function Test-Package([string] $Folder) {
    Assert-PrivatePath $Folder $true
    $receipt = Read-Receipt
    $actual = @(Get-ChildItem -LiteralPath $Folder -Force | ForEach-Object Name | Sort-Object)
    $expected = @(($files + 'manifest.txt') | Sort-Object)
    if ($actual.Count -ne $expected.Count -or (Compare-Object $actual $expected -CaseSensitive)) { throw 'package_integrity' }
    if ((Package-FileHash $Folder 'manifest.txt') -cne $receipt.Manifest -or
        (Package-FileHash $Folder 'history.jsonl') -cne $receipt.History) { throw 'package_integrity' }
    if ([IO.File]::ReadAllText((Join-Path $Folder 'manifest.txt')) -cne (Get-Manifest $Folder)) {
        throw 'package_integrity'
    }
    return $receipt
}

function Remove-Candidate([string] $Directory,[string[]] $Allowed) {
    Assert-PrivatePath $Directory $true
    if ((Split-Path -Parent $Directory) -cne $packageRoot) { throw 'cleanup' }
    $entries = @(Get-ChildItem -LiteralPath $Directory -Force)
    foreach ($file in $entries) {
        if ($file.Name -cnotin $Allowed) { throw 'cleanup' }
        Assert-PrivatePath $file.FullName $false
    }
    foreach ($file in $entries) { [IO.File]::Delete($file.FullName) }
    [IO.Directory]::Delete($Directory,$false)
}

function Assert-Unoccupied {
    if ((Test-Path -LiteralPath $packagePath) -or (Test-Path -LiteralPath $receiptPath)) { throw 'already_exists' }
}

function Test-Rejections {
    $test = Join-Path $packageRoot ('test-' + [Guid]::NewGuid().ToString('N'))
    New-PrivateDirectory $test
    try {
        Expect-Rejection { Test-Package $test } 'package_integrity'
        foreach ($name in $files) {
            New-File (Join-Path $test $name) ([IO.File]::ReadAllBytes((Join-Path $packagePath $name)))
        }
        Expect-Rejection { Test-Package $test } 'package_integrity'
        $m = Join-Path $test 'manifest.txt'
        New-File $m ([IO.File]::ReadAllBytes((Join-Path $packagePath 'manifest.txt')))
        foreach ($name in @('database.dump','history.jsonl')) {
            $f = Join-Path $test $name
            [IO.File]::AppendAllText($f,'synthetic-tamper')
            Expect-Rejection { Test-Package $test } 'package_integrity'
            [IO.File]::WriteAllText($m,(Get-Manifest $test),$ascii)
            Expect-Rejection { Test-Package $test } 'package_integrity'
            [IO.File]::WriteAllBytes($f,[IO.File]::ReadAllBytes((Join-Path $packagePath $name)))
            [IO.File]::WriteAllBytes($m,[IO.File]::ReadAllBytes((Join-Path $packagePath 'manifest.txt')))
        }
        $originalReceipt = $receiptPath
        $originalProof = Read-Receipt
        try {
            $receiptPath = Join-Path $trustRoot 'nonexistent-receipt.txt'
            Expect-Rejection { Test-Package $test } 'independent_trust'
            $receiptPath = Join-Path $trustRoot ('negative-' + [Guid]::NewGuid().ToString('N') + '.receipt')
            $historyPath = Join-Path $test 'history.jsonl'
            [IO.File]::AppendAllText($historyPath,'synthetic-claim')
            [IO.File]::WriteAllText($m,(Get-Manifest $test),$ascii)
            $forgedManifest = Package-FileHash $test 'manifest.txt'
            $forgedHistory = Package-FileHash $test 'history.jsonl'
            $forged = [IO.File]::ReadAllText($originalReceipt).
                Replace("manifest=$($originalProof.Manifest)","manifest=$forgedManifest").
                Replace("history=$($originalProof.History)","history=$forgedHistory")
            New-File $receiptPath ($ascii.GetBytes($forged))
            try { Expect-Rejection { Test-Package $test } 'independent_trust' }
            finally {
                Assert-PrivatePath $receiptPath $false
                [IO.File]::Delete($receiptPath)
                [IO.File]::WriteAllBytes($historyPath,[IO.File]::ReadAllBytes((Join-Path $packagePath 'history.jsonl')))
                [IO.File]::WriteAllBytes($m,[IO.File]::ReadAllBytes((Join-Path $packagePath 'manifest.txt')))
            }
            $receiptPath = $originalReceipt
            $null = Test-Package $test
            $originalPackage = $PackageId
            try {
                $PackageId = '0' * 32
                Expect-Rejection { Test-Package $test } 'independent_trust'
            }
            finally { $PackageId = $originalPackage }
        }
        finally { $receiptPath = $originalReceipt }
        # Do not alter the approved package or its receipt in a negative case.
        $f = Join-Path $test 'history.jsonl'
        $acl = Get-Acl -LiteralPath $f
        $proof = Get-Acl -LiteralPath $f
        $identity = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
        $proof.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,'Read','Allow'))
        Set-Acl -LiteralPath $f -AclObject $proof
        try {
            $rejected = $false
            try { $null = Test-Package $test } catch { $rejected = $true }
            if (-not $rejected) { throw 'unsafe_acceptance' }
        }
        finally { Set-Acl -LiteralPath $f -AclObject $acl }
        $junction = Join-Path $test 'synthetic-junction'
        $null = New-Item -ItemType Junction -Path $junction -Target $test
        try {
            $rejected = $false
            try { Assert-PrivatePath $junction $true } catch { $rejected = $true }
            if (-not $rejected) { throw 'unsafe_acceptance' }
        }
        finally {
            $link = Get-Item -Force -LiteralPath $junction
            if ($link.Parent.FullName -cne $test -or -not ($link.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw 'cleanup'
            }
            [IO.Directory]::Delete($junction,$false)
        }
    }
    finally { Remove-Candidate $test ($files + 'manifest.txt') }
}
