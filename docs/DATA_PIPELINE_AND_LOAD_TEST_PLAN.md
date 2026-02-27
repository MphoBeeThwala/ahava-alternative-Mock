# Data Pipeline & Load Test Plan — Ahava Healthcare

**Objective:** Test the application data pipeline with mock patient data, validate **TSDB → Process → NoSQL** feasibility, and verify the platform handles **1000 users** with **early warning** behaviour.

---

## 1. Current Architecture (As-Is)

| Layer | Current Implementation | Notes |
|-------|------------------------|--------|
| **Storage (time-series-like)** | PostgreSQL `biometric_readings` table | Row-per-reading; indexed on `(userId, createdAt)`. ML service uses **in-memory** `DATA_STORE` (comment: "replace with InfluxDB/TimescaleDB"). |
| **Process** | Backend (Node) + ML service (Python FastAPI) | Backend: writes to DB → calls ML `/ingest` and `/readiness-score` → updates reading + creates `HealthAlert` if YELLOW/RED. |
| **Query / “NoSQL”** | PostgreSQL (Prisma) | Alerts and profiles in same DB. No dedicated document store or cache. |

**Flow today:**  
`Client → POST /api/patient/biometrics` → Backend inserts into `biometric_readings` → Backend calls ML `/ingest` → Backend updates row (alertLevel, anomalies, readinessScore) → Backend creates `health_alerts` row if non-GREEN.

---

## 2. TSDB → Process → NoSQL: Is It Possible?

**Yes.** A realistic pipeline is:

| Stage | Role | Options |
|-------|------|--------|
| **TSDB** | Raw time-series writes (high write throughput, retention, downsampling) | **TimescaleDB** (Postgres extension), **InfluxDB**, or **QuestDB**. |
| **Process** | Anomaly detection, baselines, early warning | Keep existing Backend + ML service; optionally add a **queue** (e.g. Redis/Bull) for async processing at scale. |
| **NoSQL** | Processed results, alerts, dashboards, fast reads | **MongoDB** or **Redis** for alerts/summaries; or **PostgreSQL JSONB** + materialized views as a lighter “document-like” layer. |

**Concrete options:**

- **Option A (minimal):** Keep PostgreSQL; convert `biometric_readings` to a **TimescaleDB hypertable** (same DB, time-series optimised). Process unchanged. “NoSQL” = Redis cache for readiness scores + recent alerts, or JSONB in Postgres.
- **Option B (full pipeline):** **InfluxDB/TimescaleDB** for raw metrics → **worker** consumes and calls ML → writes **alerts/summaries** to **MongoDB** (or back to Postgres). Backend reads from MongoDB/Postgres for dashboards.

For **this test** we do **not** change the DB topology; we validate behaviour and load with the current stack, and use this plan as the roadmap for a future TSDB/NoSQL rollout.

---

## 3. Scope of This Exercise

1. **Mock data:** 1000 patient users + profiles; optional biometric history (e.g. 14+ days per user so ML baseline can be established).
2. **Early warning test:** For a subset of users, inject readings that should trigger YELLOW/RED; assert that `HealthAlert` rows and API responses are correct.
3. **Load test:** Simulate 1000 users (or batches) hitting login, submit biometrics, get alerts/history; measure latency and errors.
4. **Pipeline:** Document and/or prototype a **TSDB → Process → NoSQL** path (design + optional minimal PoC in scripts).

---

## 4. Execution Plan

### Phase 1 — Mock Data & Seed

| Step | Action | Owner |
|------|--------|--------|
| 1.1 | Run DB migrations (ensure `biometric_readings`, `health_alerts`, `users` are current). | Dev |
| 1.2 | **Option A — Mock:** Run **seed-mock-patients** (1000 PATIENT users, known password). **Option B — Synthea:** Run Synthea CSV export then **seed:from-synthea** (see `docs/SYNTHEA_INTEGRATION_REPORT.md`). | Data Eng |
| 1.3 | Optional: For each user (or a subset), backfill **14+ days** of biometric readings (e.g. 2–4 readings/day) so ML service can establish baseline. | Data Eng |
| 1.4 | Optional: For **early-warning subset** (e.g. 50 users), add readings that trigger YELLOW/RED (e.g. high HR, low SpO2, high respiratory rate). | Data Eng |

**Deliverables:**  
- `pnpm run seed:mock-patients` or `pnpm run seed:from-synthea` (Synthea); optional `pnpm run synthea:run-and-seed` (set `SYNTHEA_JAR`).  
- Env or CLI flag for count (default 1000), and flags for “with history”, “with early-warning subset”.

### Phase 2 — Early Warning Validation

| Step | Action | Owner |
|------|--------|--------|
| 2.1 | Start Backend + ML service locally (or against a test environment). | Dev |
| 2.2 | For the early-warning subset, submit one “anomalous” reading per user via `POST /api/patient/biometrics` (using each user’s token). | Data Eng / Dev |
| 2.3 | Assert: `GET /api/patient/alerts` returns at least one unresolved alert for those users; response includes expected `alertLevel` (YELLOW or RED). | Data Eng |
| 2.4 | Optionally: assert `GET /api/patient/biometrics/history` and `GET /api/patient/monitoring/summary` reflect the new reading and alert. | Data Eng |

**Deliverables:**  
- Script or test suite: `scripts/run-early-warning-test.ts` (or integrated into load test script) that logs in as each test user, submits anomalous payload, then checks alerts.

### Phase 3 — Load Test (1000 Users)

| Step | Action | Owner |
|------|--------|--------|
| 3.1 | Use a list of mock user credentials (e.g. from seed: `patient_001@mock.ahava.test` … `patient_1000@mock.ahava.test`, shared password). | Data Eng |
| 3.2 | Load test script: in parallel (configurable concurrency), for each user: login → get token → call `POST /api/patient/biometrics` (1 reading) → `GET /api/patient/alerts` → `GET /api/patient/biometrics/history?limit=10`. | Data Eng |
| 3.3 | Measure: success rate, P50/P95 latency per endpoint, any 5xx or 4xx. | Data Eng |
| 3.4 | If rate limits or timeouts appear, document and optionally increase limits or add batching for seed/backfill. | Dev |

**Deliverables:**  
- Script: `scripts/load-test-patient-pipeline.ts` (or `.js`) with configurable user count, concurrency, base URL.  
- Summary report: success rate, latencies, and any failures.

### Phase 4 — Pipeline Evolution (TSDB / NoSQL) — Optional

| Step | Action | Owner |
|------|--------|--------|
| 4.1 | Document decision: Option A (TimescaleDB + Redis) vs Option B (InfluxDB + worker + MongoDB). | Data Eng |
| 4.2 | If PoC desired: implement a minimal path (e.g. one endpoint that writes to TimescaleDB and/or reads from a cache) and add to this doc. | Data Eng + Dev |

---

## 5. Run Order (When Ready)

1. **Prerequisites:** Node/pnpm, PostgreSQL, Python (ML service). Backend and ML service runnable.
2. **Seed (choose one):**  
   - **Mock:** `pnpm run seed:mock-patients` (optional: `MOCK_WITH_HISTORY=1`).  
   - **Synthea:** Put Synthea CSV in `synthea-output/csv` (or set `SYNTHEA_CSV_PATH`), then `pnpm run seed:from-synthea`. Or run Synthea then seed: set `SYNTHEA_JAR` to the JAR path and run `pnpm run synthea:run-and-seed`. See `docs/SYNTHEA_INTEGRATION_REPORT.md`.
3. **Early warning test:**  
   `pnpm run test:early-warning` (or run the dedicated script).
4. **Load test:**  
   `pnpm run load-test:patient-pipeline` (point at local or staging backend). Use mock or Synthea-seeded users (Synthea logins: `synthea_<First>_<Last>_<id>@synthea.ahava.test`, password per `SYNTHEA_PASSWORD`).
5. **Review** outputs and this doc; iterate on concurrency or data shape if needed.

---

## 6. Success Criteria

- 1000 patient users created and usable (login works with seeded credentials).
- Early warning: for the subset with anomalous readings, alerts appear in DB and via `GET /api/patient/alerts`.
- Load test: e.g. ≥ 99% success rate, P95 &lt; 2s for biometrics submit and &lt; 1s for alerts/history (targets to be adjusted per environment).
- Documented path for TSDB → Process → NoSQL and, if implemented, a minimal PoC validated.

---

## 7. Files and Scripts (Implemented)

| Asset | Purpose |
|-------|--------|
| `docs/DATA_PIPELINE_AND_LOAD_TEST_PLAN.md` | This plan. |
| `docs/SYNTHEA_INTEGRATION_REPORT.md` | Synthea integration: run JAR, CSV→DB mapping, LOINC codes, MVP research use. |
| `apps/backend/src/scripts/seed-mock-patients.ts` | Seed 1000 mock patients; optional 14-day history (env: `MOCK_PATIENT_COUNT`, `MOCK_WITH_HISTORY`, `MOCK_EARLY_WARNING_COUNT`). Run: `pnpm run seed:mock-patients`. |
| `apps/backend/src/scripts/seed-from-synthea.ts` | Seed DB from Synthea CSV (`patients.csv` + `observations.csv`). Run: `pnpm run seed:from-synthea` (env: `SYNTHEA_CSV_PATH`, `SYNTHEA_PASSWORD`, `SYNTHEA_MAX_PATIENTS`). |
| `scripts/run-synthea-and-seed.js` | Run Synthea JAR (if `SYNTHEA_JAR` set) then seed. Run: `pnpm run synthea:run-and-seed`. |
| `scripts/load-test-patient-pipeline.js` | Load test: login + biometrics + alerts + history for N users. Run: `pnpm run load-test:patient-pipeline`. |
| `scripts/run-early-warning-test.js` | Submit 15 normal + 1 anomalous reading per user via API, then assert alerts. Run: `pnpm run test:early-warning`. |

**Early-warning note:** The ML service keeps an in-memory baseline per user and needs 14+ days of history (by timestamp) to raise YELLOW/RED. Sending 15 readings in one run gives 15 points all with "now" timestamps, so the ML path will return "Insufficient baseline". Alerts are still created when the backend fallback runs (e.g. if the ML service is down or times out). To see ML-driven alerts, run the early-warning test with ML stopped to force fallback, or backfill the ML store with backdated timestamps (would require an API that accepts a timestamp).

---

## 8. Run instructions (after implementation)

1. **Seed 1000 mock patients** (from repo root):
   ```bash
   pnpm run seed:mock-patients
   ```
   Optional: `MOCK_WITH_HISTORY=1` to backfill 14 days of biometrics for the first 200 users (slower).

2. **Start backend with higher rate limit for load test** (required for 1000 users):
   ```bash
   set LOAD_TEST=1
   pnpm run dev:api
   ```
   Or in one line: `$env:LOAD_TEST="1"; pnpm run dev:api` (PowerShell). This raises the global rate limit to 50,000 per 15 min.

3. **Run load test** (backend and, if desired, ML service must be running):
   ```bash
   pnpm run load-test:patient-pipeline
   ```
   Optional: `COUNT=100 CONCURRENCY=20` (default COUNT=1000, CONCURRENCY=20).

4. **Run early-warning test** (optional):
   ```bash
   pnpm run test:early-warning
   ```

**Fixes applied:** (1) Auth accepts `.test` TLD for mock emails; (2) JWT access token minimum expiry 60s (so tokens do not expire in 1s when `JWT_EXPIRES_IN=1`); (3) Auth middleware skips second verification when `req.user` is already set (avoids double-verify); (4) Rate limit increased when `LOAD_TEST=1`.

Once these are in place and you’ve run through the steps above, we can treat this as the “go/no-go” baseline for scaling and for introducing TSDB/NoSQL in a later phase.
