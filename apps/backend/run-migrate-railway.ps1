# Run Prisma migrations against Railway Postgres from your local machine.
# Requires the PUBLIC Database URL (not postgres.railway.internal - that only works inside Railway).
#
# Get it from: Railway -> Postgres service -> Variables tab -> DATABASE_PUBLIC_URL
# If you only see DATABASE_URL with "railway.internal", check Settings -> Networking -> TCP Proxy for the public host.
#
# Usage: .\run-migrate-railway.ps1
# (Edit DATABASE_PUBLIC_URL below, or pass as first arg: .\run-migrate-railway.ps1 "postgresql://...")

param(
    [string]$DatabaseUrl = ""
)

if (-not $DatabaseUrl) {
    Write-Host "DATABASE_PUBLIC_URL not passed. Checking .env.railway ..." -ForegroundColor Yellow
    if (Test-Path ".env.railway") {
        $DatabaseUrl = (Get-Content ".env.railway" | Where-Object { $_ -match "^DATABASE_URL=" }) -replace "DATABASE_URL=", ""
    }
}

if (-not $DatabaseUrl -or $DatabaseUrl -match "railway\.internal") {
    Write-Host ""
    Write-Host "ERROR: You need the PUBLIC Railway Postgres URL (not postgres.railway.internal)." -ForegroundColor Red
    Write-Host ""
    Write-Host "Steps:" -ForegroundColor Cyan
    Write-Host "  1. Open Railway dashboard -> your Postgres service"
    Write-Host "  2. Go to Variables tab"
    Write-Host "  3. Copy DATABASE_PUBLIC_URL (or the one with a public host like *.railway.app or *.proxy.rlwy.net)"
    Write-Host "  4. Run: .\run-migrate-railway.ps1 `"postgresql://postgres:PASSWORD@HOST:PORT/railway`""
    Write-Host ""
    Write-Host "Or create .env.railway with one line: DATABASE_URL=postgresql://..."
    exit 1
}

$env:DATABASE_URL = $DatabaseUrl
Write-Host "Running migrations..." -ForegroundColor Green
pnpm prisma migrate deploy
$exitCode = $LASTEXITCODE
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
exit $exitCode
