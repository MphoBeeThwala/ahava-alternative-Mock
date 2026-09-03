# Early Warning Multi-User Simulation Script
# Quick reference for common demo scenarios

# PSScriptAnalyzer suppress rules for demo scripts
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '')]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingConvertToSecureStringWithPlainText', '')]
param()

# ==============================================
# 1. SETUP: Seed 1000 mock patients with history
# ==============================================
function Invoke-MockPatientSetup {
    param(
        [int]$Count = 1000,
        [switch]$WithHistory
    )
    
    Write-Host "🌱 Creating $Count mock patients..." -ForegroundColor Green
    
    if ($WithHistory) {
        $env:MOCK_PATIENT_COUNT = $Count
        $env:MOCK_WITH_HISTORY = "1"
    } else {
        $env:MOCK_PATIENT_COUNT = $Count
    }
    
    pnpm run seed:mock-patients
    Write-Host "✅ Patients created" -ForegroundColor Green
}

# ==============================================
# 2. DEMO A: Load Test (100s of concurrent users)
# ==============================================
function Invoke-LoadTest {
    param(
        [int]$UserCount = 100,
        [int]$Concurrency = 10,
        [string]$BaseUrl = "http://localhost:4000"
    )
    
    Write-Host "🚀 Running load test with $UserCount users (concurrency: $Concurrency)..." -ForegroundColor Cyan
    
    $env:BASE_URL = $BaseUrl
    $env:MOCK_PATIENT_PASSWORD = "MockPatient1!"
    $env:COUNT = $UserCount
    $env:CONCURRENCY = $Concurrency
    
    node scripts/load-test-patient-pipeline.js
}

# ==============================================
# 3. DEMO B: Early Warning Test (Anomalies)
# ==============================================
function Invoke-EarlyWarningDemo {
    param(
        [int]$UserCount = 50,
        [string]$BaseUrl = "http://localhost:4000"
    )
    
    Write-Host "⚠️  Running early warning test with $UserCount users..." -ForegroundColor Cyan
    Write-Host "  • First 15 readings: normal baseline" -ForegroundColor DarkCyan
    Write-Host "  • Reading 16: anomalous (high HR, low SpO2)" -ForegroundColor DarkCyan
    Write-Host "  • Checks: alert detection & response" -ForegroundColor DarkCyan
    
    $env:BASE_URL = $BaseUrl
    $env:MOCK_PATIENT_PASSWORD = "MockPatient1!"
    $env:COUNT = $UserCount
    
    node scripts/run-early-warning-test.js
}

# ==============================================
# 4. DEMO C: Single Patient Demo Stream
# ==============================================
function Invoke-SinglePatientStream {
    param(
        [string]$PatientEmail = "patient_0001@mock.ahava.test",
        [string]$Password = "MockPatient1!",
        [int]$DurationSeconds = 300,
        [int]$IntervalSeconds = 30,
        [string]$BaseUrl = "http://localhost:4000"
    )
    
    Write-Host "👤 Starting demo stream for one patient..." -ForegroundColor Cyan
    Write-Host "  Patient: $PatientEmail" -ForegroundColor DarkCyan
    Write-Host "  Duration: ${DurationSeconds}s (= 100 simulated days)" -ForegroundColor DarkCyan
    Write-Host "  Reading every: ${IntervalSeconds}s" -ForegroundColor DarkCyan
    
    # Login
    $loginRes = Invoke-RestMethod -Uri "$BaseUrl/api/auth/login" `
        -Method POST `
        -Headers @{"Content-Type" = "application/json"} `
        -Body (@{
            email = $PatientEmail
            password = $Password
        } | ConvertTo-Json)
    
    if (-not $loginRes.accessToken) {
        Write-Host "❌ Login failed" -ForegroundColor Red
        return
    }
    
    $token = $loginRes.accessToken
    Write-Host "✅ Logged in" -ForegroundColor Green
    
    # Start stream
    $streamRes = Invoke-RestMethod -Uri "$BaseUrl/api/patient/demo/start-stream?durationSeconds=$DurationSeconds&intervalSeconds=$IntervalSeconds" `
        -Method POST `
        -Headers @{"Authorization" = "Bearer $token"}
    
    Write-Host "✅ Demo stream started" -ForegroundColor Green
    Write-Host "📊 Check Early Warning page: http://localhost:3000/patient/early-warning" -ForegroundColor Yellow
    
    # Wait for stream to complete
    Start-Sleep -Seconds ($DurationSeconds + 5)
    
    Write-Host "✅ Stream complete" -ForegroundColor Green
}

# ==============================================
# 5. DEMO D: Multiple Patients in Parallel
# ==============================================
function Invoke-ParallelPatients {
    param(
        [int]$PatientCount = 10,
        [string]$BaseUrl = "http://localhost:4000",
        [string]$Password = "MockPatient1!"
    )
    
    Write-Host "👥 Starting demo streams for $PatientCount patients in parallel..." -ForegroundColor Cyan
    
    $jobs = @()
    
    for ($i = 1; $i -le $PatientCount; $i++) {
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
                    
                    return "✅ $email"
                } else {
                    return "❌ $email"
                }
            } catch {
                return "❌ $email (error)"
            }
        } -ArgumentList $patientEmail, $Password, $BaseUrl
        
        $jobs += $job
    }
    
    Write-Host "⏳ Waiting for all streams to complete..." -ForegroundColor Yellow
    
    $results = $jobs | Wait-Job | ForEach-Object { Receive-Job -Job $_ }
    $results | ForEach-Object { Write-Host $_ }
    
    Write-Host "✅ All parallel streams complete" -ForegroundColor Green
}

# ==============================================
# 6. CHECK: Get Early Warning for Patient
# ==============================================
function Get-PatientEarlyWarning {
    param(
        [string]$PatientEmail = "patient_0001@mock.ahava.test",
        [string]$Password = "MockPatient1!",
        [string]$BaseUrl = "http://localhost:4000"
    )
    
    # Login
    $loginRes = Invoke-RestMethod -Uri "$BaseUrl/api/auth/login" `
        -Method POST `
        -Headers @{"Content-Type" = "application/json"} `
        -Body (@{
            email = $PatientEmail
            password = $Password
        } | ConvertTo-Json)
    
    if (-not $loginRes.accessToken) {
        Write-Host "❌ Login failed" -ForegroundColor Red
        return
    }
    
    $token = $loginRes.accessToken
    
    # Get early warning
    $ew = Invoke-RestMethod -Uri "$BaseUrl/api/patient/early-warning" `
        -Method GET `
        -Headers @{"Authorization" = "Bearer $token"}
    
    Write-Host "📊 Early Warning Summary for $PatientEmail" -ForegroundColor Cyan
    $riskLevelDisplay = if ($ew.data.riskLevel) { $ew.data.riskLevel } else { 'N/A' }
    $alertLevelDisplay = if ($ew.data.alert_level) { $ew.data.alert_level } else { 'N/A' }
    Write-Host "  Risk Level: $riskLevelDisplay" -ForegroundColor Yellow
    Write-Host "  Alert Level: $alertLevelDisplay" -ForegroundColor Yellow
    
    if ($ew.data.recommendations) {
        Write-Host "  Recommendations:" -ForegroundColor Green
        $ew.data.recommendations | ForEach-Object { Write-Host "    • $_" }
    }
    
    if ($ew.data.fusion.alert_triggered) {
        Write-Host "  ⚠️  ALERT: $($ew.data.fusion.alert_message)" -ForegroundColor Red
    }
    
    Write-Host ""
    Write-Host $ew | ConvertTo-Json -Depth 3
}

# ==============================================
# 7. FULL DEMO: Complete Workflow
# ==============================================
function Invoke-FullDemo {
    Write-Host "🎬 Starting Full Early Warning Demo" -ForegroundColor Magenta
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkMagenta
    
    Write-Host ""
    Write-Host "Step 1: Seed 100 mock patients..." -ForegroundColor Cyan
    Setup-MockPatients -Count 100 -WithHistory
    
    Write-Host ""
    Write-Host "Step 2: Run early warning test..." -ForegroundColor Cyan
    Demo-EarlyWarning -UserCount 20
    
    Write-Host ""
    Write-Host "Step 3: Check early warning for sample patient..." -ForegroundColor Cyan
    Get-PatientEarlyWarning
    
    Write-Host ""
    Write-Host "Step 4: Start 5 parallel demo streams..." -ForegroundColor Cyan
    Demo-ParallelPatients -PatientCount 5
    
    Write-Host ""
    Write-Host "✅ Full demo complete!" -ForegroundColor Green
    Write-Host "📊 Open dashboard: http://localhost:3000/patient/dashboard" -ForegroundColor Yellow
    Write-Host "⚠️  Open early warning: http://localhost:3000/patient/early-warning" -ForegroundColor Yellow
}

# ==============================================
# QUICK START MENU
# ==============================================
function Show-Menu {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
    Write-Host "║     Early Warning Multi-User Simulation Demo Menu        ║" -ForegroundColor Magenta
    Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "Setup:" -ForegroundColor Yellow
    Write-Host "  1) Setup-MockPatients -Count 1000 -WithHistory" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Demos:" -ForegroundColor Yellow
    Write-Host "  2) Demo-LoadTest -UserCount 100 -Concurrency 10" -ForegroundColor DarkGray
    Write-Host "  3) Demo-EarlyWarning -UserCount 50" -ForegroundColor DarkGray
    Write-Host "  4) Demo-SinglePatientStream -DurationSeconds 300" -ForegroundColor DarkGray
    Write-Host "  5) Demo-ParallelPatients -PatientCount 10" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Monitoring:" -ForegroundColor Yellow
    Write-Host "  6) Get-PatientEarlyWarning" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Complete:" -ForegroundColor Yellow
    Write-Host "  7) Run-FullDemo" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Cyan
    Write-Host "  # Quick 5-minute demo with 50 users + anomalies" -ForegroundColor DarkCyan
    Write-Host "  Demo-EarlyWarning -UserCount 50" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  # Load test 1000 concurrent users, 50 at a time" -ForegroundColor DarkCyan
    Write-Host "  Demo-LoadTest -UserCount 1000 -Concurrency 50" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  # Stream one patient over 5 minutes (100 simulated days)" -ForegroundColor DarkCyan
    Write-Host "  Demo-SinglePatientStream -DurationSeconds 300" -ForegroundColor DarkGray
    Write-Host ""
}

# Export functions
Export-ModuleMember -Function Setup-MockPatients, Demo-LoadTest, Demo-EarlyWarning, Demo-SinglePatientStream, Demo-ParallelPatients, Get-PatientEarlyWarning, Run-FullDemo, Show-Menu

# Show menu on import
Show-Menu
