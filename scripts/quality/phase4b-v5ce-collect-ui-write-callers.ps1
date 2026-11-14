param([Parameter(Mandatory=$true)][string]$Project)
$ErrorActionPreference = "Stop"
$expectedBranch = "feature/atlas-smart-daily-plan-20261114"
if ((git -C $Project branch --show-current).Trim() -ne $expectedBranch) { throw "STOP: wrong branch" }
$tracked = @(git -C $Project grep -l -E 'applyScores|scoreChanges|word\.score|onSaveResults|onWordsChange|onUpdateWord|setWordGroup|setWordScore|/api/words/scores' -- 'frontend/src/**/*.ts' 'frontend/src/**/*.tsx' 2>$null)
$explicit = @(
 "frontend/src/features/word-library/components/word-library-page.tsx",
 "frontend/src/features/learning-game/components/learning-game-page.tsx",
 "frontend/src/features/word-library/api/word-repository.ts"
)
$paths = @($explicit + $tracked | Where-Object { $_ } | Select-Object -Unique)
if ($paths.Count -gt 80) { throw "STOP: too many matching files, narrow scope" }
$report = Join-Path $env:USERPROFILE "Downloads\yds-atlas-v5ce-ui-write-callers.txt"
$lines = @(
 "PHASE 4B V5C-E: READ-ONLY UI SCORE/DRAG-DROP CALL-SITES",
 "COMMIT: $((git -C $Project rev-parse HEAD).Trim())",
 "No .env, keys or repository changes"
)
foreach ($file in $paths) {
 $source = Join-Path $Project ($file.Replace('/', '\'))
 if (Test-Path -LiteralPath $source -PathType Leaf) {
   $lines += ""; $lines += "========== $file =========="
   $lines += Get-Content -LiteralPath $source -Encoding UTF8
 }
}
$lines | Set-Content -LiteralPath $report -Encoding UTF8
Write-Host "Source report: $report"
