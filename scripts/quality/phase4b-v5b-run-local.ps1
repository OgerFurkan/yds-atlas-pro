# LOCAL ONLY. Creates its own transient Docker PostgreSQL 16 container and stops ONLY it.
# No stage/prod connection, SQL migration, code change, Git mutation, or push.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$branch = 'feature/atlas-smart-daily-plan-20261114'
$head = '740d5228bffd29b5c32bedda7479e3cdf244ac38'
$expected = @(
    '?? scripts/quality/phase4b-v5b-postgres-concurrency.ts'
    '?? scripts/quality/phase4b-v5b-run-local.ps1'
    '?? docs/architecture/phase4b-v5b-real-concurrency-runbook.md'
)
if ((git -C $project branch --show-current).Trim() -ne $branch) { throw 'STOP: Wrong branch' }
if ((git -C $project rev-parse HEAD).Trim() -ne $head) { throw 'STOP: Unexpected HEAD' }
$status = @(git -C $project status --porcelain --untracked-files=all)
if ($status.Count -ne 3 -or @($status | Where-Object { $_ -notin $expected }).Count -gt 0) {
    git -C $project status --short --untracked-files=all
    throw 'STOP: Unexpected worktree state'
}
if (@(git -C $project diff --cached --name-only).Count -gt 0) { throw 'STOP: Staged files found' }
$bunExe = Join-Path $env:APPDATA 'npm\node_modules\bun\bin\bun.exe'
if (-not (Test-Path -LiteralPath $bunExe -PathType Leaf)) { throw 'STOP: Bun executable missing' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'STOP: Docker Desktop not installed or unavailable. No operation performed.'
}
& docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'STOP: Docker Desktop engine not running' }

# Explicitly create ONLY an ephemeral, isolated, loopback-bound test database.
$name = 'atlas-v5b-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$adminPassword = [guid]::NewGuid().ToString('N')
$rolePassword = [guid]::NewGuid().ToString('N')
$created = $false
$priorPort = [Environment]::GetEnvironmentVariable('ATLAS_V5B_PORT', 'Process')
$priorAdmin = [Environment]::GetEnvironmentVariable('ATLAS_V5B_ADMIN_PASSWORD', 'Process')
$priorRole = [Environment]::GetEnvironmentVariable('ATLAS_V5B_ROLE_PASSWORD', 'Process')
$priorSentinel = [Environment]::GetEnvironmentVariable('ATLAS_V5B_LOCAL_ONLY', 'Process')
try {
    Write-Host "[1/3] Creating isolated localhost PostgreSQL container ($name)..." -ForegroundColor Cyan
    & docker run --rm --detach --name $name `
        -e "POSTGRES_PASSWORD=$adminPassword" `
        -e 'POSTGRES_USER=postgres' `
        -e 'POSTGRES_DB=atlas_v5b_isolated' `
        -p '127.0.0.1::5432' `
        'postgres:16-alpine' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'STOP: Docker container could not start' }
    $created = $true

    $portLine = (& docker port $name '5432/tcp' | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $portLine -notmatch '127\.0\.0\.1:(\d+)') {
        throw 'STOP: Local-only port mapping is not verified'
    }
    $port = [int]$Matches[1]
    $ready = $false
    for ($n = 0; $n -lt 80; $n++) {
        & docker exec $name pg_isready -U postgres -d atlas_v5b_isolated 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'STOP: Isolated PostgreSQL did not become ready' }

    Write-Host '[2/3] Running two real PostgreSQL backend connections...' -ForegroundColor Cyan
    $env:ATLAS_V5B_PORT = [string]$port
    $env:ATLAS_V5B_ADMIN_PASSWORD = $adminPassword
    $env:ATLAS_V5B_ROLE_PASSWORD = $rolePassword
    $env:ATLAS_V5B_LOCAL_ONLY = 'DOCKER_CREATED_IN_THIS_RUN'
    Push-Location $project
    try {
        & $bunExe run 'scripts/quality/phase4b-v5b-postgres-concurrency.ts'
        $exit = $LASTEXITCODE
    }
    finally { Pop-Location }
    if ($exit -ne 0) { throw 'STOP: Real PostgreSQL concurrency acceptance failed' }
    Write-Host '[3/3] PASS: Real PostgreSQL concurrency validation passed.' -ForegroundColor Green
}
finally {
    if ($created) {
        # Stop ONLY the uniquely named container created above. It has no mounted user volume.
        & docker stop --time 2 $name | Out-Null
    }
    [Environment]::SetEnvironmentVariable('ATLAS_V5B_PORT', $priorPort, 'Process')
    [Environment]::SetEnvironmentVariable('ATLAS_V5B_ADMIN_PASSWORD', $priorAdmin, 'Process')
    [Environment]::SetEnvironmentVariable('ATLAS_V5B_ROLE_PASSWORD', $priorRole, 'Process')
    [Environment]::SetEnvironmentVariable('ATLAS_V5B_LOCAL_ONLY', $priorSentinel, 'Process')
}
