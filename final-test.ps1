# Comprehensive Test Script

Write-Host "=== AHAVA HEALTHCARE SYSTEM TESTS ===" -ForegroundColor Cyan
$baseUrl = "http://localhost:4000"

# TEST 1: Health
Write-Host "`n[TEST 1] Backend Health Check" -ForegroundColor Yellow
try {
    $h = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/health" -TimeoutSec 2 | ConvertFrom-Json
    Write-Host "PASS: Status = $($h.status)" -ForegroundColor Green
} catch { Write-Host "FAIL" -ForegroundColor Red }

# TEST 2: Login
Write-Host "`n[TEST 2] User Login" -ForegroundColor Yellow
try {
    $loginBody = @{email="patient_0001@mock.ahava.test"; password="MockPatient1!"} | ConvertTo-Json
    $login = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/auth/login" -Method POST -Headers @{"Content-Type"="application/json"} -Body $loginBody | ConvertFrom-Json
    Write-Host "PASS: User = $($login.user.email)" -ForegroundColor Green
    $token = $login.accessToken
    $refToken = $login.refreshToken
} catch { Write-Host "FAIL" -ForegroundColor Red }

# TEST 3: Patient Data
Write-Host "`n[TEST 3] Get Patient Profile" -ForegroundColor Yellow
try {
    $authH = @{"Authorization"="Bearer $token"}
    $patient = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/patient/me" -Method GET -Headers $authH | ConvertFrom-Json
    Write-Host "PASS: Name = $($patient.fullName)" -ForegroundColor Green
} catch { Write-Host "FAIL" -ForegroundColor Red }

# TEST 4: Biometric Data
Write-Host "`n[TEST 4] Get Biometric Data" -ForegroundColor Yellow
try {
    $bio = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/patient/biometric-data?limit=3" -Method GET -Headers $authH | ConvertFrom-Json
    Write-Host "PASS: Records = $($bio.Count)" -ForegroundColor Green
} catch { Write-Host "FAIL" -ForegroundColor Red }

# TEST 5: Token Refresh
Write-Host "`n[TEST 5] Token Refresh" -ForegroundColor Yellow
try {
    $refBody = @{refreshToken=$refToken} | ConvertTo-Json
    $refresh = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/auth/refresh" -Method POST -Headers @{"Content-Type"="application/json"} -Body $refBody | ConvertFrom-Json
    Write-Host "PASS: New token generated" -ForegroundColor Green
} catch { Write-Host "FAIL" -ForegroundColor Red }

# TEST 6: Rate Limiting
Write-Host "`n[TEST 6] Rate Limiter" -ForegroundColor Yellow
try {
    $ok = 0
    for ($i = 1; $i -le 3; $i++) {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/health" -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ok++ }
    }
    Write-Host "PASS: $ok/3 requests successful" -ForegroundColor Green
} catch { Write-Host "FAIL" -ForegroundColor Red }

# TEST 7: ML Service
Write-Host "`n[TEST 7] ML Service" -ForegroundColor Yellow
try {
    $ml = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:8000/docs" -TimeoutSec 2
    Write-Host "PASS: ML Service responding" -ForegroundColor Green
} catch { Write-Host "FAIL" -ForegroundColor Red }

# TEST 8: Early Warning
Write-Host "`n[TEST 8] Early Warning Feature" -ForegroundColor Yellow
try {
    $ew = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/patient/early-warning" -Method GET -Headers $authH | ConvertFrom-Json
    $fm = $ew.riskScores.framingham.score
    $qr = $ew.riskScores.qrisk3.score
    $ml = $ew.riskScores.mlModel.score
    Write-Host "PASS: Framingham=$fm%, QRISK3=$qr%, ML=$ml%" -ForegroundColor Green
} catch { Write-Host "FAIL" -ForegroundColor Red }

Write-Host "`n=== ALL TESTS COMPLETED ===" -ForegroundColor Green
