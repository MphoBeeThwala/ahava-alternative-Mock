# Manual Testing Commands for Ahava Healthcare Platform

## Prerequisites

1. **Backend server must be running:**
   ```powershell
   pnpm --filter @ahava-healthcare/api dev
   ```
   Wait for: `🚀 Ahava Healthcare API server running on port 4000`

2. **Set base URL:**
   ```powershell
   $baseUrl = "http://localhost:4000/api"
   ```

---

## 1. Authentication Tests

### Register a Patient
```powershell
$patientData = @{
    email = "patient@test.com"
    password = "Test1234!"
    firstName = "John"
    lastName = "Patient"
    role = "PATIENT"
    phone = "+27123456789"
} | ConvertTo-Json

$patientReg = Invoke-RestMethod -Uri "$baseUrl/auth/register" -Method POST -Body $patientData -ContentType "application/json"
$patientToken = $patientReg.accessToken
Write-Host "Patient Token: $patientToken"
```

### Register a Nurse
```powershell
$nurseData = @{
    email = "nurse@test.com"
    password = "Test1234!"
    firstName = "Jane"
    lastName = "Nurse"
    role = "NURSE"
    phone = "+27123456790"
} | ConvertTo-Json

$nurseReg = Invoke-RestMethod -Uri "$baseUrl/auth/register" -Method POST -Body $nurseData -ContentType "application/json"
$nurseToken = $nurseReg.accessToken
Write-Host "Nurse Token: $nurseToken"
```

### Register a Doctor
```powershell
$doctorData = @{
    email = "doctor@test.com"
    password = "Test1234!"
    firstName = "Dr. Smith"
    lastName = "Doctor"
    role = "DOCTOR"
    phone = "+27123456791"
} | ConvertTo-Json

$doctorReg = Invoke-RestMethod -Uri "$baseUrl/auth/register" -Method POST -Body $doctorData -ContentType "application/json"
$doctorToken = $doctorReg.accessToken
Write-Host "Doctor Token: $doctorToken"
```

### Login (Patient)
```powershell
$loginData = @{
    email = "patient@test.com"
    password = "Test1234!"
} | ConvertTo-Json

$login = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method POST -Body $loginData -ContentType "application/json"
$patientToken = $login.accessToken
$patientHeaders = @{ "Authorization" = "Bearer $patientToken" }
Write-Host "Logged in successfully"
```

### Login (Nurse)
```powershell
$nurseLogin = @{
    email = "nurse@test.com"
    password = "Test1234!"
} | ConvertTo-Json

$nurseLoginRes = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method POST -Body $nurseLogin -ContentType "application/json"
$nurseToken = $nurseLoginRes.accessToken
$nurseHeaders = @{ "Authorization" = "Bearer $nurseToken" }
```

### Login (Doctor)
```powershell
$doctorLogin = @{
    email = "doctor@test.com"
    password = "Test1234!"
} | ConvertTo-Json

$doctorLoginRes = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method POST -Body $doctorLogin -ContentType "application/json"
$doctorToken = $doctorLoginRes.accessToken
$doctorHeaders = @{ "Authorization" = "Bearer $doctorToken" }
```

---

## 2. Patient Biometrics Tests

### Submit Manual Biometrics
```powershell
$biometricData = @{
    heartRate = 75
    heartRateResting = 65
    bloodPressure = @{
        systolic = 120
        diastolic = 80
    }
    oxygenSaturation = 98
    temperature = 36.5
    respiratoryRate = 16
    weight = 70
    height = 175
    source = "manual"
} | ConvertTo-Json -Depth 3

$bioResponse = Invoke-RestMethod -Uri "$baseUrl/patient/biometrics" -Method POST -Body $biometricData -ContentType "application/json" -Headers $patientHeaders
Write-Host "Alert Level: $($bioResponse.alertLevel)"
Write-Host "Readiness Score: $($bioResponse.readinessScore)"
```

### Submit Wearable Biometrics
```powershell
$wearableData = @{
    heartRate = 82
    heartRateResting = 68
    hrvRmssd = 45
    bloodPressure = @{
        systolic = 125
        diastolic = 82
    }
    oxygenSaturation = 97
    temperature = 36.7
    stepCount = 8500
    activeCalories = 350
    source = "wearable"
    deviceType = "apple_watch"
} | ConvertTo-Json -Depth 3

$wearableResponse = Invoke-RestMethod -Uri "$baseUrl/patient/biometrics" -Method POST -Body $wearableData -ContentType "application/json" -Headers $patientHeaders
```

### Get Biometric History
```powershell
$history = Invoke-RestMethod -Uri "$baseUrl/patient/biometrics/history" -Method GET -Headers $patientHeaders
Write-Host "Total readings: $($history.readings.Count)"
$history.readings | Format-Table -Property createdAt, alertLevel, readinessScore, heartRate, temperature
```

### Get Health Alerts
```powershell
$alerts = Invoke-RestMethod -Uri "$baseUrl/patient/alerts" -Method GET -Headers $patientHeaders
Write-Host "Active alerts: $($alerts.alerts.Count)"
$alerts.alerts | Format-Table -Property createdAt, alertLevel, title, resolved
```

### Get Monitoring Summary
```powershell
$summary = Invoke-RestMethod -Uri "$baseUrl/patient/monitoring/summary" -Method GET -Headers $patientHeaders
Write-Host "Status: $($summary.status)"
Write-Host "Baseline Established: $($summary.baselineEstablished)"
Write-Host "Current Readiness Score: $($summary.currentReadinessScore)"
Write-Host "Recent Alerts: $($summary.recentAlerts)"
Write-Host "Trend: $($summary.trend)"
```

---

## 3. Triage Tests

### Submit Triage Request (Text Only)
```powershell
$triageData = @{
    symptoms = "Headache, fever, and fatigue for 2 days"
} | ConvertTo-Json

$triage = Invoke-RestMethod -Uri "$baseUrl/patient/triage" -Method POST -Body $triageData -ContentType "application/json" -Headers $patientHeaders
Write-Host "Triage ID: $($triage.triageId)"
Write-Host "Priority: $($triage.priority)"
Write-Host "Recommendation: $($triage.recommendation)"
```

### Submit Triage with Biometrics
```powershell
$triageWithBio = @{
    symptoms = "Chest pain and shortness of breath"
    biometrics = @{
        heartRate = 95
        bloodPressure = @{
            systolic = 140
            diastolic = 90
        }
        oxygenSaturation = 94
        temperature = 37.8
    }
} | ConvertTo-Json -Depth 3

$triageBio = Invoke-RestMethod -Uri "$baseUrl/patient/triage" -Method POST -Body $triageWithBio -ContentType "application/json" -Headers $patientHeaders
```

---

## 4. Booking Tests

### Create a Booking
```powershell
# Prepare address (needs to be encrypted, using base64 for testing)
$addressJson = @{
    street = "123 Main Street"
    city = "Cape Town"
    province = "Western Cape"
    postalCode = "8001"
    country = "South Africa"
} | ConvertTo-Json -Compress

$encryptedAddress = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($addressJson))
$scheduledDate = (Get-Date).AddDays(7).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

$bookingData = @{
    encryptedAddress = $encryptedAddress
    scheduledDate = $scheduledDate
    estimatedDuration = 60
    paymentMethod = "CARD"
    amountInCents = 5000
    patientLat = -33.9249
    patientLng = 18.4241
} | ConvertTo-Json

$booking = Invoke-RestMethod -Uri "$baseUrl/bookings" -Method POST -Body $bookingData -ContentType "application/json" -Headers $patientHeaders
$bookingId = $booking.booking.id
Write-Host "Booking created: $bookingId"
Write-Host "Status: $($booking.booking.status)"
```

### Get Patient's Bookings
```powershell
$bookings = Invoke-RestMethod -Uri "$baseUrl/bookings" -Method GET -Headers $patientHeaders
Write-Host "Total bookings: $($bookings.bookings.Count)"
$bookings.bookings | Format-Table -Property id, scheduledDate, status, amountInCents
```

### Get Single Booking Details
```powershell
$bookingDetails = Invoke-RestMethod -Uri "$baseUrl/bookings/$bookingId" -Method GET -Headers $patientHeaders
$bookingDetails | ConvertTo-Json -Depth 5
```

---

## 5. Visit Management Tests (Nurse)

### Get Available Visits
```powershell
$availableVisits = Invoke-RestMethod -Uri "$baseUrl/nurse/visits/available" -Method GET -Headers $nurseHeaders
Write-Host "Available visits: $($availableVisits.visits.Count)"
```

### Create Visit from Booking
```powershell
$visitData = @{
    bookingId = $bookingId
} | ConvertTo-Json

$visit = Invoke-RestMethod -Uri "$baseUrl/visits" -Method POST -Body $visitData -ContentType "application/json" -Headers $nurseHeaders
$visitId = $visit.visit.id
Write-Host "Visit created: $visitId"
Write-Host "Status: $($visit.visit.status)"
```

### Update Visit Status (EN_ROUTE)
```powershell
$statusData = @{
    status = "EN_ROUTE"
} | ConvertTo-Json

Invoke-RestMethod -Uri "$baseUrl/visits/$visitId/status" -Method PATCH -Body $statusData -ContentType "application/json" -Headers $nurseHeaders
Write-Host "Visit status updated to EN_ROUTE"
```

### Update Visit Status (ARRIVED)
```powershell
$arrivedData = @{
    status = "ARRIVED"
} | ConvertTo-Json

Invoke-RestMethod -Uri "$baseUrl/visits/$visitId/status" -Method PATCH -Body $arrivedData -ContentType "application/json" -Headers $nurseHeaders
```

### Update Visit Status (IN_PROGRESS)
```powershell
$inProgressData = @{
    status = "IN_PROGRESS"
} | ConvertTo-Json

Invoke-RestMethod -Uri "$baseUrl/visits/$visitId/status" -Method PATCH -Body $inProgressData -ContentType "application/json" -Headers $nurseHeaders
```

### Record Biometrics During Visit
```powershell
$visitBiometricData = @{
    heartRate = 78
    heartRateResting = 70
    bloodPressure = @{
        systolic = 125
        diastolic = 82
    }
    oxygenSaturation = 97
    temperature = 36.8
    respiratoryRate = 18
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "$baseUrl/visits/$visitId/biometrics" -Method POST -Body $visitBiometricData -ContentType "application/json" -Headers $nurseHeaders
Write-Host "Biometrics recorded for visit"
```

### Record Treatment
```powershell
$treatmentData = @{
    medications = @("Paracetamol 500mg", "Ibuprofen 200mg")
    procedures = @("Blood pressure check", "Temperature measurement", "Physical examination")
    notes = "Patient responding well to treatment. Vitals stable."
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "$baseUrl/visits/$visitId/treatment" -Method POST -Body $treatmentData -ContentType "application/json" -Headers $nurseHeaders
Write-Host "Treatment recorded"
```

### Submit Nurse Report
```powershell
$reportData = @{
    observations = "Patient appears healthy. Vitals within normal range. No signs of distress."
    recommendations = "Continue current medication. Follow up in 1 week. Monitor temperature."
    nextSteps = "Schedule follow-up appointment. Patient to report any worsening symptoms."
} | ConvertTo-Json

Invoke-RestMethod -Uri "$baseUrl/visits/$visitId/report" -Method POST -Body $reportData -ContentType "application/json" -Headers $nurseHeaders
Write-Host "Nurse report submitted"
```

### Complete Visit
```powershell
$completeData = @{
    status = "COMPLETED"
} | ConvertTo-Json

Invoke-RestMethod -Uri "$baseUrl/visits/$visitId/status" -Method PATCH -Body $completeData -ContentType "application/json" -Headers $nurseHeaders
Write-Host "Visit completed"
```

### Get Visit Details
```powershell
$visitDetails = Invoke-RestMethod -Uri "$baseUrl/visits/$visitId" -Method GET -Headers $nurseHeaders
$visitDetails | ConvertTo-Json -Depth 5
```

---

## 6. Doctor Tests

### Get All Visits (Doctor View)
```powershell
$allVisits = Invoke-RestMethod -Uri "$baseUrl/visits" -Method GET -Headers $doctorHeaders
Write-Host "Total visits: $($allVisits.visits.Count)"
$allVisits.visits | Format-Table -Property id, status, createdAt, patientId
```

### Review Visit (Doctor)
```powershell
$visitReview = Invoke-RestMethod -Uri "$baseUrl/visits/$visitId" -Method GET -Headers $doctorHeaders
Write-Host "Visit Status: $($visitReview.visit.status)"
Write-Host "Has Biometrics: $($visitReview.visit.biometrics -ne $null)"
Write-Host "Has Treatment: $($visitReview.visit.treatment -ne $null)"
Write-Host "Has Nurse Report: $($visitReview.visit.nurseReport -ne $null)"
```

---

## 7. Payment Tests

### Get Payment Methods
```powershell
$paymentMethods = Invoke-RestMethod -Uri "$baseUrl/payments/methods" -Method GET -Headers $patientHeaders
```

### Create Payment Intent
```powershell
$paymentData = @{
    bookingId = $bookingId
    amountInCents = 5000
    paymentMethod = "CARD"
} | ConvertTo-Json

$payment = Invoke-RestMethod -Uri "$baseUrl/payments/intent" -Method POST -Body $paymentData -ContentType "application/json" -Headers $patientHeaders
Write-Host "Payment Intent ID: $($payment.intentId)"
```

---

## 8. Complete Test Flow

### Full End-to-End Test
```powershell
# 1. Register and Login
$baseUrl = "http://localhost:4000/api"
$patientData = @{ email = "test-$(Get-Random)@test.com"; password = "Test1234!"; firstName = "Test"; lastName = "User"; role = "PATIENT" } | ConvertTo-Json
$reg = Invoke-RestMethod -Uri "$baseUrl/auth/register" -Method POST -Body $patientData -ContentType "application/json"
$token = $reg.accessToken
$headers = @{ "Authorization" = "Bearer $token" }

# 2. Submit Biometrics
$bio = @{ heartRate = 75; bloodPressure = @{ systolic = 120; diastolic = 80 }; oxygenSaturation = 98; temperature = 36.5; source = "manual" } | ConvertTo-Json -Depth 3
$bioRes = Invoke-RestMethod -Uri "$baseUrl/patient/biometrics" -Method POST -Body $bio -ContentType "application/json" -Headers $headers
Write-Host "✅ Biometrics: $($bioRes.alertLevel) - Score: $($bioRes.readinessScore)"

# 3. Create Booking
$addr = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('{"street":"123 Main","city":"Cape Town","province":"WC","postalCode":"8001"}'))
$booking = @{
    encryptedAddress = $addr
    scheduledDate = (Get-Date).AddDays(7).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    estimatedDuration = 60
    paymentMethod = "CARD"
    amountInCents = 5000
    patientLat = -33.9249
    patientLng = 18.4241
} | ConvertTo-Json
$bookingRes = Invoke-RestMethod -Uri "$baseUrl/bookings" -Method POST -Body $booking -ContentType "application/json" -Headers $headers
Write-Host "✅ Booking created: $($bookingRes.booking.id)"

# 4. Get History
$history = Invoke-RestMethod -Uri "$baseUrl/patient/biometrics/history" -Method GET -Headers $headers
Write-Host "✅ History: $($history.readings.Count) readings"

Write-Host "`n✅ All tests passed!"
```

---

## Quick Reference

### Common Variables Setup
```powershell
$baseUrl = "http://localhost:4000/api"
$patientHeaders = @{ "Authorization" = "Bearer $patientToken" }
$nurseHeaders = @{ "Authorization" = "Bearer $nurseToken" }
$doctorHeaders = @{ "Authorization" = "Bearer $doctorToken" }
```

### Check Server Status
```powershell
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method GET -TimeoutSec 2
    Write-Host "✅ Server is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Server is not responding" -ForegroundColor Red
}
```

### View Response as JSON
```powershell
$response | ConvertTo-Json -Depth 10
```

### View Response in Table Format
```powershell
$response.data | Format-Table
```

---

## Troubleshooting

### If you get "401 Unauthorized"
- Check that your token is valid
- Re-login to get a fresh token
- Verify the Authorization header format: `Bearer <token>`

### If you get "400 Bad Request"
- Check the request body format matches the API schema
- Verify all required fields are included
- Check date formats (use ISO 8601: `yyyy-MM-ddTHH:mm:ss.fffZ`)

### If you get "404 Not Found"
- Verify the endpoint URL is correct
- Check that the server is running
- Ensure the route exists in the API

### If you get "500 Internal Server Error"
- Check server logs in the terminal where backend is running
- Verify database connection
- Check environment variables are set correctly

---

## Notes

- All dates should be in ISO 8601 format (UTC)
- Addresses must be encrypted (base64 for testing, proper encryption in production)
- Tokens expire after 1 hour - re-login if needed
- The ML service is optional - system works with fallback mode

