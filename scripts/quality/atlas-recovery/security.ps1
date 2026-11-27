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

function Bytes-Hash([byte[]] $Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function New-File([string] $Path,[byte[]] $Bytes) {
    $stream = [IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {
        try { $stream.Write($Bytes,0,$Bytes.Length); $stream.Flush($true) }
        finally { $stream.Dispose() }
        $acl = Get-Acl -LiteralPath $Path
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
        if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) {
            $acl.SetOwner($sid)
            Set-Acl -LiteralPath $Path -AclObject $acl
        }
        Assert-PrivatePath $Path $false
    }
    catch {
        [IO.File]::Delete($Path)
        throw
    }
}

function Assert-PrivatePath([string] $Path,[bool] $Directory) {
    $resolved = Get-PhysicalPath $Path $Directory
    if ($resolved -cne $Path) { throw 'path_guard' }
    Assert-Acl $Path $Directory
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $acl = Get-Acl -LiteralPath $Path
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'acl_guard' }
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid,'S-1-5-18')) {
            throw 'acl_guard'
        }
    }
}

function Assert-Storage([string] $Path) {
    # Dynamic scope supplies the exact pinned v6 prerequisite its expected argument.
    $SecureRoot = $Path
    if ((Get-EncryptedRoot) -cne $Path) { throw 'path_guard' }
    Assert-PrivatePath $Path $true
}

function Assert-EncryptionForCreation {
    foreach ($mount in (@('D:',[IO.Path]::GetPathRoot($trustRoot).TrimEnd('\'),$env:SystemDrive) | Select-Object -Unique)) {
        $disk = [IO.DriveInfo]::new($mount)
        $volume = Get-BitLockerVolume -MountPoint $mount -ErrorAction Stop
        if ($disk.DriveType -ne 'Fixed' -or $disk.DriveFormat -ne 'NTFS' -or
            $volume.VolumeStatus.ToString() -ne 'FullyEncrypted' -or $volume.ProtectionStatus.ToString() -ne 'On' -or
            $volume.EncryptionPercentage -ne 100) { throw 'storage_encryption' }
    }
}

function New-PrivateDirectory([string] $Path) {
    if (Test-Path -LiteralPath $Path) { throw 'already_exists' }
    $parent = Split-Path -Parent $Path
    $null = Get-PhysicalPath $parent $true
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($identity in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
        $acl.AddAccessRule($rule)
    }
    $null = [IO.Directory]::CreateDirectory($Path,$acl)
    Assert-PrivatePath $Path $true
}

function Get-TrustKey {
    $keyPath = Join-Path $trustRoot 'trust.dpapi'
    Assert-PrivatePath $keyPath $false
    if ((Get-Item -LiteralPath $keyPath).Length -gt 1024) { throw 'independent_trust' }
    $value = [Security.Cryptography.ProtectedData]::Unprotect(
        [IO.File]::ReadAllBytes($keyPath),$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    if ($value.Length -ne 32) {
        [Array]::Clear($value,0,$value.Length)
        throw 'independent_trust'
    }
    return ,$value
}

function Sign-Receipt([string] $Body) {
    $key = Get-TrustKey
    try {
        $mac = [Security.Cryptography.HMACSHA256]::new($key)
        try { return [BitConverter]::ToString($mac.ComputeHash($ascii.GetBytes($Body))).Replace('-','').ToLowerInvariant() }
        finally { $mac.Dispose() }
    }
    finally { [Array]::Clear($key,0,$key.Length) }
}

function Equal-Mac([string] $A,[string] $B) {
    if ($A.Length -ne $B.Length) { return $false }
    $diff = 0
    for ($i=0; $i -lt $A.Length; $i++) { $diff = $diff -bor ([int][char]$A[$i] -bxor [int][char]$B[$i]) }
    return $diff -eq 0
}

function Expect-Rejection([scriptblock] $Action,[string] $Class) {
    try { $null = & $Action; throw 'unsafe_acceptance' }
    catch { if ($_.Exception.Message -cne $Class) { throw } }
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
