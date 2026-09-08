# Ahava Healthcare Deployment Guide

## Provider: Railway (sole target)

Railway is the only supported deployment target. Render and Fly.io configs
have been removed — see `docs/ENGINEERING_PLAN.md` §6 for why (drift risk
across three PaaS configs that would inevitably go stale).

### Services

Each is its own Railway service, configured in the Railway dashboard with
"Root Directory" pointed at the paths below. Build config for each lives in
that directory's own `railway.toml` — there is no separate root-level
service manifest to keep in sync.

- **Frontend** (`workspace/`) — Next.js app. Root Directory: repo root (uses
  the root `railway.toml`, which points at `workspace/Dockerfile`).
- **API** (`apps/backend/`) — Express + Prisma. Root Directory: `apps/backend`.
- **ML service** (`apps/ml-service/`) — FastAPI, optional. Root Directory:
  `apps/ml-service`.
- **Postgres** and **Redis** — Railway-managed.

There is currently no separate worker service: BullMQ jobs (email, PDF
export) run in-process inside the API service, toggled by
`DISABLE_INLINE_QUEUE_WORKERS`. A dedicated worker service is planned once AI
triage moves off the request thread (`docs/ENGINEERING_PLAN.md` AH-32) — add
it here when that lands, rather than declaring it ahead of the code that
would run in it.

## Setup

```bash
railway login
railway init
```

Environment variables are documented at their source, not duplicated here:

- Backend: `apps/backend/env.example`
- Frontend: `BACKEND_URL` (server-side, used by the `/api/*` proxy) — see
  `docs/deployment/RAILWAY.md` for the CORS/proxy wiring this depends on.
- ML service: `apps/ml-service/README.md`

## CI/CD

`.github/workflows/deploy.yml`:

1. Runs the full quality gate (`ci.yml`) — nothing below runs unless it passes.
2. Builds and pushes Docker images to GitHub Container Registry.
3. Deploys to Railway via `railway up`, gated on the `RAILWAY_TOKEN` secret.

## Monitoring

- Railway dashboard: https://railway.app/dashboard
- GitHub Actions: repository → Actions tab
- Logs: `railway logs --service <name>`
