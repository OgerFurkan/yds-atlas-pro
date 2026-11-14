# Disposable PostgreSQL 16 only. No Supabase remote changes, no deployment, no Git mutation.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$branch = 'feature/atlas-smart-daily-plan-20261114'
$base = 'f339d2f77d3b4c4017072a2cc3d75073d56e5c4f'
$expected = @(
    '?? scripts/quality/phase4b-v5cd-real-postgres.mjs'
    '?? scripts/quality/phase4b-v5cd-run-local.ps1'
    '?? docs/architecture/phase4b-v5cd-real-postgres-runbook.md'
)
if ((git -C $project branch --show-current).Trim() -ne $branch) { throw 'STOP: Wrong branch' }
if ((git -C $project rev-parse HEAD).Trim() -ne $base) { throw 'STOP: Unexpected Git HEAD' }
$status = @(git -C $project status --porcelain --untracked-files=all)
if ($status.Count -ne $expected.Count -or
    @($status | Where-Object { $_ -notin $expected }).Count -gt 0 -or
    @($expected | Where-Object { $_ -notin $status }).Count -gt 0) {
    git -C $project status --short --untracked-files=all
    throw 'STOP: Unexpected worktree changes'
}
if (@(git -C $project diff --cached --name-only).Count -ne 0) { throw 'STOP: Staged files exist' }
$bunExe = Join-Path $env:APPDATA 'npm\node_modules\bun\bin\bun.exe'
if (-not (Test-Path -LiteralPath $bunExe -PathType Leaf)) { throw 'STOP: Bun not found' }
$dockerBin = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin'
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $dockerBin)) {
    $env:PATH = "$dockerBin;$env:PATH"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'STOP: Docker not found' }
& docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'STOP: Docker Desktop engine not running' }
& docker image inspect 'postgres:16-alpine' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'STOP: postgres:16-alpine image absent; no image is pulled automatically' }

$name = 'atlas-v5cd-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$adminPassword = [guid]::NewGuid().ToString('N')
$rolePassword = [guid]::NewGuid().ToString('N')
$old = @{}
foreach ($key in @('ATLAS_V5CD_PORT','ATLAS_V5CD_ADMIN_PASSWORD','ATLAS_V5CD_ROLE_PASSWORD',
                  'ATLAS_V5CD_LOCAL_ONLY','ATLAS_V5CD_PROJECT_PATH')) {
    $old[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
$created = $false
try {
    Write-Host '[1/3] Start disposable PostgreSQL 16 (Docker localhost only)' -ForegroundColor Cyan
    & docker run --rm --detach --pull=never --name $name `
        -e "POSTGRES_PASSWORD=$adminPassword" `
        -e 'POSTGRES_USER=postgres' `
        -e 'POSTGRES_DB=atlas_v5cd_isolated' `
        -p '127.0.0.1::5432' `
        'postgres:16-alpine' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'STOP: Cannot start isolated Docker container' }
    $created = $true
    $mapping = (& docker port $name '5432/tcp' | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $mapping -notmatch '127\.0\.0\.1:(\d+)') {
        throw 'STOP: Localhost-only port binding could not be verified'
    }
    $port = [int]$Matches[1]
    $ready = $false
    for ($n = 0; $n -lt 80; $n++) {
        & docker exec $name pg_isready -U postgres -d atlas_v5cd_isolated 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'STOP: Disposable PostgreSQL did not become ready' }

    Write-Host '[2/3] Run real Postgres v3/v5/v6+ACL cutover acceptance' -ForegroundColor Cyan
    $env:ATLAS_V5CD_PORT = [string]$port
    $env:ATLAS_V5CD_ADMIN_PASSWORD = $adminPassword
    $env:ATLAS_V5CD_ROLE_PASSWORD = $rolePassword
    $env:ATLAS_V5CD_LOCAL_ONLY = 'CREATED_BY_V5CD_DOCKER_RUNNER'
    $env:ATLAS_V5CD_PROJECT_PATH = $project
    Push-Location $project
    try {
        & $bunExe run 'scripts/quality/phase4b-v5cd-real-postgres.mjs'
        $result = $LASTEXITCODE
    }
    finally { Pop-Location }
    if ($result -ne 0) { throw 'STOP: PostgreSQL acceptance FAILED. Do not commit or deploy.' }
    Write-Host '[3/3] PASS: LOCAL PostgreSQL v5C-D acceptance finished.' -ForegroundColor Green
}
finally {
    if ($created) {
        Write-Host 'Cleaning up disposable Docker container...' -ForegroundColor Cyan
        & docker stop --time 2 $name | Out-Null
    }
    foreach ($key in $old.Keys) {
        [Environment]::SetEnvironmentVariable($key, $old[$key], 'Process')
    }
}
