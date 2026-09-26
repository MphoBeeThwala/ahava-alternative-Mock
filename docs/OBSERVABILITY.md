# Observability

Before 2026-09-26 there was none: no error tracking, no uptime monitoring. A
failure affecting a real patient would have been discovered when they
reported it. This is the minimum that changes that, and what is still
missing.

## What exists now

| Layer | What | Where | On when |
|---|---|---|---|
| API (Express) | Sentry, 5xx + crashes (`unhandledRejection`, `uncaughtException`, startup failure) | `apps/backend/src/lib/monitoring.ts`, `middleware/errorHandler.ts`, `index.ts` | `SENTRY_DSN` set |
| ML service (FastAPI) | Sentry, unhandled exceptions + 5xx | `apps/ml-service/monitoring.py`, `main.py` | `SENTRY_DSN` set |
| Frontend (Next.js) | Sentry, browser errors, server/proxy route errors, root-layout crashes | `workspace/src/instrumentation*.ts`, `src/lib/monitoring.ts`, `src/app/global-error.tsx` | `NEXT_PUBLIC_SENTRY_DSN` set **at build time** |
| Uptime | Scheduled probe of API `/ready`, frontend `/`, ML `/` every ~10 min; opens/updates a GitHub issue labelled `uptime` on failure | `.github/workflows/uptime.yml` | `UPTIME_*_URL` repo variables set |
| Dependencies | CI fails on any high/critical production advisory, in both lockfiles | `.github/workflows/ci.yml` (`dependency-audit`) | always |

All of it is inert until configured, so local dev, CI and tests send nothing.

## Turning it on (Railway)

1. Create a Sentry organisation. **Choose the EU data region** (or whichever
   region your POPIA s72 assessment settles on) — see "Data protection" below.
   Create three projects: `ahava-api` (Node), `ahava-ml` (Python),
   `ahava-web` (Next.js).
2. Backend service: set `SENTRY_DSN` (api project DSN) and
   `SENTRY_ENVIRONMENT=production`.
3. ML service: set `SENTRY_DSN` (ml project DSN) and
   `SENTRY_ENVIRONMENT=production`.
4. Frontend service: set `NEXT_PUBLIC_SENTRY_DSN` and
   `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production`, then **redeploy** — these are
   inlined into the bundle at build time (`workspace/Dockerfile` declares them
   as build `ARG`s so Railway passes them through).
5. Each service logs `[monitoring] Sentry error tracking enabled for …` at
   startup when it's on. Confirm that line in the Railway logs.
6. In Sentry, add an alert rule per project: "a new issue is created" and
   "issue seen > 10 times in 1 hour" → email/Slack to whoever is on call.
7. GitHub → Settings → Secrets and variables → Actions → **Variables**: set
   `UPTIME_API_URL`, `UPTIME_FRONTEND_URL`, `UPTIME_ML_URL` to the public
   Railway URLs. Run the "Uptime check" workflow once by hand to confirm.
8. Add an **external** uptime monitor (Better Stack, UptimeRobot — both have
   free tiers) on the same three URLs. GitHub's scheduler runs late, sometimes
   skips runs, and disables scheduled workflows after 60 days of repository
   inactivity; it is a floor, not the primary pager.

## Data protection — what is and isn't sent

Every error event is stripped of patient data at two layers: the SDK's own
`dataCollection` settings (Sentry v11 collects request bodies, headers,
cookies, query params and **stack-frame local variables** by default — in a
triage handler those locals are the patient's symptoms and vitals) are all
turned off, and `beforeSend` scrubs anything that still gets through. Prisma
error messages, which can quote query values, are reduced to class + code.

What reaches Sentry: exception type/message, stack trace with source lines,
route pattern (e.g. `/api/v1/triage/:id`), HTTP method and status, request id
(to correlate with Railway logs), an opaque user id and role, runtime/OS/
browser. No session replay, no performance tracing.

This is verified, not assumed — each layer has a test that sends a request
full of synthetic patient data through the **real** SDK to a local HTTP sink
and asserts none of it arrives:

- `apps/backend/src/lib/monitoring.pipeline.test.ts` (+ `monitoring.test.ts`)
- `apps/ml-service/tests/test_monitoring.py`
- `workspace/src/lib/monitoring.test.ts` (scrubber; the browser SDK path was
  verified by hand in headless Chromium against a production build)

The backend and ML pipeline tests were mutation-checked: with the protections
removed they fail on the leaked value.

**Still a POPIA matter:** Sentry is an offshore operator. Even scrubbed, an
error event carries a user id and IP-derived metadata is processed on
ingestion. Sentry must be listed as a processor in the privacy policy and
covered by a DPA before `SENTRY_DSN` is set in production — see
`docs/POPIA_GAPS.md`. In Sentry's project settings also enable "Prevent
storing of IP addresses" and the default server-side data scrubbers.

## Not done yet

- **Structured logging / log retention.** Logs are Railway's stdout only,
  retained per Railway's plan. No log search beyond that.
- **Metrics and alerting on clinical-pipeline health** — e.g. "no triage
  cases processed in 2 hours during business hours", ML-service latency,
  BullMQ queue depth/failed-job count. These are the failures that don't
  throw an exception and so won't show up in Sentry.
- **Performance tracing.** Deliberately off (cost, and span data is another
  PHI surface). Turn on only with the same `dataCollection` restrictions.
- **Source maps** for the frontend aren't uploaded (needs a Sentry auth token
  in the build and `withSentryConfig`); browser stack traces will be minified
  until then.
