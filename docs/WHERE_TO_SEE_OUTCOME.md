# Where to See the Outcome — Progress & Visual Check

## Current progress

| Item | Status |
|------|--------|
| **Mock data** | ✅ 1000 patients seeded (`patient_0001@mock.ahava.test` … `patient_1000@mock.ahava.test`, password `MockPatient1!`) |
| **Backend API** | ✅ Running (Terminal 6 — port 4000) |
| **ML service** | ✅ Running (Terminal 11 — port 8000) |
| **Load test** | ✅ Pipeline validated (login → biometrics → alerts → history) |
| **Early warning** | ✅ Backend uses ML when available; fallback when not |

---

## See it visually in the browser

1. **Start the frontend** (open a new terminal):

   ```powershell
   cd c:\Users\User\ahava-healthcare-1
   pnpm --filter workspace dev
   ```

   The app will be at **http://localhost:3000** (Next.js default). Keep this terminal open.

2. **Open in browser:**  
   **http://localhost:3000**

3. **Log in as a patient:**
   - **Mock:** Email `patient_0001@mock.ahava.test`, password `MockPatient1!`
   - **Synthea** (if you ran `seed:from-synthea`): Email `synthea_<First>_<Last>_<id>@synthea.ahava.test`, password `SyntheaPatient1!` (or `SYNTHEA_PASSWORD`)

4. **On the patient dashboard you can see:**
   - Monitoring summary (readiness, baseline)
   - Biometric history (if the load test or you submitted readings)
   - Alerts (if any were created)
   - Submit new biometrics and triage

---

## Quick checklist

- [ ] Terminal 6: Backend running (`pnpm run dev:api`) → port **4000**
- [ ] Terminal 11: ML service running (uvicorn) → port **8000**
- [ ] New terminal: Frontend running (`pnpm --filter workspace dev`) → port **3000**
- [ ] Browser: **http://localhost:3000** → Login → Patient dashboard

If the frontend is not running yet, start it with the commands above; then use the same login to see the outcome visually.
