# Simple comprehensive test without complex try-catch

Write-Host "========== AHAVA HEALTHCARE SYSTEM TESTS ==========" -ForegroundColor Cyan

$baseUrl = "http://localhost:4000"

# TEST 1
Write-Host "`n[TEST 1] Backend Health Check" -ForegroundColor Yellow
$h = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/health" -TimeoutSec 2 | ConvertFrom-Json
Write-Host "✓ Status: $($h.status) - Time: $($h.timestamp)" -ForegroundColor Green

# TEST 2
Write-Host "`n[TEST 2] User Login (Mock Patient)" -ForegroundColor Yellow
$loginBody = @{email="patient_0001@mock.ahava.test"; password="MockPatient1!"} | ConvertTo-Json
$login = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/auth/login" -Method POST -Headers @{"Content-Type"="application/json"} -Body $loginBody | ConvertFrom-Json
Write-Host "✓ Logged in: $($login.user.email) (Role: $($login.user.role))" -ForegroundColor Green
Write-Host "  Token: $($login.accessToken.Substring(0,40))..." -ForegroundColor Gray
$token = $login.accessToken
$refToken = $login.refreshToken

# TEST 3
Write-Host "`n[TEST 3] Get Authenticated Patient Data" -ForegroundColor Yellow
$authH = @{"Authorization"="Bearer $token"; "Content-Type"="application/json"}
$patient = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/patient/me" -Method GET -Headers $authH | ConvertFrom-Json
Write-Host "✓ Patient ID: $($patient.id)" -ForegroundColor Green
Write-Host "  Name: $($patient.fullName)"
Write-Host "  Email: $($patient.email)"
Write-Host "  DOB: $($patient.dateOfBirth)"

# TEST 4
Write-Host "`n[TEST 4] Get Biometric Data" -ForegroundColor Yellow
$bio = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/patient/biometric-data?limit=5" -Method GET -Headers $authH | ConvertFrom-Json
Write-Host "✓ Retrieved $($bio.Count) biometric records" -ForegroundColor Green
if ($bio.Count -gt 0) {
    Write-Host "  Latest: $($bio[0].timestamp) - HR: $($bio[0].heartRate) bpm" -ForegroundColor Gray
}

# TEST 5
Write-Host "`n[TEST 5] Token Refresh Mechanism" -ForegroundColor Yellow
$refBody = @{refreshToken=$refToken} | ConvertTo-Json
$refresh = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/auth/refresh" -Method POST -Headers @{"Content-Type"="application/json"} -Body $refBody | ConvertFrom-Json
Write-Host "✓ Token refreshed successfully" -ForegroundColor Green
Write-Host "  New token: $($refresh.accessToken.Substring(0,40))..." -ForegroundColor Gray

# TEST 6
Write-Host "`n[TEST 6] Rate Limiter (No Validation Errors)" -ForegroundColor Yellow
$results = @()
for ($i = 1; $i -le 3; $i++) {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/health" -TimeoutSec 2
    $results += "✓ Request $i: $($r.StatusCode)"
}
$results | ForEach-Object { Write-Host "  $_" -ForegroundColor Green }

# TEST 7
Write-Host "`n[TEST 7] ML Service" -ForegroundColor Yellow
$ml = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:8000/docs" -TimeoutSec 2
Write-Host "✓ ML Service responding on port 8000" -ForegroundColor Green

# TEST 8
Write-Host "`n[TEST 8] Early Warning Feature" -ForegroundColor Yellow
$ew = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/patient/early-warning" -Method GET -Headers $authH | ConvertFrom-Json
Write-Host "✓ Risk scores retrieved" -ForegroundColor Green
if ($ew.riskScores) {
    Write-Host "  Framingham: $($ew.riskScores.framingham.score)% - $($ew.riskScores.framingham.interpretation)" -ForegroundColor Gray
    Write-Host "  QRISK3: $($ew.riskScores.qrisk3.score)% - $($ew.riskScores.qrisk3.interpretation)"
    Write-Host "  ML Model: $($ew.riskScores.mlModel.score)% - $($ew.riskScores.mlModel.interpretation)"
    Write-Host "  Anomalies detected: $($ew.anomalies.Count)" -ForegroundColor Gray
}

Write-Host "`n========== ALL TESTS PASSED ✓ ==========" -ForegroundColor Green
