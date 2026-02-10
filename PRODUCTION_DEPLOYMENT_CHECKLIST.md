# Production Deployment Checklist — Ahava Healthcare

Use this checklist **before** every production deploy. Complete each section in order.

---

## Current platform readiness (summary)

| Area | Status | Notes |
|------|--------|--------|
| **Backend API** | ✅ Ready | Express, Prisma, JWT, rate limit, Helmet, CORS |
| **Database** | ✅ Ready | PostgreSQL + Prisma migrations |
| **Auth & RBAC** | ✅ Ready | JWT + refresh, role-based routes |
| **Frontend (workspace)** | ✅ Ready | Next.js app, AuthContext, api client |
| **Lint** | ⚠️ Partial | Backend/workspace have ESLint; run and fix before deploy |
| **Unit tests** | ❌ Missing | Jest configured in backend but no tests; add and run |
| **Containers** | ❌ Missing | No Dockerfiles yet; add for backend + workspace |
| **Env validation** | ⚠️ Partial | No startup validation; add and use |
| **Secrets** | ⚠️ Manual | No hardcoded secrets; must set in platform (e.g. Railway) |
| **Logs** | ✅ Basic | Morgan `combined`; consider structured JSON in prod |
| **Unused files** | ⚠️ Tidy | Root has duplicate/legacy docs and scripts; clean up |

**Overall:** ~70% ready. Complete lint, tests, containers, env validation, endpoint/integration tests, and cleanup before production.

---

## 1. Environment preparation

### 1.1 Backend (`apps/backend`)

- [ ] Copy `apps/backend/env.example` to `.env.production` (or set vars in host).
- [ ] Set **required** variables (app must not start without these in production):

  | Variable | Purpose | Production note |
  |----------|---------|------------------|
  | `DATABASE_URL` | PostgreSQL connection | Use pooler URL if provided (e.g. Railway, Render). |
  | `JWT_SECRET` | Signing tokens | Min 32 chars; generate with `openssl rand -base64 32`. |
  | `ENCRYPTION_KEY` | Nurse reports etc. | Base64 32-byte key. |
  | `ENCRYPTION_IV_SALT` | IV derivation | Hex 16-byte. |
  | `NODE_ENV` | `production` | Required for CORS and rate limits. |

- [ ] Set **optional but recommended**: `REDIS_URL`, `PORT`, `TIMEZONE`, `ML_SERVICE_URL` (or leave unset to disable ML).
- [ ] **Never** commit `.env` or `.env.production`; use platform secrets (Railway, Render, etc.).
- [ ] Run env validation before deploy: from `apps/backend`, run `node scripts/validate-env.js` (or `pnpm run validate:env`).

### 1.2 Frontend (`workspace`)

- [ ] Set `NEXT_PUBLIC_API_URL` to production API URL (e.g. `https://api.yourapp.com/api`).
- [ ] No other secrets in frontend; all secrets stay on backend.

### 1.3 ML service (optional)

- [ ] If using ML: set `ML_SERVICE_URL` in backend and deploy ML service separately.
- [ ] If not using ML: leave unset; backend uses fallback logic.

---

## 2. Lint

- [ ] From repo root:
  - `pnpm lint`
- [ ] Fix all reported issues:
  - Backend: `pnpm --filter @ahava-healthcare/api lint:fix`
  - Workspace: `cd workspace && pnpm lint` (fix manually if needed).
- [ ] Ensure CI or pre-deploy step runs `pnpm lint` and fails on errors.

---

## 3. Unit tests

- [ ] Backend: add unit tests for critical paths (auth, bookings, visits, patient APIs).
- [ ] Run: `pnpm test:backend` (or `pnpm --filter @ahava-healthcare/api test`).
- [ ] Fix failing tests; do not deploy with red tests.
- [ ] Workspace: add tests if desired (e.g. React Testing Library); add `"test": "next test"` or similar and run in checklist.

---

## 4. Containerization

- [ ] **Backend**: Use `apps/backend/Dockerfile` (see below). Build and run locally:
  - `docker build -t ahava-api ./apps/backend`
  - `docker run --env-file .env.production -p 4000:4000 ahava-api`
- [ ] **Frontend**: Use `workspace/Dockerfile` (see below). Build with build-arg for `NEXT_PUBLIC_API_URL`.
- [ ] Ensure no secrets in Dockerfile or in image layers; use runtime env or secrets.
- [ ] Use multi-stage builds and non-root user where possible.

---

## 5. Test all endpoints

- [ ] Health: `GET /health` → 200 and `status: 'ok'`.
- [ ] Auth: register, login, refresh token, logout (if implemented).
- [ ] Bookings: create (patient), list, get by id, cancel (with auth).
- [ ] Visits: create, list, get by id, update status, record biometrics/treatment/nurse report (with auth).
- [ ] Patient: submit biometrics, triage, monitoring summary, alerts (with auth).
- [ ] Nurse: availability, nearby, profile (with auth).
- [ ] Admin: users list, update user (with auth).
- [ ] Use `test-platform.ps1` or Postman/curl; document any failing endpoints and fix before deploy.

---

## 6. Test all integrations

- [ ] **Database**: Prisma connect, migrations applied, no raw SQL errors in logs.
- [ ] **Redis**: Backend starts and queue/WebSocket use Redis when `REDIS_URL` is set.
- [ ] **ML service** (if used): Backend can reach `ML_SERVICE_URL`; triage/biometrics return expected shape.
- [ ] **Frontend → Backend**: Login, dashboards (patient/nurse/doctor/admin), API base URL correct, no CORS errors.
- [ ] **Payments** (if enabled): Use test keys and webhook URL; verify webhook signature.

---

## 7. Logs

- [ ] Backend: Morgan `combined` is in place; ensure logs go to stdout/stderr so host can aggregate.
- [ ] In production, consider:
  - JSON-structured logs (e.g. `morgan` with custom format or a logger like `pino`).
  - No logging of passwords, tokens, or PII in request/response bodies.
- [ ] Error handler: stack traces only in development (already guarded by `NODE_ENV`).

---

## 8. Clean up unused files

- [ ] **Do not commit:** `.env`, `.env.local`, `.env.production`, `node_modules`, `dist`, `.next`, IDE folders.
- [ ] Ensure `.gitignore` is up to date for env files and build outputs.
- [ ] **Optional cleanup** (review before deleting):
  - Root-level duplicate/legacy docs (e.g. `ALL_ERRORS_FIXED.md`, `DAY_1_PROGRESS.md`, `OAUTH_FIX_GUIDE.md`, etc.) — archive or delete if superseded by `PRODUCTION_DEPLOYMENT_CHECKLIST.md` and `PRODUCTION_READINESS.md`.
  - `frontend/` — if you only use `workspace/` as the main app, consider archiving or removing to avoid confusion.
  - `src/` at repo root — if this is legacy and all app code is under `apps/` and `workspace/`, consider removing.
  - One-off scripts in `scripts/` (e.g. `test-ai.js`, `smoke-test.js`) — keep if you use them; otherwise move to `docs/` or remove.
  - `.yarn/` — if you have fully migrated to pnpm, you can remove `.yarn` and any `.yarnrc.yml` if present.
- [ ] Keep: `test-platform.ps1`, `test-api-prisma.ps1` (or equivalent) for manual endpoint testing.

---

## 9. Security and secrets

- [ ] **Secrets only in environment**: No JWT secrets, API keys, or DB URLs in code or in Dockerfile.
- [ ] **JWT_SECRET**: Strong random value; different from dev; rotated if compromised.
- [ ] **ENCRYPTION_KEY / ENCRYPTION_IV_SALT**: Generated once and stored in secret manager; same for all instances that need to decrypt.
- [ ] **CORS**: In production, `origin` is restricted to known frontend URLs (update `index.ts` when you have production domains).
- [ ] **Rate limiting**: Already enabled; verify limits are acceptable for production.
- [ ] **Helmet**: Already enabled; leave defaults unless you need to relax CSP for a specific feature.
- [ ] **HTTPS**: Backend and frontend served over HTTPS in production (handled by host).

---

## 10. Pre-deploy run (summary)

1. Env: set production env vars; run `node apps/backend/scripts/validate-env.js`.
2. Lint: `pnpm lint`; fix all.
3. Tests: `pnpm test:backend` (and workspace tests if added).
4. Build: backend `pnpm --filter @ahava-healthcare/api build`; workspace `cd workspace && pnpm build`.
5. Containers: build and run backend + workspace images; smoke test.
6. Endpoints: run full endpoint and integration tests.
7. Logs: confirm no secrets or PII in logs.
8. Cleanup: remove unused files; ensure `.gitignore` is correct.
9. Security: confirm no secrets in repo; CORS and rate limit configured for production.

After all items are done, deploy using your chosen platform (Railway, Render, Fly.io, etc.) and monitor logs and health endpoint.

---

## Quick pre-deploy commands (from repo root)

```bash
# 1. Validate backend env (set NODE_ENV=production for strict check)
cd apps/backend && node scripts/validate-env.js && cd ../..

# 2. Lint
pnpm lint

# 3. Backend unit tests
pnpm test:backend

# 4. Build backend + frontend
pnpm --filter @ahava-healthcare/api build
cd workspace && pnpm build && cd ..

# 5. Docker (optional)
docker build -f apps/backend/Dockerfile -t ahava-api .
docker build -f workspace/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://your-api.com/api -t ahava-web .
```

---

## Security checklist (summary)

- [ ] No secrets in code or in Docker images; use platform secrets (Railway, Render, etc.).
- [ ] `JWT_SECRET` ≥ 32 characters; unique for production.
- [ ] `ENCRYPTION_KEY` and `ENCRYPTION_IV_SALT` set and stored securely.
- [ ] CORS restricted to production frontend origin(s) in `apps/backend/src/index.ts`.
- [ ] Rate limiting enabled (already in place); verify limits for production traffic.
- [ ] Helmet and HTTPS in production; no stack traces or sensitive data in production logs.
