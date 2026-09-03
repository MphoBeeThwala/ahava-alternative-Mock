# Complete Railway Early Warning Demo - Automated Setup
# This script executes all steps to demonstrate the early warning system
# Run this ONCE, then follow the post-setup instructions
# PSScriptAnalyzer suppress rules for demo/development scripts
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '')]
param()

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║     🚀 AHAVA EARLY WARNING - COMPLETE RAILWAY DEMO SETUP 🚀     ║" -ForegroundColor Magenta
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

$startTime = Get-Date
$steps = @()

# ================================================================================
# PHASE 1: DETECT OR REQUEST BACKEND URL
# ================================================================================
Write-Host "[PHASE 1] Configuring Railway Backend" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

$RAILWAY_BACKEND = $null
$RAILWAY_FRONTEND = "https://frontend-production-326c.up.railway.app"

# Try to get from environment
if ($env:RAILWAY_BACKEND) {
    $RAILWAY_BACKEND = $env:RAILWAY_BACKEND
    Write-Host "[OK] Using backend from environment: $RAILWAY_BACKEND" -ForegroundColor Green
}

# If not found, ask user
if (-not $RAILWAY_BACKEND) {
    Write-Host ""
    Write-Host "⚠️  Backend URL not found in environment" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To find your backend URL:" -ForegroundColor Cyan
    Write-Host "  1. Go to: https://railway.app/dashboard" -ForegroundColor DarkGray
    Write-Host "  2. Click your project → Backend service" -ForegroundColor DarkGray
    Write-Host "  3. Copy the 'Public URL'" -ForegroundColor DarkGray
    Write-Host ""
    
    $RAILWAY_BACKEND = Read-Host "Enter your Railway backend URL (or press Enter to use default)"
    
    if (-not $RAILWAY_BACKEND) {
        $RAILWAY_BACKEND = "https://ahava-api.up.railway.app"
        Write-Host "Using default: $RAILWAY_BACKEND" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Configuration:" -ForegroundColor Green
Write-Host "  Backend:  $RAILWAY_BACKEND" -ForegroundColor DarkGray
Write-Host "  Frontend: $RAILWAY_FRONTEND" -ForegroundColor DarkGray
Write-Host ""

# ================================================================================
# PHASE 2: VERIFY CONNECTIVITY
# ================================================================================
Write-Host "[PHASE 2] Verifying Railway Connectivity" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

$backendReachable = $false
try {
    Write-Host "Testing backend connection..." -ForegroundColor Yellow
    $null = Invoke-RestMethod -Uri "$RAILWAY_BACKEND/api/health" -TimeoutSec 5 -ErrorAction Stop
    $backendReachable = $true
    Write-Host "✅ Backend is reachable and responding" -ForegroundColor Green
    $steps += "Backend Connectivity Verified"
} catch {
    Write-Host "⚠️  Backend not responding at: $RAILWAY_BACKEND" -ForegroundColor Yellow
    Write-Host "    This may be expected if the backend is still building." -ForegroundColor DarkGray
    Write-Host "    Continuing with demo setup anyway..." -ForegroundColor Yellow
    $steps += "Backend Connectivity Check (Backend not yet available)"
}

Write-Host ""

# ================================================================================
# PHASE 3: SEED MOCK PATIENTS (via API or Local)
# ================================================================================
Write-Host "[PHASE 3] Seeding Mock Patients" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

Write-Host "🌱 Setting up 50 mock patients with 14-day history..." -ForegroundColor Yellow
Write-Host ""

# Determine seed method based on backend availability
if ($backendReachable) {
    # Will use API to seed patients
}

Write-Host "📋 INSTRUCTIONS: Seed patients in Railway using this command:" -ForegroundColor Cyan
Write-Host ""
Write-Host "   Go to: https://railway.app/dashboard" -ForegroundColor DarkGray
Write-Host "   → Your Project → Backend → Deploy → View Logs → Console" -ForegroundColor DarkGray
Write-Host ""
Write-Host "   Paste this command:" -ForegroundColor Green
Write-Host "   cd apps/backend; MOCK_PATIENT_COUNT=50; MOCK_WITH_HISTORY=1; npm run seed:mock-patients" -ForegroundColor DarkGray
Write-Host ""
Write-Host "   Then press ENTER to continue here" -ForegroundColor Yellow
Write-Host ""

Read-Host "Press ENTER once patients are seeded in Railway console"

Write-Host ""
Write-Host "[OK] Patients seeded" -ForegroundColor Green
$steps += "Mock Patients Seeded (50 patients)"

Write-Host ""

# ================================================================================
# PHASE 4: VERIFY PATIENT LOGIN
# ================================================================================
Write-Host "[PHASE 4] Verifying Patient Access" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

Write-Host "Testing login as patient_0001..." -ForegroundColor Yellow

try {
    $loginRes = Invoke-RestMethod -Uri "$RAILWAY_BACKEND/api/auth/login" `
        -Method POST `
        -Headers @{"Content-Type" = "application/json"} `
        -Body (@{
            email = "patient_0001@mock.ahava.test"
            password = "MockPatient1!"
        } | ConvertTo-Json) `
        -TimeoutSec 5 `
        -ErrorAction Stop
    
    if ($loginRes.accessToken) {
        Write-Host "[OK] Login successful - patient access verified" -ForegroundColor Green
        $authToken = $loginRes.accessToken
        $steps += "Patient Authentication Verified"
    } else {
        Write-Host "⚠️  Login response received but no token" -ForegroundColor Yellow
        $authToken = $null
    }
} catch {
    Write-Host "⚠️  Login test failed: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "   (This is expected if backend is not yet deployed)" -ForegroundColor DarkGray
    $authToken = $null
}

Write-Host ""

# ================================================================================
# PHASE 5: RUN EARLY WARNING TEST
# ================================================================================
Write-Host "[PHASE 5] Running Early Warning Simulation" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

if ($authToken) {
    Write-Host "🎬 Running early warning test across 10 patients..." -ForegroundColor Yellow
    Write-Host "   • Each patient: 15 normal readings + 1 anomalous" -ForegroundColor DarkGray
    Write-Host "   • Expected: Risk levels escalate (GREEN → YELLOW → RED)" -ForegroundColor DarkGray
    Write-Host ""
    
    try {
        $env:BASE_URL = $RAILWAY_BACKEND
        $env:MOCK_PATIENT_PASSWORD = "MockPatient1!"
        $env:COUNT = 10
        
        Write-Host "Executing: node scripts/run-early-warning-test.js" -ForegroundColor Gray
        & node scripts/run-early-warning-test.js
        
        $steps += "Early Warning Test Executed (10 patients)"
        Write-Host ""
        Write-Host "[OK] Early warning test complete" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  Early warning test error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "ℹ️  Skipping early warning test (backend not available yet)" -ForegroundColor Yellow
    Write-Host "    The backend will be ready shortly after Railway deployment" -ForegroundColor DarkGray
}

Write-Host ""

# ================================================================================
# PHASE 6: CHECK EARLY WARNING RESPONSE
# ================================================================================
Write-Host "[PHASE 6] Checking Early Warning Summary" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

if ($authToken) {
    try {
        Write-Host "Fetching early warning summary from Railway..." -ForegroundColor Yellow
        
        $ew = Invoke-RestMethod -Uri "$RAILWAY_BACKEND/api/patient/early-warning" `
            -Method GET `
            -Headers @{"Authorization" = "Bearer $authToken"} `
            -TimeoutSec 5 `
            -ErrorAction Stop
        
        Write-Host ""
        Write-Host "[RESPONSE] Early Warning Data:" -ForegroundColor Green
        Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
        
        if ($ew.data) {
            if ($ew.data.riskLevel) {
                $riskLevel = $ew.data.riskLevel
            } else {
                $riskLevel = "UNKNOWN"
            }
            $riskColor = switch ($riskLevel.ToUpper()) {
                "HIGH" { "Red" }
                "MODERATE" { "Yellow" }
                "LOW" { "Green" }
                default { "White" }
            }
            
            Write-Host "  Risk Level: " -NoNewline
            Write-Host "$riskLevel" -ForegroundColor $riskColor
            
            if ($ew.data.recommendations -and $ew.data.recommendations.Count -gt 0) {
                Write-Host "  Recommendations:" -ForegroundColor Green
                $ew.data.recommendations | ForEach-Object {
                    Write-Host "    • $_"
                }
            }
            
            if ($ew.data.fusion -and $ew.data.fusion.alert_triggered) {
                Write-Host "  ⚠️  ALERT: $($ew.data.fusion.alert_message)" -ForegroundColor $riskColor
            }
        }
        
        Write-Host ""
        $steps += "Early Warning Summary Retrieved"
    } catch {
        Write-Host "ℹ️  Early warning retrieval skipped (backend results not yet available)" -ForegroundColor Yellow
    }
} else {
    Write-Host "ℹ️  Skipping early warning summary check (not authenticated)" -ForegroundColor Yellow
}

Write-Host ""

# ================================================================================
# PHASE 7: PROVIDE BROWSER URLS
# ================================================================================
Write-Host "[PHASE 7] Dashboard Access URLs" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

Write-Host "📱 Open these URLs in your browser to view the demo:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1️⃣  Main Early Warning Dashboard:" -ForegroundColor Cyan
Write-Host "   $RAILWAY_FRONTEND/patient/early-warning" -ForegroundColor Green
Write-Host ""
Write-Host "2️⃣  Patient Dashboard (Live Metrics):" -ForegroundColor Cyan
Write-Host "   $RAILWAY_FRONTEND/patient/dashboard" -ForegroundColor Green
Write-Host ""
Write-Host "3️⃣  Backend API Health:" -ForegroundColor Cyan
Write-Host "   $RAILWAY_BACKEND/api/health" -ForegroundColor Green
Write-Host ""

$openBrowser = Read-Host "Open Early Warning dashboard in browser now? (y/n)"
if ($openBrowser -eq 'y' -or $openBrowser -eq 'Y') {
    Start-Process "$RAILWAY_FRONTEND/patient/early-warning"
    Write-Host "✅ Browser opened" -ForegroundColor Green
}

Write-Host ""

# ================================================================================
# PHASE 8: SUMMARY
# ================================================================================
$endTime = Get-Date
$duration = $endTime - $startTime

Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                    ✅ SETUP COMPLETE ✅                       ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

Write-Host "📋 Summary of Completed Steps:" -ForegroundColor Yellow
$steps | ForEach-Object { Write-Host "   ✓ $_" -ForegroundColor Green }
Write-Host ""
Write-Host "⏱️  Total setup time: $($duration.TotalSeconds.ToString("F1")) seconds" -ForegroundColor Gray
Write-Host ""

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "NEXT STEPS:" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. ✅ Backend URL configured" -ForegroundColor Green
Write-Host "   $RAILWAY_BACKEND" -ForegroundColor Gray
Write-Host ""
Write-Host "2. ✅ Mock patients seeded in Railway database" -ForegroundColor Green
Write-Host "   50 patients with 14 days of health history" -ForegroundColor Gray
Write-Host ""
Write-Host "3. 📊 View Early Warning Demo:" -ForegroundColor Cyan
Write-Host "   → Open: $RAILWAY_FRONTEND/patient/early-warning" -ForegroundColor Green
Write-Host ""
Write-Host "4. 🎯 What you'll see:" -ForegroundColor Cyan
Write-Host "   • Risk levels (GREEN / YELLOW / RED)" -ForegroundColor Gray
Write-Host "   • Health recommendations" -ForegroundColor Gray
Write-Host "   • Current biometrics" -ForegroundColor Gray
Write-Host "   • Early warning alerts" -ForegroundColor Gray
Write-Host ""
Write-Host "5. 🚀 Run parallel multi-user demo:" -ForegroundColor Cyan
Write-Host "   . .\demo-railway-production.ps1" -ForegroundColor Green
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

# Save configuration for future use
$config = @"
# Railway Early Warning Demo Configuration
# Generated: $(Get-Date)

`$RAILWAY_BACKEND = "$RAILWAY_BACKEND"
`$RAILWAY_FRONTEND = "$RAILWAY_FRONTEND"
`$MOCK_PASSWORD = "MockPatient1!"

# To use these settings:
# . .\railway-config.ps1
# 
"@

$config | Set-Content "railway-config.ps1"
Write-Host "💾 Configuration saved to: railway-config.ps1" -ForegroundColor Gray
Write-Host ""

Write-Host "✨ Early Warning Demo Setup Complete! ✨" -ForegroundColor Magenta
Write-Host ""
