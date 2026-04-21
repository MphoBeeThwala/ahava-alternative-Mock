# Helper: Find Your Railway Production URLs
# PSScriptAnalyzer suppress rules for demo/development scripts
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '')]
param()

Write-Host "🔍 Searching for Railway Production URLs..." -ForegroundColor Cyan
Write-Host ""

# Try to get from Railway CLI if installed
try {
    $railwayExe = Get-Command railway -ErrorAction SilentlyContinue
    if ($railwayExe) {
        Write-Host "✅ Railway CLI found" -ForegroundColor Green
        Write-Host "   Attempting to detect project URLs..." -ForegroundColor DarkGray
        Write-Host ""
        
        # This would require you to be logged in to Railway CLI
        Write-Host "Run these commands to find your URLs:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  railway link" -ForegroundColor DarkGray
        Write-Host "  railway service list" -ForegroundColor DarkGray
        Write-Host ""
    }
} catch {
    # Railway CLI not installed
}

# Known frontend URL from earlier error messages
$knownFrontend = "https://frontend-production-326c.up.railway.app"

Write-Host "📱 Frontend URL (Found from deployment logs):" -ForegroundColor Cyan
Write-Host "   $knownFrontend" -ForegroundColor Green
Write-Host ""

# Prompt user for backend URL
Write-Host "🔗 Backend URL (Need to find this):" -ForegroundColor Yellow
Write-Host ""
Write-Host "To find your backend URL:" -ForegroundColor Cyan
Write-Host "  1. Go to https://railway.app/dashboard" -ForegroundColor DarkGray
Write-Host "  2. Click your project" -ForegroundColor DarkGray
Write-Host "  3. Click 'Backend' service" -ForegroundColor DarkGray
Write-Host "  4. Copy the 'Public URL' from the service details" -ForegroundColor DarkGray
Write-Host ""

$backendUrl = Read-Host "Enter your backend URL (or press Enter to use default)"

if (-not $backendUrl) {
    $backendUrl = "https://ahava-api.up.railway.app"
    Write-Host "Using default: $backendUrl" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "URLs Configured:" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Backend:  $backendUrl" -ForegroundColor Green
Write-Host "  Frontend: $knownFrontend" -ForegroundColor Green
Write-Host ""

# Test connection
Write-Host "🧪 Testing connection to backend..." -ForegroundColor Yellow

try {
    $null = Invoke-RestMethod -Uri "$backendUrl/api/health" -Method GET -TimeoutSec 5 -ErrorAction Stop
    Write-Host "✅ Backend is reachable and responding" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "⚠️  Backend may not be reachable" -ForegroundColor Yellow
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Cyan
    Write-Host "  • Verify the URL is correct" -ForegroundColor DarkGray
    Write-Host "  • Check Railway deployment status" -ForegroundColor DarkGray
    Write-Host "  • Ensure backend service is running" -ForegroundColor DarkGray
    Write-Host ""
}

# Next steps
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "Next Steps:" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "1. Update demo-railway-production.ps1:" -ForegroundColor Yellow
$updateCode = @"
`$RAILWAY_BACKEND = "$backendUrl"
`$RAILWAY_FRONTEND = "$knownFrontend"
"@
Write-Host "   Replace:" -ForegroundColor DarkGray
Write-Host "   `$RAILWAY_BACKEND = `"https://backend-production.up.railway.app`"" -ForegroundColor DarkGray
Write-Host ""
Write-Host "   With:" -ForegroundColor Green
Write-Host "   $($updateCode.Split([Environment]::NewLine)[0])" -ForegroundColor Green
Write-Host ""

Write-Host "2. Seed mock patients in Railway backend:" -ForegroundColor Yellow
Write-Host "   Go to Railway console and run:" -ForegroundColor DarkGray
Write-Host "   cd apps/backend && MOCK_PATIENT_COUNT=50 MOCK_WITH_HISTORY=1 npm run seed:mock-patients" -ForegroundColor DarkGray
Write-Host ""

Write-Host "3. Run the demo:" -ForegroundColor Yellow
Write-Host "   . .\demo-railway-production.ps1" -ForegroundColor Green
Write-Host ""

# Option to copy URLs to clipboard
$copyUrls = Read-Host "Copy URLs to clipboard? (y/n)"
if ($copyUrls -eq 'y') {
    $output = @"
Backend: $backendUrl
Frontend: $knownFrontend

Update demo-railway-production.ps1:
`$RAILWAY_BACKEND = "$backendUrl"
`$RAILWAY_FRONTEND = "$knownFrontend"
"@
    $output | Set-Clipboard
    Write-Host "✅ URLs copied to clipboard" -ForegroundColor Green
}
