# Early Warning Demo - Quick Reference

## 🚀 Start Here

### 1. Import the PowerShell module
```powershell
. .\demo-early-warning.ps1
```

You'll see the menu with all available commands.

---

## 📋 Common Scenarios

### Scenario A: Show Cardiovascular Risk (5 min)
```powershell
# Create patients + run demo
Setup-MockPatients -Count 100 -WithHistory
Demo-EarlyWarning -UserCount 50

# Check results
Get-PatientEarlyWarning -PatientEmail "patient_0001@mock.ahava.test"
```

**Expected Result:**
- Risk Level: HIGH or MODERATE (red/yellow alert)
- Shows cardiovascular risk warnings
- Recommendations for medical consultation

---

### Scenario B: Load Test (100s of Users)
```powershell
Setup-MockPatients -Count 1000 -WithHistory
Demo-LoadTest -UserCount 500 -Concurrency 50
```

**Expected Result:**
- Tests API under 500 concurrent user load
- Measures response times
- Shows platform scalability

---

### Scenario C: Single Patient Real-Time Demo (5 min)
```powershell
Demo-SinglePatientStream -DurationSeconds 300 -IntervalSeconds 30
```

**What It Does:**
- Simulates 100 days of health data in 5 minutes
- Readings submitted every 30 seconds
- Day 1-14: Normal baseline
- Day 15-99: Gradual stress accumulation
- Day 100+: Acute event detected

**Check Results:**
- Open: http://localhost:3000/patient/early-warning
- Watch risk level change in real-time

---

### Scenario D: Multiple Patients in Parallel
```powershell
Setup-MockPatients -Count 50
Demo-ParallelPatients -PatientCount 10
```

**What It Does:**
- 10 patients simultaneously stream demo data
- Each runs 60-second demo (6 days simulated)
- All streams run in parallel

---

## 🏥 Disease Scenarios in Early Warning

### Cardiovascular Alert Response
```
Health Status: 🔴 HIGH RISK
Recommendations:
  • Schedule cardiology consultation
  • Monitor blood pressure daily
  • Reduce physical stress
  • Consider stress management
```

**Triggers:**
- High Heart Rate (HR > 110)
- Low HRV (RMSSD < 30)
- Low SpO2 (< 92%)

---

### Viral Infection Alert Response
```
Health Status: 🟡 MODERATE RISK
Recommendations:
  • Rest and stay hydrated
  • Monitor temperature
  • Consult healthcare provider
```

**Triggers:**
- Temperature > 38°C
- Elevated respiratory rate (> 22)
- Low SpO2 (< 94%)
- Reduced activity

---

### Sleep Apnea Alert Response
```
Health Status: 🟡 MODERATE RISK
Recommendations:
  • Schedule sleep study
  • Elevate head while sleeping
  • Monitor pulse oximeter readings
```

**Triggers:**
- SpO2 < 89% during "sleep"
- Fragmented sleep (< 4 hours)
- Irregular ECG rhythm
- Elevated resting HR despite low activity

---

## 🎯 Monitoring While Demo Runs

Open 3 browser tabs:

1. **Patient Dashboard**
   - URL: http://localhost:3000/patient/dashboard
   - Shows real-time biometric submissions
   - Watch readings update as demo runs

2. **Early Warning Page**
   - URL: http://localhost:3000/patient/early-warning
   - Risk level and recommendations
   - Trend analysis

3. **API Health**
   - URL: http://localhost:4000/api/health
   - Verifies backend is running

---

## 📊 Data Flow During Simulation

```
Demo Stream Starts
    ↓
Generate biometric values for simulated day
    ↓
POST /api/patient/biometrics
    ↓
Backend saves to database
    ↓
ML Service analyzes (baseline + trends)
    ↓
Update risk scores & anomalies
    ↓
Frontend calls GET /api/patient/early-warning
    ↓
Display risk level & recommendations
```

---

## 🔍 Key Metrics Watched

| Metric | Normal | Alert ⚠️ | Critical 🔴 |
|--------|--------|----------|------------|
| Heart Rate (resting) | 60-80 | 85-100 | >110 |
| HRV (RMSSD) | >40 | 30-40 | <30 |
| SpO2 | 96-100% | 92-96% | <92% |
| Respiratory Rate | 12-18 | 18-22 | >22 |
| Temperature | 36.5-37.5°C | 37.5-38°C | >38°C |
| Sleep | 6-8h | 4-6h | <4h |

---

## ✅ Complete Multi-User Demo (Recommended)

Run this for a complete demonstration:

```powershell
run-fullDemo

# OR manually:
Setup-MockPatients -Count 100 -WithHistory
Demo-EarlyWarning -UserCount 20
Get-PatientEarlyWarning
Demo-ParallelPatients -PatientCount 5
```

Takes ~10-15 minutes total, demonstrates:
- ✅ Patient seeding at scale
- ✅ Anomaly detection (early warning)
- ✅ Multi-user concurrent streams
- ✅ Real-time risk assessment
- ✅ API performance under load

---

## 🐛 Troubleshooting

**"No alerts generated"**
```powershell
# Ensure ML service is running or check DB fallback
Get-PatientEarlyWarning
# Should show risk analysis data
```

**"Login failed"**
```powershell
# Verify mock patients exist
MOCK_PATIENT_COUNT=100 pnpm run seed:mock-patients

# Check password matches
$PASSWORD = "MockPatient1!"
```

**"Connection refused"**
```powershell
# Start backend
pnpm -F @ahava-healthcare/api dev

# Or production Railway
$env:BASE_URL = "https://ahava-api.up.railway.app"
```

---

## 📝 API Endpoints Reference

**Submit Biometric Reading**
```
POST /api/patient/biometrics
Headers: Authorization: Bearer {token}
Body: { heartRate, hrv_rmssd, oxygenSaturation, respiratoryRate, ... }
```

**Get Early Warning Summary**
```
GET /api/patient/early-warning
Headers: Authorization: Bearer {token}
Response: { riskLevel, recommendations, trendAnalysis, baselineMetrics, fusion }
```

**Start Demo Stream**
```
POST /api/patient/demo/start-stream?durationSeconds=300&intervalSeconds=30
Headers: Authorization: Bearer {token}
Response: { success: true, message, userId, durationSeconds }
```

**Get Patient Alerts**
```
GET /api/patient/alerts
Headers: Authorization: Bearer {token}
Response: { alerts: [...] }
```

---

## 📚 Documentation Files

- **EARLY_WARNING_DEMO_GUIDE.md** - Full comprehensive guide with all scenarios
- **demo-early-warning.ps1** - This PowerShell module with functions
- Run `.Show-Menu` to see all available commands

---

## 🎓 Learning Path

1. **Understand**: Read EARLY_WARNING_DEMO_GUIDE.md (Part 1-2)
2. **Setup**: Run `Setup-MockPatients`
3. **Try A**: `Demo-EarlyWarning` (simplest)
4. **Try B**: `Demo-SinglePatientStream` (real-time)
5. **Try C**: `Demo-ParallelPatients` (scale)
6. **Try D**: `Demo-LoadTest` (performance)
7. **Build**: Create custom scenario scripts

