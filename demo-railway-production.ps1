# Early Warning Demo - Railway Production Deployment Script
# Run this to demonstrate multi-user simulations on your production Railway deployment
# PSScriptAnalyzer suppress rules for demo scripts
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '')]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingConvertToSecureStringWithPlainText', '')]
param()

# ================================================
# RAILWAY PRODUCTION CONFIGURATION
# ================================================
$RAILWAY_BACKEND = "https://backend-production.up.railway.app"  # Update with your actual backend URL
$RAILWAY_FRONTEND = "https://frontend-production-326c.up.railway.app"
$MOCK_PASSWORD = "MockPatient1!"

Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  Early Warning Demo - Railway Production Deployment      ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "⚙️  Configuration:" -ForegroundColor Yellow
Write-Host "   Backend:  $RAILWAY_BACKEND" -ForegroundColor DarkGray
Write-Host "   Frontend: $RAILWAY_FRONTEND" -ForegroundColor DarkGray
Write-Host ""

# ================================================
# STEP 1: Seed 50 Mock Patients in Production
# ================================================
function Step-1-SeedPatients {
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host "STEP 1: Seed 50 Mock Patients in Production Database" -ForegroundColor Green
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "🌱 Creating 50 mock patients with 14-day history..." -ForegroundColor Yellow
    Write-Host "   This will run 'seed:mock-patients' in the backend app" -ForegroundColor DarkGray
    Write-Host ""
    
    # Note: This requires backend SSH access or running in backend container
    Write-Host "⚠️  IMPORTANT: This needs to run in the Railway backend container" -ForegroundColor Yellow
    Write-Host "   Option A (Recommended): Run in Railway console:" -ForegroundColor Cyan
    Write-Host "     cd apps/backend && MOCK_PATIENT_COUNT=50 MOCK_WITH_HISTORY=1 npm run seed:mock-patients" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "   Option B: Run locally, then deploy:" -ForegroundColor Cyan
    Write-Host "     MOCK_PATIENT_COUNT=50 MOCK_WITH_HISTORY=1 pnpm run seed:mock-patients" -ForegroundColor DarkGray
    Write-Host ""
    
    Read-Host "Press Enter once patients are seeded"
}

# ================================================
# STEP 2: Verify Patients
# ================================================
function Step-2-VerifyPatients {
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host "STEP 2: Verify Patient Setup" -ForegroundColor Green
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "🧪 Testing login as patient_0001..." -ForegroundColor Yellow
    
    try {
        $loginRes = Invoke-RestMethod -Uri "$RAILWAY_BACKEND/api/auth/login" `
            -Method POST `
            -Headers @{"Content-Type" = "application/json"} `
            -Body (@{
                email = "patient_0001@mock.ahava.test"
                password = $MOCK_PASSWORD
            } | ConvertTo-Json) `
            -ErrorAction Stop
        
        if ($loginRes.accessToken) {
            Write-Host "✅ Login successful!" -ForegroundColor Green
            Write-Host "   Token: $($loginRes.accessToken.Substring(0, 20))..." -ForegroundColor DarkGray
            return $loginRes.accessToken
        } else {
            Write-Host "❌ Login failed - no token returned" -ForegroundColor Red
            return $null
        }
    } catch {
        Write-Host "❌ Login error: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

# ================================================
# STEP 3: Run Early Warning Test (10 Users)
# ================================================
function Step-3-EarlyWarningTest {
    param([string]$Token)
    
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host "STEP 3: Run Early Warning Test (10 Users with Anomalies)" -ForegroundColor Green
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "⚠️  Running test against Railway backend..." -ForegroundColor Yellow
    Write-Host "   Each user: 15 normal readings + 1 anomalous" -ForegroundColor DarkGray
    Write-Host ""
    
    $env:BASE_URL = $RAILWAY_BACKEND
    $env:MOCK_PATIENT_PASSWORD = $MOCK_PASSWORD
    $env:COUNT = 10
    
    try {
        node scripts/run-early-warning-test.js
        Write-Host ""
        Write-Host "✅ Early warning test complete" -ForegroundColor Green
    } catch {
        Write-Host "❌ Test error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ================================================
# STEP 4: Check Patient Early Warning (Live)
# ================================================
function Step-4-CheckEarlyWarning {
    param([string]$Token)
    
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host "STEP 4: Check Early Warning Summary (Live from Railway)" -ForegroundColor Green
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host ""
    
    if (!$Token) {
        Write-Host "ℹ️  Getting fresh token..." -ForegroundColor Yellow
        $loginRes = Invoke-RestMethod -Uri "$RAILWAY_BACKEND/api/auth/login" `
            -Method POST `
            -Headers @{"Content-Type" = "application/json"} `
            -Body (@{
                email = "patient_0001@mock.ahava.test"
                password = $MOCK_PASSWORD
            } | ConvertTo-Json)
        
        $Token = $loginRes.accessToken
    }
    
    try {
        Write-Host "🔍 Fetching early warning from Railway backend..." -ForegroundColor Yellow
        
        $ew = Invoke-RestMethod -Uri "$RAILWAY_BACKEND/api/patient/early-warning" `
            -Method GET `
            -Headers @{"Authorization" = "Bearer $Token"} `
            -ErrorAction Stop
        
        Write-Host ""
        Write-Host "📊 Early Warning Summary" -ForegroundColor Cyan
        Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
        
        $riskLevel = if ($ew.data.riskLevel) { $ew.data.riskLevel } else { "UNKNOWN" }
        $alertLevel = if ($ew.data.alert_level) { $ew.data.alert_level } else { "UNKNOWN" }
        
        # Color code the risk level
        $riskColor = switch ($riskLevel.ToUpper()) {
            "HIGH" { "Red" }
            "MODERATE" { "Yellow" }
            "LOW" { "Green" }
            default { "White" }
        }
        
        Write-Host "  Risk Level: " -NoNewline
        Write-Host "$riskLevel" -ForegroundColor $riskColor
        
        Write-Host "  Alert Level: " -NoNewline
        Write-Host "$alertLevel" -ForegroundColor $riskColor
        
        if ($ew.data.recommendations) {
            Write-Host ""
            Write-Host "  Recommendations:" -ForegroundColor Green
            $ew.data.recommendations | ForEach-Object {
                Write-Host "    • $_"
            }
        }
        
        if ($ew.data.fusion.alert_triggered) {
            Write-Host ""
            Write-Host "  ⚠️  ALERT TRIGGERED:" -ForegroundColor Red
            Write-Host "     $($ew.data.fusion.alert_message)" -ForegroundColor Red
        }
        
        Write-Host ""
        Write-Host "✅ Early warning data retrieved successfully" -ForegroundColor Green
        
    } catch {
        Write-Host "❌ Error fetching early warning: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ================================================
# STEP 5: View in Browser Dashboard
# ================================================
function Step-5-ViewDashboard {
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "STEP 5: View Live Demo in Railway Dashboard" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host ""
    
    Write-Host "📱 Open these URLs in your browser:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "1️⃣  Patient Dashboard" -ForegroundColor Cyan
    Write-Host "   $RAILWAY_FRONTEND/patient/dashboard" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "2️⃣  Early Warning Page (Main Demo)" -ForegroundColor Cyan
    Write-Host "   $RAILWAY_FRONTEND/patient/early-warning" -ForegroundColor DarkGray
    Write-Host ""
    
    Write-Host "📊 What you'll see:" -ForegroundColor Yellow
    Write-Host "   ✓ Real-time patient data" -ForegroundColor DarkGray
    Write-Host "   ✓ Risk level (GREEN / YELLOW / RED)" -ForegroundColor DarkGray
    Write-Host "   ✓ Early warning alerts" -ForegroundColor DarkGray
    Write-Host "   ✓ Health recommendations" -ForegroundColor DarkGray
    Write-Host ""
    
    $openBrowser = Read-Host "Open in browser? (y/n)"
    if ($openBrowser -eq 'y') {
        Start-Process "$RAILWAY_FRONTEND/patient/early-warning"
    }
}

# ================================================
# STEP 6: Run Parallel Multi-User Demo
# ================================================
function Step-6-ParallelDemo {
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host "STEP 6: Run 5 Patients in Parallel (Live Streaming)" -ForegroundColor Green
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "👥 Starting demo streams for 5 patients in parallel..." -ForegroundColor Yellow
    Write-Host "   Each patient streams for 60 seconds" -ForegroundColor DarkGray
    Write-Host "   = 6 simulated days per patient" -ForegroundColor DarkGray
    Write-Host ""
    
    $jobs = @()
    
    for ($i = 1; $i -le 5; $i++) {
        $patientEmail = "patient_{0:0000}" -f $i
        $patientEmail += "@mock.ahava.test"
        
        $job = Start-Job -ScriptBlock {
            param($email, $pwd, $url)
            
            try {
                # Login
                $login = Invoke-RestMethod -Uri "$url/api/auth/login" `
                    -Method POST `
                    -Headers @{"Content-Type" = "application/json"} `
                    -Body (@{email = $email; password = $pwd} | ConvertTo-Json)
                
                if ($login.accessToken) {
                    # Start stream
                    Invoke-RestMethod -Uri "$url/api/patient/demo/start-stream?durationSeconds=60&intervalSeconds=10" `
                        -Method POST `
                        -Headers @{"Authorization" = "Bearer $($login.accessToken)"} | Out-Null
                    
                    return "✅ $email - Demo stream started"
                } else {
                    return "❌ $email - Login failed"
                }
            } catch {
                return "❌ $email - Error: $($_.Exception.Message)"
            }
        } -ArgumentList $patientEmail, $MOCK_PASSWORD, $RAILWAY_BACKEND
        
        $jobs += $job
    }
    
    Write-Host "⏳ Waiting for all streams to complete..." -ForegroundColor Yellow
    Write-Host ""
    
    $results = $jobs | Wait-Job | ForEach-Object { Receive-Job -Job $_ }
    $results | ForEach-Object {
        Write-Host $_
    }
    
    Write-Host ""
    Write-Host "✅ All parallel streams complete" -ForegroundColor Green
    Write-Host ""
    Write-Host "💡 TIP: Visit early warning page to see updated risk assessments" -ForegroundColor Cyan
}

# ================================================
# MAIN: Run Complete Demo Workflow
# ================================================
function Invoke-RailwayDemo {
    Write-Host "🚀 Starting Railway Production Early Warning Demo" -ForegroundColor Magenta
    Write-Host ""
    
    # Step 1: Seed patients
    Step-1-SeedPatients
    
    # Step 2: Verify
    $token = Step-2-VerifyPatients
    if (!$token) {
        Write-Host ""
        Write-Host "❌ Cannot proceed without valid login" -ForegroundColor Red
        return
    }
    
    # Step 3: Run early warning test
    Step-3-EarlyWarningTest -Token $token
    
    # Step 4: Check early warning
    Step-4-CheckEarlyWarning -Token $token
    
    # Step 5: View dashboard
    Step-5-ViewDashboard
    
    # Step 6: Parallel demo
    $runParallel = Read-Host ""
    Write-Host ""
    Write-Host "Run parallel multi-user demo? (y/n)"
    if ($runParallel -eq 'y') {
        Step-6-ParallelDemo
    }
    
    # Summary
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║           ✅ Railway Demo Complete! ✅                  ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
}

# Run the demo
Run-Railway-Demo
