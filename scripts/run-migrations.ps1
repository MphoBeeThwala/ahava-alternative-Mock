# Ahava Healthcare - Database Migration Runner (Windows PowerShell)
# Runs all migrations in order

Write-Host "🗄️  Running Ahava Healthcare Database Migrations..." -ForegroundColor Cyan
Write-Host ""

# Check if wrangler is available
try {
    npx wrangler --version | Out-Null
} catch {
    Write-Host "❌ Error: wrangler not found. Please install it with: npm install -g wrangler" -ForegroundColor Red
    exit 1
}

# Determine if running locally or remote
$RemoteFlag = ""
if ($args[0] -eq "--remote" -or $args[0] -eq "-r") {
    $RemoteFlag = "--remote"
    Write-Host "🌐 Running migrations on PRODUCTION database" -ForegroundColor Yellow
} else {
    Write-Host "💻 Running migrations on LOCAL development database" -ForegroundColor Green
}

# Run migrations in order
for ($i = 1; $i -le 10; $i++) {
    Write-Host ""
    Write-Host "📝 Running migration $i/10..." -ForegroundColor Cyan
    
    $command = "npx wrangler d1 execute DB --file=./migrations/$i.sql $RemoteFlag"
    
    $result = Invoke-Expression $command
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Migration $i completed successfully" -ForegroundColor Green
    } else {
        Write-Host "❌ Migration $i failed!" -ForegroundColor Red
        Write-Host "Please fix the error and run again" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host ""
Write-Host "🎉 All migrations completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Verifying tables..." -ForegroundColor Cyan
npx wrangler d1 execute DB --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" $RemoteFlag

Write-Host ""
Write-Host "✅ Database setup complete!" -ForegroundColor Green

