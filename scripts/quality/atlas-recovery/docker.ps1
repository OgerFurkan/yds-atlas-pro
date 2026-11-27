function Docker([string] $Label,[string[]] $Arguments,[Security.SecureString] $Secret,[int] $TimeoutSeconds = 20) {
    Invoke-Private $Label $script:dockerExe (@('--context',$config.dockerContext) + $Arguments) $Secret $TimeoutSeconds
}

function Initialize-Docker {
    $script:dockerExe = (Get-Command docker.exe -CommandType Application).Source
    $endpoint = (Docker 'Docker endpoint' @('context','inspect',$config.dockerContext,'--format','{{.Endpoints.docker.Host}}')).Trim()
    if ($endpoint -cne $config.dockerEndpoint) { throw 'docker_endpoint' }
    $platform = (Docker 'Docker platform' @('info','--format','{{.OSType}}/{{.Architecture}}')).Trim()
    if ($platform -cnotin @('linux/x86_64','linux/amd64')) { throw 'docker_platform' }
}

function Get-ImageReference($Image) { "docker.io/supabase/postgres@$($Image.index)" }

function Confirm-Image($Image) {
    $reference = Get-ImageReference $Image
    $index = Docker 'Cached image index' @('image','inspect','--format','{{json .}}',$reference) | ConvertFrom-Json
    $platform = Docker 'Cached image manifest' @('image','inspect','--platform',$config.platform,'--format','{{json .}}',$reference) | ConvertFrom-Json
    $record = "supabase/postgres@$($Image.index)"
    if ($index.Id -cne $Image.index -or $index.Descriptor.digest -cne $Image.index -or
        $index.Descriptor.mediaType -cne 'application/vnd.oci.image.index.v1+json' -or
        $record -cnotin @($index.RepoDigests) -or $record -cnotin @($platform.RepoDigests) -or
        $platform.Id -cne $Image.manifest -or $platform.Descriptor.digest -cne $Image.manifest -or
        "$($platform.Os)/$($platform.Architecture)" -cne $config.platform -or
        ($platform.PSObject.Properties['Variant'] -and $platform.Variant) -or
        ($index.Config.PSObject.Properties['Volumes'] -and $index.Config.Volumes) -or
        ($platform.Config.PSObject.Properties['Volumes'] -and $platform.Config.Volumes)) {
        throw 'image_identity'
    }
}

function Get-DockerInventory {
    $queries = @(
        @('ps','-a','--no-trunc','--format','{{.ID}}|{{.Names}}|{{.State}}'),
        @('volume','ls','--format','{{.Name}}|{{.Driver}}'),
        @('network','ls','--no-trunc','--format','{{.ID}}|{{.Name}}'),
        @('image','ls','--no-trunc','--format','{{.ID}}|{{.Repository}}:{{.Tag}}')
    )
    return (@(foreach ($query in $queries) {
        ((Docker 'Docker inventory' $query) -split '\r?\n' | Sort-Object) -join [char]10
    }) -join ([char]10 + '---' + [char]10))
}

function Remove-OwnedContainer([string] $Name,[string] $Key,[string] $Value) {
    $filter = "label=$Key=$Value"
    $owned = (Docker 'Cleanup lookup' @('container','ls','-aq','--no-trunc','--filter',$filter)).Trim()
    if (-not $owned) { return }
    if ($owned -cnotmatch '\A[a-f0-9]{64}\z') { throw 'cleanup' }
    $details = Docker 'Cleanup ownership' @('container','inspect','--format','{{json .}}',$owned) | ConvertFrom-Json
    if ($details.Name -cne "/$Name" -or $details.Config.Labels.$Key -cne $Value) { throw 'cleanup' }
    $null = Docker 'Cleanup owned container' @('container','rm','--force',$owned)
    if ((Docker 'Cleanup verification' @('container','ls','-aq','--filter',$filter)).Trim()) { throw 'cleanup' }
}

function Confirm-Container($Details,[string] $Name,$Image,[hashtable] $Binds) {
    $hc = $Details.HostConfig
    $descriptor = $Details.ImageManifestDescriptor
    if ($Details.Name -cne "/$Name" -or $Details.Config.Labels.'atlas.backup.owner' -cne $Name -or
        $Details.Image -cne $Image.index -or $Details.Config.Image -cne (Get-ImageReference $Image) -or
        $descriptor.digest -cne $Image.manifest -or
        "$($descriptor.platform.os)/$($descriptor.platform.architecture)" -cne $config.platform -or
        ($descriptor.platform.PSObject.Properties['variant'] -and $descriptor.platform.variant) -or
        $Details.Config.User -cne '100:101' -or $hc.LogConfig.Type -cne 'none' -or $Details.LogPath -or
        -not $hc.ReadonlyRootfs -or $hc.Privileged -or $hc.NetworkMode -cne 'none' -or
        'ALL' -cnotin @($hc.CapDrop) -or 'no-new-privileges' -cnotin @($hc.SecurityOpt) -or
        $hc.Memory -ne $memory -or $hc.MemorySwap -ne $memory -or $hc.PublishAllPorts -or
        ($null -ne $hc.PortBindings -and @($hc.PortBindings.PSObject.Properties).Count -ne 0) -or -not $hc.Tmpfs.'/tmp') {
        throw 'container_isolation'
    }
    $mounts = @($Details.Mounts | Where-Object { $_.Destination -ne '/tmp' -or $_.Type -ne 'tmpfs' })
    if ($mounts.Count -ne $Binds.Count) { throw 'container_mount' }
    foreach ($target in $Binds.Keys) {
        $expected = $Binds[$target]
        $actual = @($mounts | Where-Object { $_.Type -ceq 'bind' -and $_.Destination -ceq $target })
        $hostMount = @($hc.Mounts | Where-Object { $_.Type -ceq 'bind' -and $_.Target -ceq $target })
        if ($actual.Count -ne 1 -or $hostMount.Count -ne 1 -or $hostMount[0].Source -cne $expected.Path -or
            $actual[0].RW -eq $expected.ReadOnly) { throw 'container_mount' }
    }
}

function Invoke-RecoveryContainer([string] $Phase,$Format,$Image,[string] $Folder,[string] $Payload,[string] $ApiSession) {
    if ($Phase -cnotin @('probe','compatibility','deletion-rehearsal','vault-rehearsal','create','restore')) { throw 'container_phase' }
    $name = 'atlas-backup-' + [Guid]::NewGuid().ToString('N')
    $handoff = '0'
    if ($ApiSession) {
        if ($ApiSession -cnotmatch '\A[0-9a-f]{32}\z' -or $Phase -cnotin @('restore','compatibility')) { throw 'container_phase' }
        $name = 'atlas-backup-' + $ApiSession
        $handoff = '1'
    }
    $tag = "atlas.backup.owner=$name"
    if ((Docker 'Container name admission' @('ps','-aq','--filter',"name=^/$name$")).Trim() -or
        (Docker 'Container label admission' @('ps','-aq','--filter',"label=$tag")).Trim()) { throw 'already_exists' }
    $mounts = @{
        '/atlas-runtime' = @{ Path = (Get-PhysicalPath (Join-Path $modules 'runtime') $true); ReadOnly = $true }
        '/atlas-tests' = @{ Path = (Get-PhysicalPath (Join-Path $modules 'tests') $true); ReadOnly = $true }
    }
    if ($Phase -in @('create','restore')) {
        $mounts['/backup'] = @{ Path = (Get-PhysicalPath $Folder $true); ReadOnly = ($Phase -eq 'restore') }
    }
    $args = @('create','-i','--name',$name,'--label',$tag,'--pull','never','--platform',$config.platform,
        '--read-only','--log-driver','none','--security-opt','no-new-privileges','--cap-drop','ALL','--user','100:101',
        '--network','none','--memory',"$memory",'--memory-swap',"$memory",
        '--tmpfs',"/tmp:rw,nosuid,nodev,noexec,mode=1777,size=$memory")
    foreach ($target in $mounts.Keys) {
        $mount = $mounts[$target]
        $suffix = if ($mount.ReadOnly) { ',readonly' } else { '' }
        $args += @('--mount',"type=bind,source=$($mount.Path),target=$target$suffix")
    }
    # Only the verifier below is inline. The checked bundle is loaded directly.
    $bootstrap = 'set -euo pipefail; printf ''%s\n'' "$1" | sha256sum -c - >/dev/null; shift; source /atlas-runtime/run.sh'
    $secret = if ($Payload) { New-ProtectedInput $Payload $null } else { $null }
    try {
        $id = (Docker 'Create isolated recovery container' ($args + @(
            '--entrypoint','/bin/bash',(Get-ImageReference $Image),'-c',$bootstrap,'--',$bundleHashes,
            $Phase,$Format.header,$Image.index,$Image.manifest,$config.platform,$handoff))).Trim()
        if ($id -cnotmatch '\A[a-f0-9]{64}\z') { throw 'container_identity' }
        $state = Docker 'Inspect recovery container' @('container','inspect','--format','{{json .}}',$id) | ConvertFrom-Json
        Confirm-Container $state $name $Image $mounts
        return Docker 'Run isolated recovery' @('container','start','--attach','--interactive',$id) $secret $config.timeoutSeconds
    }
    finally {
        if ($secret) { $secret.Dispose() }
        $script:cleanupUnverified = $true
        Remove-OwnedContainer $name 'atlas.backup.owner' $name
        $script:cleanupUnverified = $false
    }
}
