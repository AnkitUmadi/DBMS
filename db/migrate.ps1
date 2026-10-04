# db/migrate.ps1
# Applies db/migrations/*.sql in filename order, once each, each in its own transaction.
# Usage: powershell -File ./db/migrate.ps1

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$migrationsDir = Join-Path $scriptDir "migrations"

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

$cmd = Get-Command psql -ErrorAction SilentlyContinue
$psqlPath = $null
if ($cmd) {
    $psqlPath = $cmd.Source
}
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

# Ensure schema_migrations table exists
& $psqlPath "$dbUrl" -v ON_ERROR_STOP=1 -q -c @"
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"@

# Apply unapplied migrations in alphabetical order
Get-ChildItem -Path $migrationsDir -Filter "*.sql" | Sort-Object Name | ForEach-Object {
    $file = $_
    $name = $file.Name
    $doneAlready = & $psqlPath "$dbUrl" -tA -c "SELECT 1 FROM schema_migrations WHERE filename = '$name'"
    if (-not $doneAlready) {
        Write-Host "Applying $name..." -ForegroundColor Cyan
        & $psqlPath "$dbUrl" -v ON_ERROR_STOP=1 -q --single-transaction -f "$($file.FullName)" -c "INSERT INTO schema_migrations (filename) VALUES ('$name')"
    } else {
        Write-Host "Skipping $name (already applied)" -ForegroundColor DarkGray
    }
}

Write-Host "Migrations are up to date." -ForegroundColor Green
