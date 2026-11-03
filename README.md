# Ahava Healthcare

<img src="docs/brand/logo/ahava-logo.svg" alt="Ahava logo" width="72" align="right">

Check your symptoms with AI, reviewed by a clinician. Ahava is a South African digital care platform: AI-assisted symptom triage with doctor review, vitals tracking with early-warning alerts, and nurse home visits.

**Status: closed beta.** Patient sign-up needs an invite code, and the beta is for testing with demo or low-sensitivity health data. It is not for emergencies and not medical advice. See [Beta access](#beta-access) and the [limitations](#known-limitations) before inviting anyone.

## What's in it

| Area | What it does |
|---|---|
| **Symptom Check** | Patient describes symptoms (text, photos, lab or imaging files). AI produces a triage level and, for the reviewing doctor, a structured clinical plan. A doctor reviews before the result is final. Never shows a guessed diagnosis when the AI is down. |
| **Vitals and early warning** | Patients log heart rate, blood pressure, SpO₂, temperature, HRV and breathing rate. The ML service builds a personal baseline (about 14 days) and flags meaningful changes, plus safe-limit checks from day one. |
| **Nurse visits** | Booking and tracking of nurse home visits. |
| **Clinician tools** | Doctor and nurse dashboards, case review, prescriptions, referrals, notifications over WebSocket. |
| **Security** | Staff join by single-use admin invite and must use two-factor authentication. Sensitive fields are encrypted in the database. Patients can see who opened their record. Optional Sign in with Google for patients. |
| **Phone health sync** | Code for reading Health Connect (Android) and Apple Health is built, but needs a new app build and store approvals. Not live. See [docs/PHONE_HEALTH_SETUP.md](docs/PHONE_HEALTH_SETUP.md). |
| **Terra / ROOK wearables** | Integrated but not live (paid API accounts not set up). Shown as "under construction" in the app. |

## Repository layout

```text
.
├── apps/
│   ├── backend/        # Express API, Prisma, jobs, integrations
│   └── ml-service/     # Python/FastAPI early-warning engine
├── workspace/          # Next.js web app (also wrapped by Capacitor for Android/iOS)
├── docs/               # Operations, security, clinical, brand, deployment notes
├── scripts/            # Test, seed and utility scripts
└── test-fixtures/      # Demo inputs for manual testing
```

## Prerequisites

- Node.js `>= 20`
- `pnpm >= 9`
- PostgreSQL
- Redis (recommended for queues and multi-instance realtime)
- Python `3.11` or `3.12` to run the ML service locally

## Quick start

```bash
pnpm install
cp apps/backend/env.example apps/backend/.env   # PowerShell: Copy-Item apps\backend\env.example apps\backend\.env
pnpm prisma:generate
pnpm prisma:migrate
pnpm dev:api
```

In a second terminal:

```bash
pnpm --filter workspace dev
```

Optional ML service:

```bash
cd apps/ml-service
./run.ps1
```

The web app runs on `http://localhost:3000` and the API on `http://localhost:4000`. To use a local ML service in development, set `ML_SERVICE_ALLOW_LOCALHOST=true`.

## Useful commands

```bash
pnpm dev
pnpm dev:api
pnpm build
pnpm lint
pnpm test
pnpm test:integration  # real Postgres via embedded-postgres, no Docker needed
pnpm type-check
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm load-test:patient-pipeline
pnpm test:early-warning
```

## Beta access

New patient accounts are gated by invite codes.

1. In the backend service's environment, set `BETA_INVITE_CODES` to a comma-separated list of codes, one per tester or cohort (for example `ahava-thandi-7k2q,ahava-sipho-m9x4`). Matching ignores case. Leave it empty for open sign-up.
2. Send each tester a link: `https://<web app>/auth/signup?beta=<their code>`. The code is pre-filled; without the link they type it into the "Beta invite code" box.
3. To revoke a code, remove it from the list and redeploy. Existing accounts keep working.
4. With the gate on, Sign in with Google can't create new accounts; people register with their code first.
5. Give testers [docs/BETA_TESTER_GUIDE.md](docs/BETA_TESTER_GUIDE.md).

Clearing the variable turns the gate off, so test sign-up in a private window (valid code, no code, wrong code) after any change.

Staff (nurse, doctor, admin) are never covered by the beta code: an admin invites them from the dashboard. See [docs/SECURITY_RUNBOOK.md](docs/SECURITY_RUNBOOK.md) section 7.

## Key environment variables

All are documented in [`apps/backend/env.example`](apps/backend/env.example). The ones you'll touch most:

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `POOLED_DATABASE_URL`, `REDIS_URL` | Postgres and Redis |
| `JWT_SECRET`, `ENCRYPTION_KEY` | Session signing and field encryption (see the security runbook for moving the key into AWS KMS) |
| `FRONTEND_URL`, `APP_URL`, `CORS_ORIGIN` | Public URLs; invite and reset links use `FRONTEND_URL` |
| `BETA_INVITE_CODES` | Closed-beta patient sign-up codes |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `AI_PROVIDER_ORDER` | AI triage providers and their order |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email (invites, resets, access notices) |
| `GOOGLE_CLIENT_ID` | Enables Sign in with Google when set |
| `PAYFAST_*` | Payments |

## Known limitations

- **No automatic watch sync yet.** Beta testers log vitals by hand. Phone sync and Terra/ROOK are not live.
- **Personal baselines take about 14 days.** Until then the engine uses population values for the person's age band and safe-limit checks.
- **Encryption key is a plain environment variable.** Moving it to AWS KMS is documented but not done. Use demo data until it is.
- **Several clinical rules still await signed documents.** See [docs/CLINICAL_SIGNOFF_CHECKLIST.md](docs/CLINICAL_SIGNOFF_CHECKLIST.md).
- **CI depends on GitHub Actions.** If Actions is unavailable (for example a billing lock), no checks run and the deploy workflow is skipped. Confirm Railway actually redeployed after a merge.

## Documentation

- [Operations guide](docs/OPERATIONS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Railway deployment](docs/deployment/RAILWAY.md) (the only supported deployment target)
- [Security runbook](docs/SECURITY_RUNBOOK.md): admin password, KMS, 2FA, staff invites
- [Backup and alerting](docs/BACKUP_AND_ALERTING.md)
- [Clinical sign-off checklist](docs/CLINICAL_SIGNOFF_CHECKLIST.md)
- [Confidence calibration](docs/CONFIDENCE_CALIBRATION.md)
- [Phone health setup](docs/PHONE_HEALTH_SETUP.md)
- [Beta tester guide](docs/BETA_TESTER_GUIDE.md)
- [Research data pipeline](docs/RESEARCH_DATA_PIPELINE.md)
- [Engineering plan](docs/ENGINEERING_PLAN.md) and [Changelog](CHANGELOG.md)
- [Redis troubleshooting](docs/REDIS_TROUBLESHOOTING.md), [StatPearls integration](docs/STATPEARLS_INTEGRATION.md)

## Brand

Logo files (SVG and PNG) are in [`docs/brand/logo`](docs/brand/logo). Colours: green `#0F5D4E`, coral `#E8704A`, cream `#FBF7F0`, deep green `#0B3B31`.

## Windows utilities

Operator scripts for deployment, testing and environment support live in [`scripts/windows`](scripts/windows). They are not part of the app runtime.

## Test fixtures

Manual demo assets for triage flows are in [`test-fixtures/triage-demo`](test-fixtures/triage-demo): a sample symptom narrative, synthetic upload files and a short end-to-end walkthrough.

## Notes

- The canonical Prisma schema is [`apps/backend/prisma/schema.prisma`](apps/backend/prisma/schema.prisma).
- Railway config (`railway.toml`) stays at the repository root where the platform expects it.
