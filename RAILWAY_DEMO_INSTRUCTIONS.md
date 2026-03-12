# Running Early Warning Demo on Railway Production

## 🎯 Quick Start

### Step 0: Get Your Railway URLs

The production URLs are shown in your Railway dashboard. Find them by:

1. Go to: https://railway.app/project/[your-project-id]
2. Click **Backend** service → find **Public URL**
3. Click **Frontend** service → find **Public URL**

They typically look like:
- Backend: `https://ahava-api-production.up.railway.app` or `https://backend-production-xxx.up.railway.app`
- Frontend: `https://frontend-production-326c.up.railway.app` (you already know this one)

### Step 1: Update the Production Script

Edit `demo-railway-production.ps1`:

Find this section at the top:
```powershell
$RAILWAY_BACKEND = "https://backend-production.up.railway.app"  # UPDATE THIS
$RAILWAY_FRONTEND = "https://frontend-production-326c.up.railway.app"
```

Replace `https://backend-production.up.railway.app` with your actual backend URL.

### Step 2: Seed Mock Patients in Production Database

This is the critical step. You have two options:

#### Option A: Seed in Railway Console (Recommended)

1. Go to Railway dashboard → Backend service
2. Click **"Deploy"** tab
3. Click **"View Logs"** → **"Console"**
4. Run:
```bash
cd apps/backend && MOCK_PATIENT_COUNT=50 MOCK_WITH_HISTORY=1 npm run seed:mock-patients
```

Wait for it to complete, then return to PowerShell.

#### Option B: Seed Locally and Deploy

1. Run locally:
```powershell
MOCK_PATIENT_COUNT=50 MOCK_WITH_HISTORY=1 pnpm run seed:mock-patients
```

2. Commit and push to trigger Railway redeploy:
```powershell
git add -A
git commit -m "Seed mock patients for demo"
git push origin main
```

3. Wait for Railway build to complete.

### Step 3: Run the Demo Script

```powershell
. .\demo-railway-production.ps1
```

The script will:
1. ✅ Verify 50 mock patients can log in
2. ✅ Run early warning test (15 readings each)
3. ✅ Display live risk assessments
4. ✅ Open early warning dashboard
5. ✅ Stream 5 patients in parallel

---

## 📊 What You'll See

### In the Terminal (PowerShell)
```
Step 1: Seed 50 Mock Patients ✓
Step 2: Verify Patient Setup ✓
  ✅ Login successful!
Step 3: Run Early Warning Test (10 Users with Anomalies) ✓
Step 4: Check Early Warning Summary (Live from Railway) ✓
  Risk Level: HIGH
  Alert Level: RED
  ⚠️ ALERT TRIGGERED: Elevated cardiovascular risk
Step 5: Start 5 Patients in Parallel ✓
```

### In the Browser (Railway Production)

**URL:** `https://frontend-production-326c.up.railway.app/patient/early-warning`

You'll see:
```
Health Status: 🔴 HIGH RISK
Recommendations:
  • Schedule cardiology consultation
  • Monitor blood pressure daily
  • Reduce physical stress
  • Consider stress management techniques

Current Biometrics:
  Heart Rate (resting): 108 bpm
  HRV (RMSSD): 28 ms
  Blood Oxygen: 91%
  Respiratory Rate: 24 /min
```

---

## 🚀 Full Command Reference

### Option 1: Fully Automated (Best for Demo)

```powershell
# Step 1: Make sure seed is done in Railway console
# Step 2: Update backend URL in script  
# Step 3: Run complete demo
. .\demo-railway-production.ps1
```

### Option 2: Manual Steps

```powershell
# Seed patients
MOCK_PATIENT_COUNT=50 MOCK_WITH_HISTORY=1 pnpm run seed:mock-patients

# Run early warning test only
$env:BASE_URL = "https://your-actual-backend-url.up.railway.app"
$env:MOCK_PATIENT_PASSWORD = "MockPatient1!"
$env:COUNT = 10
node scripts/run-early-warning-test.js
```

### Option 3: Real-Time Streaming (Showcase)

```powershell
# Get token for patient_0001
$login = Invoke-RestMethod -Uri "https://your-backend-url/api/auth/login" `
  -Method POST `
  -Headers @{"Content-Type"="application/json"} `
  -Body @{email="patient_0001@mock.ahava.test"; password="MockPatient1!"} | ConvertTo-Json

$token = $login.accessToken

# Start 5-minute demo stream
Invoke-RestMethod -Uri "https://your-backend-url/api/patient/demo/start-stream?durationSeconds=300&intervalSeconds=30" `
  -Method POST `
  -Headers @{"Authorization"="Bearer $token"}

# Open dashboard to watch in real-time
Start-Process "https://frontend-production-326c.up.railway.app/patient/early-warning"
```

---

## ⚙️ Troubleshooting

### "Login failed"
- ❌ Patients not seeded in production database
- ✅ Solution: Run Step 2 (seed in Railway console)

### "Connection refused"
- ❌ Backend URL is wrong
- ✅ Solution: Verify backend URL in Railway dashboard

### "No alerts generated"
- ❌ Anomalies not detected
- ✅ Solution: Check ML service is running
- ✅ Or check backend fallback thresholds are active

### "Early warning page shows 'No biometric data'"
- ❌ Reading submissions didn't save
- ✅ Solution: Retry the demo after a few seconds
- ✅ Or check database connection in Railway logs

---

## 📱 URLs for Your Demo

**Production Frontend Early Warning Demo:**
```
https://frontend-production-326c.up.railway.app/patient/early-warning
```

**Production Backend API:**
```
https://your-backend-url/api/patient/early-warning
```

**Patient Dashboard (Live Metrics):**
```
https://frontend-production-326c.up.railway.app/patient/dashboard
```

---

## 🎓 What's Being Demonstrated

1. **Multi-User Simulation**: 50 patients seeded simultaneously
2. **Early Warning Detection**: Algorithm detects health anomalies
3. **Cardiovascular Risk**: Progressive stress detection over 100 days
4. **Real-Time Updates**: Live data streaming to the dashboard
5. **Parallel Processing**: 5+ concurrent patient streams
6. **Production Scale**: Full system running on Railway

---

## ✅ Success Criteria

Demo is successful when you see:

✅ 50 mock patients created in production database  
✅ Patients can log in and access early warning page  
✅ Early warning test runs without errors  
✅ Dashboard shows risk levels (GREEN/YELLOW/RED)  
✅ Recommendations appear based on detected conditions  
✅ Real-time streaming updates the page  
✅ Multiple patients processing in parallel  

---

## 📝 Next Steps After Demo

1. **Investors**: Share the URLs showing real-time multi-patient monitoring
2. **Monitoring**: Track system performance under load
3. **Feedback**: Collect UX/UI feedback via dashboard
4. **Integration**: Connect to actual wearable device APIs
5. **Scaling**: Test with 1000+ concurrent patients

---

## 🔗 Helpful Links

- Railway Dashboard: https://railway.app
- Your Frontend: https://frontend-production-326c.up.railway.app
- Backend Logs: Railway → Backend → Deploy → View Logs
- API Docs: [Backend API Documentation]

