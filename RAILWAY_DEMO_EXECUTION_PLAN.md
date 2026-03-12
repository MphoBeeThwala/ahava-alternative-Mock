# 🚀 Railway Early Warning Demo - Complete Execution Plan

## ✅ READY TO GO - Follow These 5 Steps

---

## **STEP 1: Find Your Railway Backend URL** (5 minutes)

### Option A: Using the Helper Script (Easiest)
```powershell
. .\find-railway-urls.ps1
```

This will guide you to find and verify your Railway URLs.

### Option B: Manual Method
1. Open: https://railway.app/dashboard
2. Click your project → **Backend** service
3. Look for a **"Public URL"** field
4. Copy it (will be something like `https://backend-production-xxx.up.railway.app`)

**Save this URL!** You'll need it in Step 2.

---

## **STEP 2: Update the Demo Script** (2 minutes)

Edit `demo-railway-production.ps1`:

Find line 5-6:
```powershell
$RAILWAY_BACKEND = "https://backend-production.up.railway.app"  # UPDATE THIS
$RAILWAY_FRONTEND = "https://frontend-production-326c.up.railway.app"
```

Replace with your actual URLs:
```powershell
$RAILWAY_BACKEND = "https://your-actual-backend-url.up.railway.app"
$RAILWAY_FRONTEND = "https://frontend-production-326c.up.railway.app"
```

**Save the file!**

---

## **STEP 3: Seed Mock Patients in Railway** (10 minutes)

You need to populate the production database with test patients.

### Option A: Railway Console (Quickest)
1. Go to: https://railway.app/dashboard
2. Click your project → **Backend** service
3. Click **"Deploy"** tab → **"View Logs"** button
4. Click **"Console"** tab
5. Paste this command:
   ```bash
   cd apps/backend && MOCK_PATIENT_COUNT=50 MOCK_WITH_HISTORY=1 npm run seed:mock-patients
   ```
6. Press Enter and wait for completion (~2 minutes)
7. You'll see: `✅ Patients created` when done

### Option B: Local Seed + Deploy
```powershell
# Run locally
MOCK_PATIENT_COUNT=50 MOCK_WITH_HISTORY=1 pnpm run seed:mock-patients

# Commit and push (triggers Railway rebuild)
git add -A
git commit -m "Seed 50 mock patients for demo"
git push origin main

# Wait 3-5 minutes for Railway to rebuild and deploy
```

---

## **STEP 4: Run the Railway Demo** (5 minutes)

In PowerShell, in the project root directory:

```powershell
. .\demo-railway-production.ps1
```

The script will automatically:
- ✅ Verify patients can log in
- ✅ Run early warning test across multiple users  
- ✅ Display live risk assessments
- ✅ Open the dashboard in your browser
- ✅ Stream 5 patients in parallel

**Just follow the interactive prompts!**

---

## **STEP 5: View Results in Browser** (Real-time)

While the script runs, open:

### Primary Demo URL:
```
https://frontend-production-326c.up.railway.app/patient/early-warning
```

You'll see:
- 🟢 **GREEN** (Normal) → Low risk
- 🟡 **YELLOW** (Caution) → Moderate risk  
- 🔴 **RED** (Alert) → High cardiovascular risk

### Secondary Dashboard:
```
https://frontend-production-326c.up.railway.app/patient/dashboard
```

Shows real-time biometric data as it streams.

---

## 📊 What the Demo Will Show

### In Terminal:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1: Seed 50 Mock Patients
✅ Press Enter (patients seeded in Railway)

STEP 2: Verify Patient Setup  
✅ Login successful!

STEP 3: Run Early Warning Test (10 Users)
✅ Early warning test complete

STEP 4: Check Early Warning Summary
📊 Early Warning Summary for patient_0001@mock.ahava.test
   Risk Level: HIGH
   Alert Level: RED
   ⚠️ ALERT: Elevated cardiovascular risk detected
   
STEP 5: Parallel Multi-User Demo (5 Patients)
✅ patient_0001 - Demo stream started
✅ patient_0002 - Demo stream started
✅ patient_0003 - Demo stream started
✅ patient_0004 - Demo stream started
✅ patient_0005 - Demo stream started
```

### In Browser (Early Warning Page):
```
┌─────────────────────────────────────────┐
│ Health Status: 🔴 HIGH RISK              │
├─────────────────────────────────────────┤
│ Recommendations:                         │
│ • Schedule cardiology consultation       │
│ • Reduce physical stress                 │
│ • Continue regular monitoring             │
│ • Consider stress management techniques  │
├─────────────────────────────────────────┤
│ Current Biometrics:                      │
│ Heart Rate (resting):  108 bpm           │
│ HRV (RMSSD):           28 ms              │
│ Blood Oxygen:          91%                │
│ Respiratory Rate:      24 /min            │
└─────────────────────────────────────────┘
```

---

## 🎯 Timeline

```
Total Demo Time: ~30 minutes

Step 1 (Find URLs):        5 min  ⏱️
Step 2 (Update script):    2 min  ⏱️
Step 3 (Seed patients):    10 min ⏱️  ← Longest step
Step 4 (Run demo):         8 min  ⏱️
Step 5 (View results):     Live   📱
```

---

## ✅ Success Checklist

After completing all steps, verify:

- [ ] Backend URL found and verified
- [ ] demo-railway-production.ps1 updated with correct URL
- [ ] 50 mock patients seeded in production database
- [ ] Script runs without connection errors
- [ ] Terminal shows "Risk Level: HIGH" alerts
- [ ] Browser shows 🔴 **RED** risk on early warning page
- [ ] Dashboard updates in real-time
- [ ] Multiple patients streaming in parallel
- [ ] Recommendations appear on page

---

## 🆘 Troubleshooting

### "Login failed" or "No token in response"
```
❌ Problem: Mock patients not seeded
✅ Solution: Make sure Step 3 is complete (check Railway console)
```

### "Connection refused" or "Cannot reach backend"
```
❌ Problem: Wrong backend URL  
✅ Solution: Run find-railway-urls.ps1 and verify URL is correct
```

### "No alerts generated" / "Risk Level: UNKNOWN"
```
❌ Problem: Patient has no biometric data yet
✅ Solution: Wait 30 seconds and refresh the page
```

### Backend URL looks wrong
```
❌ Problem: URL doesn't start with https://
✅ Solution: Double-check in Railway dashboard, include full URL
```

---

## 📱 Demo URLs Quick Reference

Save these for later:

```
Frontend Early Warning: https://frontend-production-326c.up.railway.app/patient/early-warning
Frontend Dashboard:     https://frontend-production-326c.up.railway.app/patient/dashboard
Backend API (replace X): https://your-backend-url.up.railway.app/api/
```

---

## 🎓 What This Demonstrates

✅ **Multi-User Simulation**: 50 concurrent patients  
✅ **Early Warning AI**: Detects cardiovascular risk  
✅ **Realistic Progression**: 100-day health simulation  
✅ **Real-Time Updates**: Live dashboard updates  
✅ **Production Scale**: Running on Railway infrastructure  
✅ **API Performance**: Under concurrent load  

Perfect for:
- 🏥 Investor pitch
- 📊 Stakeholder demo
- 🔬 Clinical team review
- 🚀 Go-to-market readiness

---

## 🚀 NOW: Execute These Commands

```powershell
# 1. Find your URLs
. .\find-railway-urls.ps1

# 2. (Manually update demo-railway-production.ps1)

# 3. Seed patients in Railway console
# (Go to Railway → Backend → Console → paste the seeding command)

# 4. Run the demo
. .\demo-railway-production.ps1

# 5. View results in browser
Start-Process "https://frontend-production-326c.up.railway.app/patient/early-warning"
```

---

## 💡 Tips for Best Results

1. **Use a large monitor** - Shows dashboard + early warning page side-by-side
2. **Keep Terminal and Browser visible** - Watch data flow in real-time
3. **Don't close the demo script** - It's actively streaming data
4. **Refresh browser** - If data doesn't appear immediately
5. **Check Railway logs** - If something fails (`railway logs` in CLI)

---

**Ready? Start with Step 1! 🚀**

