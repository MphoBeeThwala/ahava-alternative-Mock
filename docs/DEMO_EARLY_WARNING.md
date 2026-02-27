# Demo: Early Warning + ML service with populated data

Use this to show the Early Warning dashboard with real-looking data and risk scores.

## If you don’t see the new design or Early Warning

- **New design (teal, warm background, Plus Jakarta Sans)** and **Early Warning** are in the **workspace** (Next.js) app. If you still see purple/blue and no “Early Warning”:
  1. **Redeploy the frontend** on Railway (or your host) so it builds from the latest `main`.
  2. **Check the build** – the frontend Dockerfile builds `workspace`; the deploy commit should match your latest push.
  3. **Hard refresh** the app: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac) to avoid cached CSS/JS.

## Where to see it on the frontend

- **Patient dashboard:** After login, a large **“Early Warning — Cardiovascular & Wellness”** card with an **“Open Early Warning →”** button appears at the top.
- **Sidebar:** As a patient, the sidebar has **Early Warning** and **AI Doctor** links.
- **Early Warning page:** `/patient/early-warning` shows metrics, risk scores (Framingham, QRISK3, ML), trajectory, and recommendations—when the ML service is running and the user has biometric data.

## Option A: Mock patients with 14-day history (recommended, no Java)

1. **Start ML service** (required for Early Warning):

   ```powershell
   cd c:\Users\User\ahava-healthcare-1\apps\ml-service
   .\.venv312\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
   ```

2. **Seed mock patients with 14-day biometric history** (backend and DB must be running):

   ```powershell
   cd c:\Users\User\ahava-healthcare-1\apps\backend
   $env:MOCK_WITH_HISTORY="1"; $env:MOCK_PATIENT_COUNT="50"; pnpm run seed:mock-patients
   ```

   This creates 50 patients (or backfills 14 days of readings for existing patient_0001–0050) so Early Warning has a baseline.

2. **Ensure backend + ML service are running** (ports 4000 and 8000).

3. **Log in as a mock patient:**
   - URL: **http://localhost:3000**
   - Email: **patient_0001@mock.ahava.test**
   - Password: **MockPatient1!** (or whatever you set in `MOCK_PATIENT_PASSWORD`)

4. **Open Early Warning:**
   - In the sidebar click **Early Warning**, or go to **http://localhost:3000/patient/early-warning**

5. **You should see:**
   - Current metrics (resting HR, HRV, SpO₂, sleep, steps, ECG, temperature trend)
   - Personal baselines (once ML has been backfilled from DB)
   - 10-year risk scores (Framingham, QRISK3, ML model)
   - Risk trajectory and any alerts/recommendations

The first time you open Early Warning for a user who has readings in the DB, the backend will backfill the ML service with their last 20 readings (with correct timestamps) so the baseline and anomaly logic work.

---

## Option B: Synthea data (if you have Synthea CSV)

1. **Generate Synthea CSV** (needs Java 11+ and Synthea JAR):
   - Download [synthea-with-dependencies.jar](https://github.com/synthetichealth/synthea/releases)
   - From repo root:
     ```powershell
     $env:SYNTHEA_JAR="path\to\synthea-with-dependencies.jar"
     $env:SYNTHEA_POPULATION="100"
     node scripts/run-synthea-and-seed.js
     ```
   - Or if you already have `output/csv` (or `synthea-output/csv`) with `patients.csv` and `observations.csv`:
     ```powershell
     cd apps\backend
     pnpm run seed:from-synthea
     ```

2. **Log in as a Synthea patient:**
   - Email format: **synthea_First_Last_&lt;id&gt;@synthea.ahava.test** (e.g. from the seed log output)
   - Password: **SyntheaPatient1!** (or `SYNTHEA_PASSWORD` you used)

3. **Open Early Warning** from the sidebar.

---

## Quick reference

| Step | Command |
|------|--------|
| Seed 50 patients + 14-day history | `cd apps\backend` then `$env:MOCK_WITH_HISTORY="1"; $env:MOCK_PATIENT_COUNT="50"; pnpm run seed:mock-patients` |
| Login (mock) | patient_0001@mock.ahava.test / MockPatient1! |
| Early Warning page | Sidebar → Early Warning or /patient/early-warning |
