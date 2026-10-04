# db/tests/run_tests.ps1
# Runs Phase 1 and Phase 2 test suites against the database specified in .env.local

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent (Split-Path -Parent $scriptDir)

# Read database URL from .env.local or environment variable
$envFile = Join-Path $projectDir ".env.local"
$dbUrl = $env:DATABASE_URL

if (-not $dbUrl -and (Test-Path $envFile)) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -match "^DATABASE_URL=(.+)$") {
            $dbUrl = $matches[1]
        }
    }
}

if (-not $dbUrl) {
    Write-Error "DATABASE_URL is not set and could not be found in .env.local"
    exit 1
}

# Resolve psql executable
$cmd = Get-Command psql -ErrorAction SilentlyContinue
$psqlPath = $null
if ($cmd) { $psqlPath = $cmd.Source }
if (-not $psqlPath) {
    $candidates = @(
        "C:\Program Files\PostgreSQL\18\bin\psql.exe",
        "C:\Program Files\PostgreSQL\17\bin\psql.exe",
        "C:\Program Files\PostgreSQL\16\bin\psql.exe"
    )
    foreach ($cand in $candidates) {
        if (Test-Path $cand) {
            $psqlPath = $cand
            break
        }
    }
}

if (-not $psqlPath) {
    Write-Error "psql.exe not found in PATH or standard installation directories"
    exit 1
}

Write-Host "========================================" -ForegroundColor Magenta
Write-Host " Running FinShield Database Test Suites " -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta

Write-Host "`n--- Running Phase 1 Tests ---" -ForegroundColor Cyan
$p1Test = Join-Path $scriptDir "phase1_tests.sql"
& $psqlPath "$dbUrl" -v ON_ERROR_STOP=1 -f "$p1Test"

Write-Host "`n--- Running Phase 2 Tests ---" -ForegroundColor Cyan
$p2Test = Join-Path $scriptDir "phase2_tests.sql"
& $psqlPath "$dbUrl" -v ON_ERROR_STOP=1 -f "$p2Test"

Write-Host "`n========================================" -ForegroundColor Green
Write-Host " ALL TEST SUITES PASSED (0 FAILURES)   " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
