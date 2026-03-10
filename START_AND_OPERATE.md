# Ahava Healthcare — Start & Operate Guide

Full reference for starting and operating the Ahava Healthcare platform locally and in production.

---

## Command Quick Reference (Root)

| Command | Description |
|---------|-------------|
| `pnpm install` | Install dependencies |
| `pnpm dev` | Start all apps (parallel) |
| `pnpm dev:api` | Start backend only |
| `pnpm build` | Build all packages |
| `pnpm build:frontend` | Build workspace frontend |
| `pnpm start:frontend` | Start workspace (production, after build) |
| `pnpm prisma:generate` | Generate Prisma client |
| `pnpm prisma:migrate` | Run DB migrations |
| `pnpm prisma:seed` | Seed base data |
| `pnpm seed:mock-patients` | Seed mock patients |
| `pnpm db:reset` | Reset DB (destructive) |
| `cd apps/ml-service; .\run.ps1` | Start ML Early Warning service |
| `pnpm lint` | Lint |
| `pnpm test` | Run tests |
| `pnpm test:backend` | Run backend tests |
| `pnpm test:services` | Smoke test backend + auth + patient/bookings |

---

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| **Node.js** | >= 20 | Runtime |
| **pnpm** | >= 9 | Package manager |
| **PostgreSQL** | 14+ | Database |
| **Redis** | 6+ | Background jobs (optional) |
| **Python** | 3.11 or 3.12 | ML service (optional; backend has fallback) |

### Quick Check

```powershell
node -v   # v20.x or higher
pnpm -v   # 9.x or higher
```

---

## First-Time Setup

### 1. Install Dependencies

```powershell
cd c:\Users\User\ahava-healthcare-1
pnpm install
```

### 2. Environment Configuration

**Backend** — copy `apps/backend/env.example` to `apps/backend/.env`:

```powershell
Copy-Item apps\backend\env.example apps\backend\.env
```

Edit `apps/backend/.env` and set at minimum:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for JWT auth (min 32 chars) |
| `GEMINI_API_KEY` | Yes* | Google Gemini for AI triage |
| `REDIS_URL` | No | Redis for queues (leave unset to run without) |
| `RESEND_API_KEY` | No | Email (Resend) — fallback: direct send |
| `EMAIL_FROM` | No | Sender address for emails |

\* Or `ANTHROPIC_API_KEY` for Claude.

**Example `.env` (minimal):**

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/ahava_healthcare?schema=public"
JWT_SECRET="your-super-secret-jwt-key-at-least-32-characters-long"
GEMINI_API_KEY="your-gemini-api-key"
PORT=4000
```

### 3. Database Setup

```powershell
# Generate Prisma client
pnpm prisma:generate

# Run migrations
pnpm prisma:migrate

# (Optional) Seed base data
pnpm prisma:seed

# (Optional) Seed mock patients for testing
pnpm seed:mock-patients

# (Optional) Seed patients with history (for early-warning demo)
$env:MOCK_WITH_HISTORY="1"; $env:MOCK_PATIENT_COUNT="50"; pnpm seed:mock-patients
```

---

## Start Commands

### Development — Full Stack (Backend + Frontend)

**Terminal 1 — Backend (API):**

```powershell
pnpm dev:api
```

- API: http://localhost:4000  
- Health: http://localhost:4000/health  

**Terminal 2 — Frontend (Next.js workspace):**

```powershell
pnpm --filter workspace dev
```

Or:

```powershell
cd workspace
pnpm dev
```

- App: http://localhost:3000  

**Terminal 3 — ML Service (optional, for Early Warning):**

The ML service runs biometric/early-warning analysis (Framingham, QRISK3, CVD risk). The backend uses built-in fallback logic when the ML service is down, so this is **optional**.

```powershell
cd apps\ml-service
.\run.ps1
```

Or manually (Python 3.11 or 3.12):

```powershell
cd apps\ml-service
py -3.12 -m venv .venv312
.\.venv312\Scripts\pip install -r requirements.txt
.\.venv312\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

- ML service: http://localhost:8000  

Set `ML_SERVICE_URL=http://localhost:8000` in `apps/backend/.env` (or leave unset; default is localhost:8000).

### Development — All Apps in Parallel

```powershell
pnpm dev
```

Runs backend and all workspace packages in parallel. Check package scripts for which apps start.

### Production Build & Start

**Build everything:**

```powershell
pnpm build
```

**Start backend (production):**

```powershell
cd apps/backend
node dist/index.js
```

Or from root:

```powershell
pnpm --filter @ahava-healthcare/api start
```

**Start frontend (production):**

Build first: `pnpm build:frontend`, then:

```powershell
pnpm start:frontend
```

Or from `workspace/`:

```powershell
cd workspace
pnpm build
pnpm start
```

---

## Operational Commands

### Database

| Command | Description |
|---------|-------------|
| `pnpm prisma:generate` | Generate Prisma client |
| `pnpm prisma:migrate` | Run migrations (dev) |
| `pnpm prisma:deploy` | Run migrations (prod) — in `apps/backend` |
| `pnpm prisma:seed` | Seed base data |
| `pnpm db:reset` | Reset DB and re-run migrations |
| `pnpm seed:mock-patients` | Seed mock patient data |
| `pnpm seed:from-synthea` | Seed from Synthea synthetic data |

### Lint, Type-Check, Test

| Command | Description |
|---------|-------------|
| `pnpm lint` | Lint all packages |
| `pnpm lint:fix` | Lint and fix |
| `pnpm type-check` | TypeScript check |
| `pnpm test` | Run all tests |
| `pnpm test:backend` | Run backend tests |

### Load & Early-Warning Tests

| Command | Description |
|---------|-------------|
| `pnpm load-test:patient-pipeline` | Load test patient pipeline |
| `pnpm test:early-warning` | Test early-warning flow |
| `pnpm synthea:run-and-seed` | Run Synthea and seed from output |

---

## URLs & Ports

| Service | Port | URL |
|---------|------|-----|
| Backend API | 4000 | http://localhost:4000 |
| Frontend (Next.js workspace) | 3000 | http://localhost:3000 |
| Frontend (Vite) | 5173 | http://localhost:5173 |
| **ML Service (Early Warning)** | 8000 | http://localhost:8000 |
| Backend health | 4000 | http://localhost:4000/health |

---

## Environment Variables (Backend)

Key variables from `apps/backend/env.example`:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | JWT signing secret |
| `PORT` | No | 4000 | API port |
| `REDIS_URL` | No | — | Redis for BullMQ (optional) |
| `GEMINI_API_KEY` | Yes* | — | Gemini for AI triage |
| `ANTHROPIC_API_KEY` | No | — | Claude fallback for triage |
| `RESEND_API_KEY` | No | — | Resend for email |
| `EMAIL_FROM` | No | — | From address for email |
| `STATPEARLS_SERVICE_URL` | No | — | StatPearls HTTP wrapper (optional) |
| `ML_SERVICE_URL` | No | http://localhost:8000 | ML Early Warning service (optional) |
| `BACKEND_URL` | No | — | Used by frontend; for production API base |
| `CORS_ORIGIN` | No | — | Allowed origins (comma-separated) |

---

## ML Service (Early Warning)

- **Optional.** The backend uses built-in fallback logic when the ML service is unavailable.
- **Used for:** Biometric ingestion, early-warning analysis, CVD risk (Framingham, QRISK3, ML model), readiness scores.
- **To run:** See Terminal 3 in "Start Commands" above. Requires Python 3.11 or 3.12.
- **Without ML:** Biometric submissions still work; Early Warning uses simplified fallback analysis.

## Running Without Redis

Backend runs without Redis. Core API and triage work. Emails send directly instead of via queue.

- Do not set `REDIS_URL`, or
- Set it but leave Redis stopped; backend will log and continue without queues

---

## Quick Start (TL;DR)

```powershell
# 1. Install
pnpm install

# 2. Setup env
Copy-Item apps\backend\env.example apps\backend\.env
# Edit apps/backend/.env — set DATABASE_URL, JWT_SECRET, GEMINI_API_KEY

# 3. Database
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed

# 4. Start (three terminals for full stack)
# Terminal 1: Backend
pnpm dev:api
# Terminal 2: Frontend
cd workspace; pnpm dev
# Terminal 3 (optional): ML Early Warning
cd apps\ml-service; .\run.ps1

# 5. Open
# http://localhost:3000
```

---

## Docker (Optional)

**Backend:**
```powershell
docker build -f apps/backend/Dockerfile .
```

**Frontend (workspace):**
```powershell
docker build -f workspace/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api .
```

See `apps/backend/Dockerfile` and `workspace/Dockerfile` for details.

---

## Hard refresh and clear site data (fix logout / stale frontend)

Do this when the app still logs you out after using services, or after changing env/API URL, so the browser drops old cache and storage.

### Option A — Hard refresh (quick)

1. Open the app at **http://localhost:3000**.
2. **Windows / Linux:** `Ctrl + Shift + R` or `Ctrl + F5`.  
   **Mac:** `Cmd + Shift + R`.
3. Or: open DevTools (F12) → right‑click the refresh button → **Empty cache and hard reload**.

### Option B — Clear site data for localhost (recommended)

1. Open **http://localhost:3000**.
2. Press **F12** to open DevTools.
3. Go to the **Application** tab (Chrome/Edge) or **Storage** tab (Firefox).
4. In the left sidebar, under **Storage**, click **Clear site data** (Chrome/Edge) or use **Clear All** (Firefox).
   - Or expand **Local Storage** → click **http://localhost:3000** → delete the `token` and `user` entries (and optionally right‑click → Clear).
5. Close DevTools and refresh the page (**F5**).
6. Log in again and try a transaction (e.g. submit biometrics).

### Option C — Full clear for localhost (if still broken)

1. In the address bar type: `chrome://settings/siteData` (Chrome) or `about:preferences#privacy` (Firefox).
2. Search for **localhost** and remove **localhost:3000** (and optionally localhost:4000).
3. Restart the browser, open **http://localhost:3000**, log in again.

After clearing, ensure **workspace** and **backend** are both restarted so they use the latest code and env.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **"Can't reach database at localhost:5432"** | PostgreSQL not running. Start PostgreSQL (e.g. `pg_ctl start` or Windows service), or use Docker: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password postgres` |
| **`prisma:generate` EPERM / rename failed** | Another process (backend, IDE) is locking Prisma files. Stop backend, close other terminals, run in a fresh terminal. If needed, run Cursor/VS Code as admin once. |
| Redis crash on startup | See [docs/REDIS_TROUBLESHOOTING.md](docs/REDIS_TROUBLESHOOTING.md) |
| Database connection failed | Check `DATABASE_URL` and PostgreSQL status |
| AI triage 500 | Ensure `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` is set |
| CORS errors | Set `CORS_ORIGIN` or `BACKEND_URL` correctly |
| Frontend cannot reach API | Ensure backend is on 4000 and `BACKEND_URL` points to it |
| Logged out after using services / 401 | Workspace must call backend directly in dev so `Authorization` is sent. Set `NEXT_PUBLIC_API_URL=http://localhost:4000/api` in `workspace/.env.local` and restart Next.js. Backend CORS allows `http://localhost:3000`. |
| Early Warning empty / 503 | Start ML service (`cd apps\ml-service; .\run.ps1`). Or leave ML off; backend uses fallback. |
