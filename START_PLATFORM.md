# Starting and Testing the Ahava Healthcare Platform

## Quick Start Commands

### 1. Start Backend Server

```powershell
# From project root
pnpm --filter @ahava-healthcare/api dev
```

Or in a separate terminal:
```powershell
cd apps/backend
pnpm dev
```

The server will start on `http://localhost:4000`

### 2. Start ML Service (Optional but Recommended)

```powershell
# In a new terminal
cd apps/ml-service
pip install -r requirements.txt
python main.py
```

The ML service will start on `http://localhost:8000`

### 3. Verify Services are Running

```powershell
# Check backend
curl http://localhost:4000/api/health

# Check ML service (if started)
curl http://localhost:8000/
```

## Testing the Platform

### Step 1: Register Users

#### Register a Patient
```powershell
$patientData = @{
    email = "patient@test.com"
    password = "Test1234!"
    firstName = "John"
    lastName = "Patient"
    role = "PATIENT"
    phone = "+27123456789"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/auth/register" -Method POST -Body $patientData -ContentType "application/json"
```

#### Register a Nurse
```powershell
$nurseData = @{
    email = "nurse@test.com"
    password = "Test1234!"
    firstName = "Jane"
    lastName = "Nurse"
    role = "NURSE"
    phone = "+27123456790"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/auth/register" -Method POST -Body $nurseData -ContentType "application/json"
```

#### Register a Doctor
```powershell
$doctorData = @{
    email = "doctor@test.com"
    password = "Test1234!"
    firstName = "Dr. Smith"
    lastName = "Doctor"
    role = "DOCTOR"
    phone = "+27123456791"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/auth/register" -Method POST -Body $doctorData -ContentType "application/json"
```

### Step 2: Login and Get Tokens

#### Login as Patient
```powershell
$loginData = @{
    email = "patient@test.com"
    password = "Test1234!"
} | ConvertTo-Json

$patientResponse = Invoke-RestMethod -Uri "http://localhost:4000/api/auth/login" -Method POST -Body $loginData -ContentType "application/json"
$patientToken = $patientResponse.accessToken
Write-Host "Patient Token: $patientToken"
```

#### Login as Nurse
```powershell
$nurseLogin = @{
    email = "nurse@test.com"
    password = "Test1234!"
} | ConvertTo-Json

$nurseResponse = Invoke-RestMethod -Uri "http://localhost:4000/api/auth/login" -Method POST -Body $nurseLogin -ContentType "application/json"
$nurseToken = $nurseResponse.accessToken
Write-Host "Nurse Token: $nurseToken"
```

#### Login as Doctor
```powershell
$doctorLogin = @{
    email = "doctor@test.com"
    password = "Test1234!"
} | ConvertTo-Json

$doctorResponse = Invoke-RestMethod -Uri "http://localhost:4000/api/auth/login" -Method POST -Body $doctorLogin -ContentType "application/json"
$doctorToken = $doctorResponse.accessToken
Write-Host "Doctor Token: $doctorToken"
```

### Step 3: Test Patient Features

#### Submit Biometrics (as Patient)
```powershell
$headers = @{
    "Authorization" = "Bearer $patientToken"
}

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
    source = "manual"
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "http://localhost:4000/api/patient/biometrics" -Method POST -Body $biometricData -ContentType "application/json" -Headers $headers
```

#### Get Biometric History
```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/patient/biometrics/history" -Method GET -Headers $headers
```

#### Get Health Alerts
```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/patient/alerts" -Method GET -Headers $headers
```

#### Get Monitoring Summary
```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/patient/monitoring/summary" -Method GET -Headers $headers
```

#### Submit Triage Request
```powershell
$triageData = @{
    symptoms = "Headache and fever for 2 days"
    biometrics = @{
        heartRate = 85
        temperature = 38.2
        bloodPressure = @{
            systolic = 130
            diastolic = 85
        }
    }
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "http://localhost:4000/api/patient/triage" -Method POST -Body $triageData -ContentType "application/json" -Headers $headers
```

### Step 4: Test Booking System

#### Create a Booking (as Patient)
```powershell
$bookingData = @{
    preferredDate = "2024-02-15"
    preferredTime = "10:00"
    reason = "Routine checkup"
    address = @{
        street = "123 Main St"
        city = "Cape Town"
        province = "Western Cape"
        postalCode = "8001"
        country = "South Africa"
    }
    paymentMethod = "CARD"
} | ConvertTo-Json -Depth 3

$booking = Invoke-RestMethod -Uri "http://localhost:4000/api/bookings" -Method POST -Body $bookingData -ContentType "application/json" -Headers $headers
Write-Host "Booking ID: $($booking.booking.id)"
$bookingId = $booking.booking.id
```

#### Get Patient's Bookings
```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/bookings" -Method GET -Headers $headers
```

### Step 5: Test Visit Management (as Nurse)

#### Get Available Visits
```powershell
$nurseHeaders = @{
    "Authorization" = "Bearer $nurseToken"
}

Invoke-RestMethod -Uri "http://localhost:4000/api/nurse/visits/available" -Method GET -Headers $nurseHeaders
```

#### Create Visit from Booking
```powershell
$visitData = @{
    bookingId = $bookingId
} | ConvertTo-Json

$visit = Invoke-RestMethod -Uri "http://localhost:4000/api/visits" -Method POST -Body $visitData -ContentType "application/json" -Headers $nurseHeaders
Write-Host "Visit ID: $($visit.visit.id)"
$visitId = $visit.visit.id
```

#### Update Visit Status
```powershell
$statusData = @{
    status = "EN_ROUTE"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/visits/$visitId/status" -Method PATCH -Body $statusData -ContentType "application/json" -Headers $nurseHeaders
```

#### Record Biometrics During Visit
```powershell
$visitBiometricData = @{
    heartRate = 78
    bloodPressure = @{
        systolic = 125
        diastolic = 82
    }
    oxygenSaturation = 97
    temperature = 36.8
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "http://localhost:4000/api/visits/$visitId/biometrics" -Method POST -Body $visitBiometricData -ContentType "application/json" -Headers $nurseHeaders
```

#### Record Treatment
```powershell
$treatmentData = @{
    medications = @("Paracetamol 500mg", "Ibuprofen 200mg")
    procedures = @("Blood pressure check", "Temperature measurement")
    notes = "Patient responding well to treatment"
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "http://localhost:4000/api/visits/$visitId/treatment" -Method POST -Body $treatmentData -ContentType "application/json" -Headers $nurseHeaders
```

#### Submit Nurse Report
```powershell
$reportData = @{
    observations = "Patient appears healthy, vitals within normal range"
    recommendations = "Continue current medication, follow up in 1 week"
    nextSteps = "Schedule follow-up appointment"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/visits/$visitId/report" -Method POST -Body $reportData -ContentType "application/json" -Headers $nurseHeaders
```

#### Complete Visit
```powershell
$completeData = @{
    status = "COMPLETED"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/visits/$visitId/status" -Method PATCH -Body $completeData -ContentType "application/json" -Headers $nurseHeaders
```

### Step 6: Test Doctor Features

#### Get All Visits (as Doctor)
```powershell
$doctorHeaders = @{
    "Authorization" = "Bearer $doctorToken"
}

Invoke-RestMethod -Uri "http://localhost:4000/api/visits" -Method GET -Headers $doctorHeaders
```

#### Get Visit Details
```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/visits/$visitId" -Method GET -Headers $doctorHeaders
```

### Step 7: Test Admin Features

#### Get All Users (requires ADMIN role)
```powershell
# First, you'd need to create an admin user or promote a user to admin
# This typically requires database access or a special endpoint

$adminHeaders = @{
    "Authorization" = "Bearer $adminToken"
}

Invoke-RestMethod -Uri "http://localhost:4000/api/admin/users" -Method GET -Headers $adminHeaders
```

## Complete Test Script

Save this as `test-platform.ps1`:

```powershell
# Ahava Healthcare Platform Test Script
$baseUrl = "http://localhost:4000/api"

Write-Host "=== Ahava Healthcare Platform Test ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Register Patient
Write-Host "1. Registering Patient..." -ForegroundColor Yellow
$patientData = @{
    email = "patient-$(Get-Random)@test.com"
    password = "Test1234!"
    firstName = "John"
    lastName = "Patient"
    role = "PATIENT"
} | ConvertTo-Json

$patientReg = Invoke-RestMethod -Uri "$baseUrl/auth/register" -Method POST -Body $patientData -ContentType "application/json"
$patientToken = $patientReg.accessToken
Write-Host "   ✅ Patient registered: $($patientReg.user.email)" -ForegroundColor Green

# Step 2: Login Patient
Write-Host "2. Logging in Patient..." -ForegroundColor Yellow
$loginData = @{
    email = $patientReg.user.email
    password = "Test1234!"
} | ConvertTo-Json

$login = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method POST -Body $loginData -ContentType "application/json"
$patientToken = $login.accessToken
Write-Host "   ✅ Patient logged in" -ForegroundColor Green

# Step 3: Submit Biometrics
Write-Host "3. Submitting Biometrics..." -ForegroundColor Yellow
$headers = @{ "Authorization" = "Bearer $patientToken" }
$bioData = @{
    heartRate = 75
    heartRateResting = 65
    bloodPressure = @{ systolic = 120; diastolic = 80 }
    oxygenSaturation = 98
    temperature = 36.5
    source = "manual"
} | ConvertTo-Json -Depth 3

$bio = Invoke-RestMethod -Uri "$baseUrl/patient/biometrics" -Method POST -Body $bioData -ContentType "application/json" -Headers $headers
Write-Host "   ✅ Biometrics submitted - Alert: $($bio.alertLevel), Score: $($bio.readinessScore)" -ForegroundColor Green

# Step 4: Create Booking
Write-Host "4. Creating Booking..." -ForegroundColor Yellow
$bookingData = @{
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

$booking = Invoke-RestMethod -Uri "$baseUrl/bookings" -Method POST -Body $bookingData -ContentType "application/json" -Headers $headers
Write-Host "   ✅ Booking created: $($booking.booking.id)" -ForegroundColor Green

Write-Host ""
Write-Host "=== Test Complete ===" -ForegroundColor Cyan
Write-Host "✅ Platform is working!" -ForegroundColor Green
```

Run it with:
```powershell
.\test-platform.ps1
```

## Environment Variables

Make sure your `.env` file in `apps/backend` has:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/ahava_healthcare"

# JWT
JWT_SECRET="your-secret-key-here"
JWT_REFRESH_SECRET="your-refresh-secret-here"

# Encryption
ENCRYPTION_KEY="your-32-character-encryption-key"
ENCRYPTION_IV_SALT="your-iv-salt"

# ML Service (optional)
ML_SERVICE_URL="http://localhost:8000"

# Redis (optional, for queues)
REDIS_URL="redis://localhost:6379"

# Server
PORT=4000
NODE_ENV=development
```

## Troubleshooting

### Server won't start
- Check if port 4000 is available
- Verify database connection in `.env`
- Check Redis connection if using queues

### Authentication fails
- Verify JWT secrets are set in `.env`
- Check token expiration (default: 1 hour)

### ML Service errors
- ML service is optional - system works without it
- Check `ML_SERVICE_URL` in `.env` if you want to use it

### Database errors
- Ensure PostgreSQL is running
- Run migrations: `pnpm --filter @ahava-healthcare/api prisma:migrate dev`

