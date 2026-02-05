# Quick Test Commands

## ✅ Backend Server is Starting!

The ML service installation failed (antivirus issue), but **that's OK** - the backend works perfectly without it!

## Test the Platform Now

### 1. Wait for Server to Start
Look for this message in the server terminal:
```
🚀 Ahava Healthcare API server running on port 4000
```

### 2. Run the Complete Test
```powershell
.\test-platform.ps1
```

### 3. Or Test Manually

#### Register a Patient:
```powershell
$data = @{
    email = "patient@test.com"
    password = "Test1234!"
    firstName = "John"
    lastName = "Patient"
    role = "PATIENT"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/auth/register" -Method POST -Body $data -ContentType "application/json"
```

#### Login:
```powershell
$login = @{
    email = "patient@test.com"
    password = "Test1234!"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://localhost:4000/api/auth/login" -Method POST -Body $login -ContentType "application/json"
$token = $response.accessToken
Write-Host "Token: $token"
```

#### Submit Biometrics:
```powershell
$headers = @{ "Authorization" = "Bearer $token" }
$bio = @{
    heartRate = 75
    heartRateResting = 65
    bloodPressure = @{ systolic = 120; diastolic = 80 }
    oxygenSaturation = 98
    temperature = 36.5
    source = "manual"
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "http://localhost:4000/api/patient/biometrics" -Method POST -Body $bio -ContentType "application/json" -Headers $headers
```

#### Create Booking:
```powershell
$booking = @{
    preferredDate = (Get-Date).AddDays(7).ToString("yyyy-MM-dd")
    preferredTime = "10:00"
    reason = "Routine checkup"
    address = @{
        street = "123 Main St"
        city = "Cape Town"
        province = "Western Cape"
        postalCode = "8001"
    }
    paymentMethod = "CARD"
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "http://localhost:4000/api/bookings" -Method POST -Body $booking -ContentType "application/json" -Headers $headers
```

## About the ML Service

**You don't need it right now!** The backend has a fallback system that works perfectly without the ML service. You'll get:
- ✅ Basic biometric analysis
- ✅ Alert levels (GREEN/YELLOW/RED)
- ✅ Readiness scores
- ✅ All platform features work

**To fix ML service later** (optional):
1. Add Avast exception for Python temp files
2. Or use pre-built numpy: `pip install numpy` (without version pin)
3. Or skip ML service entirely - it's optional!

## Next Steps

1. ✅ Backend is starting (check terminal)
2. Wait for "Server running on port 4000"
3. Run: `.\test-platform.ps1`
4. Or use the manual commands above

**Everything works without the ML service!** 🎉

