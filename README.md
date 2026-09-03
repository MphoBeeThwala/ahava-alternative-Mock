# Ahava Healthcare

Ahava Healthcare is a `pnpm` monorepo for patient-facing digital care workflows, clinician review, and supporting healthcare operations. The current codebase centers on a Next.js frontend in `workspace`, an Express/Prisma backend in `apps/backend`, and an optional ML service in `apps/ml-service`.

## Overview

Core workflows in this repository include:

- patient authentication and profile management
- AI-assisted triage submission with doctor review
- prescriptions and referrals
- early-warning and biometric analysis
- real-time notifications via WebSocket

## Repository Layout

```text
.
├── apps/
│   ├── backend/        # Express API, Prisma, jobs, integrations
│   └── ml-service/     # Optional Python/FastAPI ML service
├── workspace/          # Next.js frontend application
├── docs/               # Architecture, operations, deployment notes
├── scripts/            # Reusable test, seed, and utility scripts
└── test-fixtures/      # Demo inputs for manual testing
```

## Prerequisites

- Node.js `>= 20`
- `pnpm >= 9`
- PostgreSQL
- Redis recommended for queues and multi-instance realtime
- Python `3.11` or `3.12` if you want to run the ML service locally

## Quick Start

```bash
pnpm install
Copy-Item apps\\backend\\env.example apps\\backend\\.env
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

Frontend runs on `http://localhost:3000` and the backend on `http://localhost:4000`.

## Useful Commands

```bash
pnpm dev
pnpm dev:api
pnpm build
pnpm lint
pnpm test
pnpm type-check
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm load-test:patient-pipeline
pnpm test:early-warning
```

## Documentation

Start with these:

- [Operations Guide](./docs/OPERATIONS.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Railway Deployment](./docs/deployment/RAILWAY.md)
- [Render Deployment](./docs/deployment/RENDER.md)
- [Redis Troubleshooting](./docs/REDIS_TROUBLESHOOTING.md)
- [StatPearls Integration](./docs/STATPEARLS_INTEGRATION.md)

## Windows Utilities

Windows-only helper scripts that were previously cluttering the repository root now live under:

- [`scripts/windows`](./scripts/windows)

These are operator utilities for deployment, testing, and environment support. They are not part of the normal app runtime.

## Test Fixtures

Manual demo assets for triage flows live in:

- [`test-fixtures/triage-demo`](./test-fixtures/triage-demo)

That folder includes a sample symptom narrative, synthetic upload files, and a short walkthrough for end-to-end triage testing.

## Notes

- The backend example environment file is [`apps/backend/env.example`](./apps/backend/env.example).
- The canonical Prisma schema is [`apps/backend/prisma/schema.prisma`](./apps/backend/prisma/schema.prisma).
- Railway and Render config remain at the repository root where those platforms expect them.
