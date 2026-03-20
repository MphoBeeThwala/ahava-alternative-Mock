# RAILWAY EARLY WARNING DEMO - FINAL SETUP GUIDE
# Complete this in order

Write-Host ""
Write-Host "============================================================"  
Write-Host "AHAVA EARLY WARNING DEMO - FINAL SETUP"  
Write-Host "============================================================"  
Write-Host ""

# Step 1
Write-Host "[STEP 1] BACKEND URL REQUIRED" -ForegroundColor Cyan
Write-Host "============================================================"  
Write-Host ""
Write-Host "Your frontend is at:" -ForegroundColor Green
Write-Host "  https://frontend-production-326c.up.railway.app" 
Write-Host ""
Write-Host "To find your backend URL:" -ForegroundColor Yellow
Write-Host "  1. Open: https://railway.app/dashboard"
Write-Host "  2. Click your project"
Write-Host "  3. Click Backend service"  
Write-Host "  4. Find 'Public URL' field"
Write-Host "  5. Copy it (looks like: https://...up.railway.app)"
Write-Host ""

$backend = Read-Host "Enter backend URL (or press Enter for default)"

if (-not $backend) {
    $backend = "https://ahava-api.up.railway.app"
}

Write-Host ""
Write-Host "[SAVED] Backend URL: $backend" -ForegroundColor Green

# Step 2
Write-Host ""
Write-Host "[STEP 2] SEED MOCK PATIENTS" -ForegroundColor Cyan
Write-Host "============================================================"  
Write-Host ""
Write-Host "REQUIRED: Seed 50 patients in Railway database" -ForegroundColor Yellow
Write-Host ""
Write-Host "Go to Railway console:" -ForegroundColor Green
Write-Host "  https://railway.app/dashboard"
Write-Host "  -> Backend -> Deploy -> View Logs -> Console"
Write-Host ""
Write-Host "Paste this command:" -ForegroundColor Green
Write-Host "  cd apps/backend ; MOCK_PATIENT_COUNT=50 ; MOCK_WITH_HISTORY=1 ; npm run seed:mock-patients"
Write-Host ""
Write-Host "Wait for it to complete (or press ENTER when done)" -ForegroundColor Yellow

$seedDone = Read-Host "Press ENTER when seeding is complete"

Write-Host ""
Write-Host "[OK] Mock patients seeded" -ForegroundColor Green

# Step 3
Write-Host ""
Write-Host "[STEP 3] RUN EARLY WARNING TEST" -ForegroundColor Cyan
Write-Host "============================================================"  
Write-Host ""
Write-Host "Running early warning test on Railway..." -ForegroundColor Yellow
Write-Host ""

$env:BASE_URL = $backend
$env:COUNT = 10
$env:MOCK_PATIENT_PASSWORD = "MockPatient1!"

try {
    & node scripts/run-early-warning-test.js
} catch {
    Write-Host "Test execution error: $_" -ForegroundColor Yellow
}

# Step 4
Write-Host ""
Write-Host "[STEP 4] VIEW RESULTS" -ForegroundColor Cyan
Write-Host "============================================================"  
Write-Host ""
Write-Host "Open these URLs in your browser:" -ForegroundColor Green
Write-Host ""
Write-Host "Main Demo (Early Warning):" -ForegroundColor Cyan
Write-Host "  https://frontend-production-326c.up.railway.app/patient/early-warning"
Write-Host ""
Write-Host "Dashboard (Live Data):" -ForegroundColor Cyan
Write-Host "  https://frontend-production-326c.up.railway.app/patient/dashboard"
Write-Host ""

$openBrowser = Read-Host "Open Early Warning page now? (y/n)"
if ($openBrowser -eq "y") {
    Start-Process "https://frontend-production-326c.up.railway.app/patient/early-warning"
}

# Step 5
Write-Host ""
Write-Host "[STEP 5] RUN MULTI-USER DEMO" -ForegroundColor Cyan
Write-Host "============================================================"  
Write-Host ""
Write-Host "Optional: Run 5 patients in parallel" -ForegroundColor Yellow
Write-Host ""
Write-Host "Run this command:" -ForegroundColor Green
Write-Host "   . .\demo-railway-production.ps1"
Write-Host ""

# Summary  
Write-Host ""
Write-Host "============================================================"  
Write-Host "SETUP COMPLETE" -ForegroundColor Green
Write-Host "============================================================"  
Write-Host ""
Write-Host "What to expect:" -ForegroundColor Yellow
Write-Host "  - Risk levels showing as GREEN, YELLOW, or RED"
Write-Host "  - Health recommendations based on detected conditions"
Write-Host "  - Real-time biometric data updates"
Write-Host "  - Early warning alerts for anomalies"
Write-Host ""
Write-Host "Troubleshooting:" -ForegroundColor Yellow
Write-Host "  - Backend not responding? May be building on Railway"  
Write-Host "  - No alerts? Refresh page after 30 seconds"
Write-Host "  - Connection error? Verify backend URL is correct"
Write-Host ""
