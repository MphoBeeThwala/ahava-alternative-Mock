# Early Warning Service - Multi-User Simulation & Disease Scenario Guide

## Overview
The Ahava platform supports simulating **multiple users simultaneously** with realistic biometric progression and disease scenarios detectable through early warning analysis.

---

## Part 1: Simulate Multiple Users at the Same Time

### Option A: Load Test (Hundreds of Concurrent Users)

This script simulates 1000 users performing the full patient pipeline in parallel (login → submit biometrics → get alerts → get history).

```bash
# Default: 1000 users, 20 concurrent requests
node scripts/load-test-patient-pipeline.js

# Custom: 500 users, 50 concurrent requests
BASE_URL=http://localhost:4000 COUNT=500 CONCURRENCY=50 node scripts/load-test-patient-pipeline.js

# For production Railway deployment
BASE_URL=https://ahava-api.up.railway.app COUNT=100 CONCURRENCY=10 node scripts/load-test-patient-pipeline.js
```

**Output**: Aggregated statistics for login, biometrics submission, alerts retrieval, and history retrieval across all users.

---

### Option B: Early Warning Test (Multiple Users with Anomalies)

This script creates a controlled test where multiple users each experience a health event:
- Days 1-15: Normal baseline readings
- Day 16: Anomalous reading (triggers alert)
- Verifies alert detection across all users

```bash
# Default: 50 users
node scripts/run-early-warning-test.js

# Custom: 100 users with custom backend
BASE_URL=http://localhost:4000 MOCK_PATIENT_PASSWORD=MockPatient1! COUNT=100 node scripts/run-early-warning-test.js

# For production
BASE_URL=https://ahava-api.up.railway.app COUNT=50 node scripts/run-early-warning-test.js
```

**Output**: Summary showing how many users triggered alerts.

---

### Option C: Seed Mock Patients First (Foundation)

Before running tests, seed a large number of patients:

```bash
# Create 1000 mock patients with 14 days of biometric history each
MOCK_PATIENT_COUNT=1000 MOCK_WITH_HISTORY=1 pnpm run seed:mock-patients

# Create 500 mock patients marked for early warning testing
MOCK_PATIENT_COUNT=500 MOCK_EARLY_WARNING_COUNT=100 pnpm run seed:mock-patients
```

Then run load tests, early warning tests, or demo streams against them.

---

## Part 2: Simulate Disease Scenarios

### Disease 1: Cardiovascular Risk (CVD) - Progressive Heart Stress

**Detection Markers:**
- ↑ Heart Rate (above normal baseline)
- ↓ Heart Rate Variability (HRV) - low variation indicates stress
- ↓ SpO2 (oxygen saturation drops)
- ↑ Respiratory Rate (compensatory)

**How to Simulate:**

1. **Via API - Manual Anomalous Reading**

```bash
# Login as patient
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"patient_0001@mock.ahava.test","password":"MockPatient1!"}'

# Submit CVD-indicative reading (high HR, low HRV, low SpO2)
curl -X POST http://localhost:4000/api/patient/biometrics \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "heartRate": 115,
    "heartRateResting": 108,
    "hrvRmssd": 28,
    "oxygenSaturation": 91,
    "respiratoryRate": 24,
    "stepCount": 500,
    "activeCalories": 30,
    "source": "wearable",
    "deviceType": "demo"
  }'
```

2. **Via Demo Stream - Automatic Progression**

The demo stream gradually escalates readings over a simulated 100-day period:
- **Days 1-14**: Stable baseline
- **Days 15-99**: Gradual stress accumulation (HR↑, HRV↓, SpO2↓)
- **Day 100+**: Acute event (dramatic deterioration)

```bash
# Trigger demo stream for logged-in patient (5 minutes = 100 days simulated)
curl -X POST "http://localhost:4000/api/patient/demo/start-stream?durationSeconds=300&intervalSeconds=30" \
  -H "Authorization: Bearer <TOKEN>"
```

**Results**: Early warning page shows:
- Risk Level: YELLOW or RED
- Alert messages about cardiovascular stress
- Framingham/QRISK3 risk scores elevated

---

### Disease 2: Viral Infection / Respiratory Illness

**Detection Markers:**
- ↑ Temperature (fever)
- ↑ Heart Rate (body fighting infection)
- ↓ SpO2 (respiratory involvement)
- ↑ Respiratory Rate (labored breathing)

**How to Simulate:**

```json
{
  "heartRate": 108,
  "heartRateResting": 105,
  "hrvRmssd": 32,
  "oxygenSaturation": 93,
  "respiratoryRate": 22,
  "temperature": 38.5,
  "stepCount": 200,
  "activeCalories": 50,
  "sleepDurationHours": 5.5,
  "source": "wearable",
  "deviceType": "viral_simulation"
}
```

**Markers Detected:**
- Respiratory rate elevation
- Temperature spike
- Reduced activity (low step count)
- Poor sleep quality

---

### Disease 3: Sleep Apnea / Respiratory Sleep Disorder

**Detection Markers:**
- ↓ SpO2 during sleep (dips below 95%)
- ↑ Heart Rate during sleep periods
- ↓ Sleep Duration (fragmented sleep)
- ↑ Temperature Trend (body struggling)

**How to Simulate:**

```json
{
  "heartRate": 92,
  "heartRateResting": 88,
  "hrvRmssd": 25,
  "oxygenSaturation": 89,
  "respiratoryRate": 20,
  "sleepDurationHours": 3.5,
  "stepCount": 1000,
  "activeCalories": 80,
  "ecgRhythm": "irregular",
  "temperatureTrend": "elevated_single_day",
  "source": "wearable",
  "deviceType": "sleep_disorder_sim"
}
```

**Markers Detected:**
- Irregular ECG rhythm
- SpO2 severely low
- Fragmented sleep
- High resting heart rate

---

### Disease 4: Diabetes / Metabolic Syndrome

**Detection Markers:**
- ↑ Resting Heart Rate (metabolic stress)
- ↑ Active Calories burned (inefficient energy utilization)
- ↓ Sleep Quality (poor metabolic recovery)
- ↓ HRV (autonomic dysfunction)

**How to Simulate:**

```json
{
  "heartRate": 98,
  "heartRateResting": 92,
  "hrvRmssd": 22,
  "oxygenSaturation": 96,
  "respiratoryRate": 18,
  "stepCount": 2000,
  "activeCalories": 420,
  "sleepDurationHours": 5.0,
  "source": "wearable",
  "deviceType": "metabolic_sim"
}
```

**Markers Detected:**
- Elevated resting heart rate
- Low HRV (autonomic dysfunction)
- Poor sleep recovery
- High caloric demand

---

## Part 3: Complete Multi-Patient Demo Workflow

### Step 1: Seed Patients with Disease Profiles

```bash
# Create 1000 patients with 14-day history for demo
MOCK_PATIENT_COUNT=1000 MOCK_WITH_HISTORY=1 pnpm run seed:mock-patients
```

### Step 2: Create Specific Disease Scenarios

Create a Node.js script `scripts/demo-disease-scenarios.js`:

```javascript
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const PASSWORD = 'MockPatient1!';

// Disease scenario definitions
const scenarios = {
  cardiovascular: {
    name: 'Cardiovascular Risk - Progressive Heart Stress',
    readings: [
      { HR: 75, HRV: 48, SpO2: 98, RR: 16, day: 1 },  // Normal
      { HR: 82, HRV: 42, SpO2: 97, RR: 17, day: 10 }, // Mild stress
      { HR: 95, HRV: 35, SpO2: 95, RR: 20, day: 20 }, // Moderate stress
      { HR: 115, HRV: 28, SpO2: 91, RR: 24, day: 30 } // Alert threshold
    ]
  },
  viral: {
    name: 'Viral Infection - Respiratory Illness',
    readings: [
      { HR: 72, Temp: 37.0, RR: 16, SpO2: 98, day: 1 },
      { HR: 92, Temp: 38.2, RR: 19, SpO2: 94, day: 5 },
      { HR: 108, Temp: 38.8, RR: 23, SpO2: 91, day: 7 }
    ]
  },
  sleepApnea: {
    name: 'Sleep Apnea - Respiratory Disorder',
    readings: [
      { HR: 88, SpO2: 96, Sleep: 7.5, HRV: 44, day: 1 },
      { HR: 94, SpO2: 92, Sleep: 4.0, HRV: 28, day: 10 },
      { HR: 96, SpO2: 88, Sleep: 3.5, HRV: 25, day: 20 }
    ]
  }
};

// Run multi-patient scenario
async function runDiseaseScenario(patientCount, scenarioName) {
  console.log(`\n🏥 Simulating ${scenarioName} across ${patientCount} patients\n`);
  
  for (let i = 1; i <= patientCount; i++) {
    const email = `patient_${String(i).padStart(4, '0')}@mock.ahava.test`;
    
    // Login
    const login = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD })
    }).then(r => r.json());
    
    if (!login.accessToken) {
      console.error(`❌ Login failed for ${email}`);
      continue;
    }
    
    const token = login.accessToken;
    
    // Submit scenario readings
    const scenario = scenarios[scenarioName];
    for (const reading of scenario.readings) {
      await fetch(`${BASE_URL}/api/patient/biometrics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          heartRate: reading.HR || 72,
          heartRateResting: (reading.HR || 72) - 5,
          hrvRmssd: reading.HRV || 45,
          oxygenSaturation: reading.SpO2 || 98,
          respiratoryRate: reading.RR || 16,
          temperature: reading.Temp || 37.0,
          sleepDurationHours: reading.Sleep || 7,
          stepCount: 5000,
          activeCalories: 180,
          source: 'demo',
          deviceType: `scenario_${scenarioName}`
        })
      });
    }
    
    if (i % 10 === 0) console.log(`✓ Processed ${i}/${patientCount} patients`);
  }
  
  console.log(`✅ ${scenarioName} simulation complete for ${patientCount} patients\n`);
}

// Run all scenarios
async function main() {
  await runDiseaseScenario(50, 'cardiovascular');
  await runDiseaseScenario(50, 'viral');
  await runDiseaseScenario(50, 'sleepApnea');
}

main().catch(console.error);
```

Run it:
```bash
node scripts/demo-disease-scenarios.js
```

### Step 3: Monitor Early Warnings

```bash
# Get early warning summary for a patient
curl http://localhost:4000/api/patient/early-warning \
  -H "Authorization: Bearer <TOKEN>"

# Get all alerts
curl http://localhost:4000/api/patient/alerts \
  -H "Authorization: Bearer <TOKEN>"
```

### Step 4: View in Dashboard

Navigate to: `http://localhost:3000/patient/early-warning`

You'll see:
- **Health Status** card showing risk level (GREEN/YELLOW/RED)
- **Recommendations** specific to detected conditions
- **Trend Analysis** showing progression patterns
- **Current Biometrics** with anomaly flags
- **Alerts** for critical findings

---

## Part 4: Advanced Multi-User Simulation Commands

### Load Test with Disease Distribution

```bash
# Simulate 1000 users with realistic baseline + 1 anomalous event each
COUNT=1000 CONCURRENCY=50 node scripts/run-early-warning-test.js
```

### Continuous Monitoring (Demo Stream)

```bash
# For patients dashboard during investor demo:
# - Each patient streams realistically over 5 minutes
# - Multiple patients can stream in parallel
# - Uses WebSocket for real-time updates (if enabled)

curl -X POST "http://localhost:4000/api/patient/demo/start-stream" \
  -H "Authorization: Bearer <TOKEN>"
```

### Parallel API Simulation (30 patients simultaneously)

```bash
# PowerShell (Windows)
$tokens = @()
1..30 | ForEach-Object {
  $resp = Invoke-RestMethod -Uri 'http://localhost:4000/api/auth/login' `
    -Method POST `
    -ContentType 'application/json' `
    -Body (@{email="patient_$('{0:000}' -f $_)@mock.ahava.test"; password='MockPatient1!'} | ConvertTo-Json)
  $tokens += $resp.accessToken
}

# Submit anomalous readings in parallel
$tokens | ForEach-Object -Parallel {
  Invoke-RestMethod -Uri 'http://localhost:4000/api/patient/biometrics' `
    -Method POST `
    -Headers @{Authorization="Bearer $_"} `
    -ContentType 'application/json' `
    -Body @{
      heartRate=115
      hrvRmssd=28
      oxygenSaturation=91
      respiratoryRate=24
      stepCount=500
      activeCalories=30
    } | ConvertTo-Json
} -ThrottleLimit 10
```

---

## Part 5: Real-Time Monitoring Dashboard

While simulations run, monitor in real-time:

1. **Patient Dashboard**
   - URL: `http://localhost:3000/patient/dashboard`
   - Shows live biometric submissions

2. **Early Warning Page**
   - URL: `http://localhost:3000/patient/early-warning`
   - Shows calculated risk levels and recommendations

3. **Server Logs**
   - Check `[DEMO DAY N]` entries for simulation progress
   - Watch for `[API] Early warning error` to catch issues

4. **ML Service Logs** (if running)
   - Watch for ML model predictions
   - Risk score calculations

---

## Part 6: Expected Early Warning Responses

### Cardiovascular Alert
```json
{
  "riskLevel": "HIGH",
  "alert_level": "RED",
  "fusion": {
    "alert_triggered": true,
    "alert_message": "Elevated cardiovascular risk detected. Consult healthcare provider."
  },
  "recommendations": [
    "Schedule cardiology consultation",
    "Reduce physical stress",
    "Monitor blood pressure daily",
    "Consider stress management techniques"
  ]
}
```

### Viral Infection Alert
```json
{
  "riskLevel": "MODERATE",
  "alert_level": "YELLOW",
  "fusion": {
    "alert_triggered": true,
    "alert_message": "Potential infection detected (elevated temperature, HR, RR)"
  },
  "recommendations": [
    "Rest and stay hydrated",
    "Monitor temperature",
    "Consult healthcare provider if symptoms persist",
    "Consider professional evaluation"
  ]
}
```

### Normal Response
```json
{
  "riskLevel": "LOW",
  "alert_level": "GREEN",
  "fusion": {
    "alert_triggered": false
  },
  "recommendations": [
    "Maintain current health habits",
    "Continue regular biometric monitoring"
  ]
}
```

---

## Troubleshooting

**No alerts generated?**
- Ensure ML service has 14+ days of baseline readings
- Check backend fallback thresholds are reasonable
- Review anomaly detection logic in `services/monitoring.ts`

**Multiple users failing?**
- Check database connection pool size
- Verify N+1 query issues
- Monitor memory/CPU during load tests

**Inconsistent risk levels?**
- Ensure ML service is available (not falling back to DB-only)
- Check that all services use same thresholds
- Verify patient risk profiles are set correctly

