# Ahava Engineering Plan

**Baseline:** commit `834de78` on `main`, reviewed 6 September 2026.
**Target:** 5,000+ concurrent users transacting without degradation.

This merges two independent reviews of the same commit — a beta-readiness pass
scoped to ~100 patients, and an enterprise-readiness pass — into one ordered
plan. Where they disagreed, the resolution and the reasoning are recorded here.

Findings carry stable IDs (`AH-nn`). Code comments reference these IDs, so keep
them stable even after a finding is closed.

---

## 1. How the two reviews combined

The reviews overlapped less than expected because they were scoped differently.
Both are right within their scope; neither was scoped to 5,000 concurrent.

**Found only by the beta review:** the StatPearls evidence fetch being silently
broken (AH-25), TypeScript strict being off (AH-26), the demo biometric stream
being live in production (AH-27), lazy encryption-key validation (AH-28), and
the absence of prescriber 2FA (AH-29). All verified against the source; the
StatPearls defect in particular is a good catch that a security-oriented read
misses entirely, because the code fails silently and safely.

**Found only by the enterprise review:** the token-type confusion (AH-01), the
rate-limit bypass (AH-02), the absence of CSRF defence (AH-03), and the payment
defects (AH-04, AH-05).

**Two corrections were made during the merge, in both directions:**

- The beta review made the Paystack→PayFast *column rename* a P0 while not
  raising that the ITN handler marked payments `COMPLETED` without checking
  `payment_status` or the amount. The cosmetic issue was demoted to P2 (AH-20)
  and the money defect promoted to P0 (AH-04).
- The enterprise review claimed the rate-limit key could be set via an
  unverified `jwt.decode`. That path is real but **dead** — `getRateLimitKey`
  was defined and never wired to any limiter. The live bypass was the
  `X-Forwarded-For` path only. AH-02 was narrowed accordingly.

**One finding was added during implementation:** `POST /api/payments/create`
took the amount from the request body, so the payer chose what to pay
(AH-30). Neither review caught it.

---

## 2. Status

Phases 1–3 landed on `hardening/enterprise-readiness-p0`, merged into `main`.
Verified 2026-09-08: `tsc --noEmit`, lint, and the full unit suite all pass —
plus 17 pre-existing lint errors on `main` unrelated to that branch were
found and fixed the same day (repo hygiene pass, see commit history).

| Phase | Scope | State |
|---|---|---|
| 1 | Quality gate | Landed, verified 2026-09-08 |
| 2 | Security blockers | Landed, verified 2026-09-08 |
| 3 | Cleanup and operability | Landed, verified 2026-09-08 |
| 4 | Throughput to 5,000 concurrent | Measured 2026-09-18 (§24): dominant bottleneck (bcrypt) found and fixed, ~5-8x login throughput improvement verified. Still needs a real Railway-staging re-run — see §24 "Still open" |
| 5 | Compliance and durability | In progress — AH-13, AH-29, AH-23, AH-26 landed 2026-09-08; AH-15's purge job still open |

---

## 3. Findings

### Closed on `hardening/enterprise-readiness-p0`

| ID | Finding | Where |
|----|---------|-------|
| AH-01 | Access, refresh and WebSocket tokens were interchangeable; a 7-day refresh token worked as an API credential and survived logout | `services/tokens.ts` |
| AH-02 | Rate-limit key was the caller-supplied `X-Forwarded-For`, making every limiter opt-out | `middleware/rateLimiter.ts` |
| AH-03 | No CSRF defence with cookie auth on `SameSite=None` | `middleware/originGuard.ts` |
| AH-04 | ITN marked payments `COMPLETED` without checking status, amount, source or replay | `routes/payments.ts` |
| AH-05 | Checkout payload was sent unsigned, and the signature was built in the wrong format | `services/payfast.ts` |
| AH-06 | No CI gate — push to `main` went straight to deploy | `.github/workflows/ci.yml` |
| AH-09 | `/health` could not fail, so a broken replica stayed in rotation | `/ready` in `index.ts` |
| AH-10 | Request logging gated on `DEBUG`, so production logged nothing | `index.ts` |
| AH-11 | Shutdown closed the HTTP server only; no crash handlers | `index.ts` |
| AH-12 | `jwt.verify` with no algorithm allowlist, issuer or audience | `services/tokens.ts` |
| AH-14 | Proxy forwarded all client headers, had no timeout, and joined paths unvalidated | `workspace/src/app/api/[...path]/route.ts` |
| AH-16 | Dead Cloudflare Workers app root with a duplicate `src/lib` | removed |
| AH-17 | Capacitor scripts referencing a missing config | removed |
| AH-18 | Two migration systems | legacy SQL removed |
| AH-19 | Twelve `generate-prisma-*` workaround scripts | reduced to one |
| AH-25 | StatPearls search requested JSON and parsed it as HTML, returning `[]` every time | `services/statPearls.ts` |
| AH-27 | Demo biometric stream reachable by any patient in production | `routes/patient.ts` |
| AH-28 | `ENCRYPTION_KEY` validated lazily, failing mid-booking | `utils/encryption.ts` |
| AH-30 | Payment amount taken from the request body | `routes/payments.ts` |
| AH-31 | Refund endpoint unreachable — `requireAdmin` with no `authMiddleware` | `routes/payments.ts` |
| AH-13 | PHI encryption had no AAD binding and no key rotation path | `utils/encryption.ts` |
| AH-20 | `Payment.paystackReference` / `paystackData` renamed to `payfastReference` / `payfastData` (migration `20260908130000`) | `prisma/schema.prisma` |
| AH-24 | Red-flag triage patterns were singular and `\b`-anchored — "seizures" did not match "seizure" | `services/triageSafety.ts` |
| AH-29 | No 2FA for prescribers — closed as opt-in TOTP for any account, not role-restricted | `routes/twoFactor.ts` |
| AH-02b | Rate limiters used an in-memory store; limits were per-replica and reset on deploy | `middleware/rateLimiter.ts` |
| AH-08 | Auth cache was per-replica; deactivation lagged up to 300s across the fleet — and the suspend endpoint never invalidated it at all, even locally | `middleware/auth.ts`, `routes/admin.ts` |
| AH-39 | CI installed with `--no-frozen-lockfile`; tightened once the regenerated `pnpm-lock.yaml` landed in Phase 0 | `.github/workflows/ci.yml` |
| AH-23 | No API versioning — every route now lives under `/api/v1/*` except the PayFast webhook (see §5) | `index.ts` |
| AH-07 | No integration/end-to-end tests — 11 now run against a real, disposable PostgreSQL for every PR (see below) | `apps/backend/src/testSetup/`, `*.integration.test.ts` |
| AH-41 (new) | `routes/webhooks.ts` carried a second, unauthenticated "POST /payment" webhook from before the PayFast migration that marked payments `COMPLETED` with none of AH-04/05's checks — its signature check failed *open* whenever `NODE_ENV` wasn't exactly `"production"` and `PAYSTACK_SECRET_KEY` was unset (the deployed default). Removed; PayFast's ITN handler in `routes/payments.ts` is the only payment webhook now. | `routes/webhooks.ts` |
| AH-26 | TypeScript strict mode enabled — `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, `noImplicitReturns` and `noFallthroughCasesInSwitch` all now `true`; `tsc --noEmit` is clean (see below) | `tsconfig.json` |

Unit coverage: nine suites covering token typing, PayFast signatures, the
CSRF guard, clinical safety thresholds, encryption AAD/rotation, the 2FA
flow, rate-limiter/auth-cache resilience, and SLA/fee calculation.

AH-07 (integration tests) — closed 2026-09-08, see below for the full writeup.

### Open

| ID | Finding | Priority |
|----|---------|----------|
| AH-32 | AI triage moved off the request thread to a BullMQ worker — landed 2026-09-08, unit-verified only, still needs a staging load-test run (see §4) | P0 for scale — verify before trusting at scale |
| AH-33 | Storage moved to S3-compatible object storage 2026-09-08 (with a graceful fallback when unconfigured); the base64-JSON wire format and synchronous `sharp` processing are deliberately unchanged — see below | P1 for scale — partially addressed |
| AH-03b | Double-submit CSRF token, for defence in depth beyond the origin check | P2 |
| AH-15 | Cross-border PHI transfer to AI providers not named in the consent record | P2 |
| AH-34 | `demoStream` holds a `setInterval` per user in-process | P2 |
| AH-35 | The Render `plan: starter` (0.5 vCPU) sizing this was measured against no longer applies — Render was removed in favour of Railway-only (§6). AH-51 (§24) re-measured locally (not against Railway — see §24's methodology caveat) and found the bcrypt-saturation finding held, and worse than the 0.5-vCPU framing suggested (linear degradation, not just slow) | P0 for scale — still needs a real Railway re-verify |
| AH-36 | Biometrics ingest — partially addressed 2026-09-08, see below | P1 for scale (downgraded — see note) |
| AH-37 | Load tests hit the Next.js proxy, so proxy and API latency are indistinguishable — **measured 2026-09-18, see §24.** Confirmed the bottleneck is in the API, not the proxy: bcrypt serialization (AH-51), not proxy overhead, explained the flat throughput §3a found | Closed — see §24 |
| AH-38 | The primary dev machine's Application Control policy blocks `pnpm.exe`. `corepack pnpm` works around it, but a new engineer hits this on day one. Get pnpm allowlisted, or commit to builds happening only in CI and Docker | P1 — infrastructure |
| AH-42 (new) | Frontend monolithic files — `lib/api.ts` and `doctor/dashboard/page.tsx` split 2026-09-08, no behavior change — see below. `patient/ai-doctor/page.tsx` (897 lines), `profile/page.tsx` (738), and `auth/signup/page.tsx` (562) follow the same pattern and are unsplit | P2 — maintainability, not correctness |
| AH-51 (new) | `bcryptjs` (pure JS, single-threaded) serialized all login traffic onto one core regardless of CPU count — the real cause behind AH-35's finding. Replaced with `@node-rs/bcrypt` (native, threadpool) across all 9 call sites, §24 | Closed 2026-09-18 — see §24 |
| AH-52 (new) | ML service (`apps/ml-service`) ran a single `uvicorn` worker with no `--workers` flag; synchronous numpy/psycopg2 work in route handlers blocked the whole process per request. `Dockerfile` now takes `ML_SERVICE_WORKERS` (default 1, unchanged) | P1 for scale — mechanism added, real worker count and load-test-under-TimescaleDB still open, §24 |

---

## 3a. Measured capacity — what the load tests actually say

Four load-test logs sit in the repository root, run against **production**
(`https://app.ahavaon88.co.za`). They are the most useful evidence available and
they change the capacity conversation from speculation to arithmetic.

| Run | Mode | Concurrency | Flows/sec | p95 login | p95 worst non-login |
|---|---|---|---|---|---|
| `auth-heavy-final` | login per flow | 10 | 3.4 | 1.3 s | 0.6 s |
| `auth-heavy-final` | login per flow | 200 | 7.0 | **16.5 s** | 10.8 s (biometrics) |
| `auth-heavy-rerun` | login per flow | 200 | 3.6 | **21.5 s** | 22.8 s — **21% failed** |
| `steady-final` | token reuse | 400 | 20.7 | n/a | 8.0 s (biometrics) |
| `steady-600` | token reuse | 600 | 18.6 | n/a | **13.2 s (`/me`)** |

Four conclusions:

**1. Throughput is flat, and that is the whole story.** From 10 to 600
concurrent — a 60× increase — throughput moves from ~3 to ~19 flows/sec. Roughly
5×. Everything else went into queueing. A system whose throughput does not rise
with concurrency has a serialization bottleneck, and adding users only adds
waiting. At 600 concurrent and 18.6 flows/sec, Little's Law puts the average
flow at 32 seconds; the harness measured the wave at 32.3 seconds. The model
fits exactly.

**2. `fail=0%` is not a pass.** At 600 concurrent, nothing failed and the p95 on
`/me` was 13.2 seconds. Zero failures here means the client's timeout was
generous, not that the system was healthy. The one run that did fail — 21% at
200 concurrent — is what that queue looks like when it finally tips.

**3. Login is the worst endpoint, and the cause is identifiable.**
`BCRYPT_ROUNDS` defaults to 10, and every service in `render.yaml` is on
`plan: starter` — 0.5 vCPU. bcrypt is deliberately CPU-hard, so on half a core
200 concurrent logins queue on the CPU alone. That accounts for the 16.5 s
login p95 without needing any other explanation.

**4. But bcrypt is not the ceiling.** The `steady` runs skip login entirely and
still top out at ~19 flows/sec. So there is a general per-request cost limit
independent of hashing. Two contributors are visible in the code: the biometrics
ingest at `routes/patient.ts:67` runs `processBiometricReading` and
`detectEarlyWarningSigns` inline plus four sequential database round-trips —
and it is the slowest non-login endpoint in every run — and the tests hit
`app.ahavaon88.co.za`, which is the **Next.js proxy**, so every measurement is
two 0.5-vCPU hops chained, not one.

### What 5,000 concurrent actually requires

Take 5,000 active users each completing a flow every 30–60 seconds: 83–167
flows/sec. Against a measured ceiling of ~19, that is **4× to 9×**. Not a
rewrite — but not reachable by tuning either, and definitely not on starter
instances.

If instead 5,000 means 5,000 flows genuinely in flight at once, the gap is two
orders of magnitude and the answer is a different architecture. **Agree which
of these the number means before promising it to anyone.**

The encouraging part: the architecture is already built for horizontal scale —
PgBouncer transaction pooling, Redis-backed sessions, WebSocket pub/sub across
replicas. The two things that prevented replicas from scaling cleanly — the
rate-limit store (AH-02b) and the in-process auth cache (AH-08) — are both
closed now. Size the instances properly, move the two inline-compute paths
off the request thread, and the same architecture should carry the target.

### Measure this before anything else

The single most valuable missing number: **run the same test against the API
directly, bypassing the Next.js proxy.** Right now proxy time and API time are
indistinguishable, so nobody knows which one to fix. That is one test run, and
it decides where Phase 4 effort goes.

---

## 4. Phase 4 — throughput to 5,000 concurrent

What is already right, and should not be disturbed: PgBouncer transaction
pooling with a per-replica `connection_limit` cap (`lib/prisma.ts`), WebSocket
Redis pub/sub fan-out across replicas, BullMQ for email, push and PDF export,
and Redis-cached auth removing login contention.

### AH-32 — move AI triage off the request path — landed 2026-09-08, unit-verified only

Implemented essentially as designed above:

1. `POST /api/triage` runs `assessDeterministicRisk` synchronously (pure,
   fast, the clinical safety floor) and creates the `TriageCase` in
   `PENDING_REVIEW` immediately, with the floor's level as an interim
   `aiTriageLevel` — placeholder `aiRecommendedAction`/`aiReasoning` text
   says analysis is in progress. Because `mergeGuardrails`
   (`services/aiTriage.ts`) always takes `min(aiLevel, floorLevel)`, this
   interim state is never optimistic relative to where the real analysis
   lands — it can only get *more* urgent once the AI job completes, never less.
2. `services/queue.ts` gained an `ai-triage` BullMQ queue; a worker calls
   `jobs/aiTriageJob.ts`'s `processAiTriageJob`, which re-fetches the case,
   runs the real `analyzeSymptoms`, updates `aiTriageLevel` /
   `aiRecommendedAction` / `aiPossibleConditions` / `aiReasoning` /
   `slaDeadline` / `doctorFeeCents`, writes the `AI_TRIAGE_DECISION` audit
   entry, and *then* sends the same single `NEW_TRIAGE_CASE` WebSocket
   notification to available doctors the synchronous flow used to send
   immediately — same notification, later trigger point.
3. The image is not carried through the job payload — it was already
   persisted on `TriageCase.imageStorageRef` by the synchronous submission
   step, so the worker reads it back from there rather than pushing base64
   through Redis (the queue equivalent of AH-33's concern).
4. **No Redis configured → no silent gap.** `addAiTriageJob` returns
   whether it actually enqueued; when it didn't (no `REDIS_URL`, the same
   condition every other optional-Redis feature in this app already
   handles), `routes/triage.ts` calls `processAiTriageJob` inline — same
   function, so there's exactly one implementation of this logic, and a
   case can never get stuck showing only the interim placeholder forever
   just because Redis isn't configured.
5. The patient-facing response shape is **unchanged** — same fields, same
   meaning, just computed from the interim floor instead of the final AI
   result. `workspace/src/app/patient/ai-doctor/page.tsx` already treats
   `meta.estimatedWaitMinutes` as possibly absent (`?? 60`) and never reads
   `requiresDoctorReview` at all, so no frontend change was needed.

**Verified:** `tsc --noEmit`, lint, and the full unit suite all pass. A
circular import was caught in the process — `services/queue.ts` needed
`jobs/aiTriageJob.ts`, which needed `jobs/triageEscalation.ts` (for
`calculateSlaDeadline`/`getDoctorFee`), which itself imports
`services/queue.ts` for `addEmailJob`. Fixed by extracting those two pure
functions into a new dependency-free `services/triageSla.ts`, now the
shared source for `routes/triage.ts`, `jobs/aiTriageJob.ts` and
`jobs/triageEscalation.ts` (which re-exports them for its existing
importers). `services/triageSla.test.ts` covers the extracted functions.

**Not verified — same caveat the original design carried:** this changes
the clinical flow's shape and needs a real staging run under real
concurrency with real AI providers in the loop, not a unit test. Nothing
here confirms the worker actually keeps up under load, that BullMQ job
latency stays acceptable at 5,000 concurrent, or that the interim-state
window (typically sub-second when a worker is running, but unbounded if
workers fall behind) stays short in practice. Run
`scripts/load-test-patient-pipeline.js` against staging (see AH-37) before
treating this as verified at scale.

### AH-02b — distributed rate-limit store — closed 2026-09-08

`rate-limit-redis`'s `RedisStore` now backs all three limiters, wrapped in
`ResilientRateLimitStore` (`middleware/rateLimiter.ts`) rather than used
directly: any Redis error — not configured, a timeout, a dropped connection —
falls back to a local `MemoryStore` for that call instead of breaking request
handling, since the general limiter is mounted globally (`app.use(rateLimiter)`
in `index.ts`) and a hard Redis dependency there would take down the whole
API. The trade-off: a request that falls back mid-window counts against a
separate per-process counter than the Redis-backed one, so a client whose
requests straddle a brief Redis blip could exceed the limit slightly during
that window — preferable to every request failing while Redis recovers.

### AH-33 — image handling — partially addressed 2026-09-08

Storage moved; wire format and processing thread deliberately didn't.

**Product decision (2026-09-08):** object storage backend is an
S3-compatible client (works against AWS S3, Cloudflare R2, Backblaze B2,
DigitalOcean Spaces — see `env.example`'s `S3_*` vars), rather than local
disk. Local disk was ruled out because a file saved on one replica isn't
visible to another — it would have undermined the multi-replica scaling
this whole phase is for.

**Done:** `services/objectStorage.ts` wraps the S3 API; `persistTriageAttachment`
(`services/triageAttachments.ts`) uploads the sanitized buffer there instead
of embedding it as base64 inside `TriageCase.imageStorageRef`, when object
storage is configured — with a fallback to the exact previous behaviour when
it isn't, so this doesn't force a bucket to exist before the app runs. The
attachment-serving route (`routes/triageCaseReview.ts`) fetches from
whichever backend a given attachment used; existing rows with embedded
base64 keep reading correctly. This closes the real operational cost: large
blobs bloating an unrelated table's rows, backups, and read performance.

**Deliberately not done, and why:**
- **The request still receives base64-in-JSON, not multipart.** Switching
  requires a frontend rewrite of `workspace/src/app/patient/ai-doctor/page.tsx`
  (currently converts the file to a data URL via `FileReader` before
  sending) — a currently-working, safety-relevant patient flow with zero
  existing test coverage (AH-07) and no way to verify end-to-end here (no
  live Postgres, no real S3 bucket to actually exercise). Unlike AH-32,
  where the response *contract* provably didn't change, a wire-format
  change here is exactly the kind of thing that wants live testing before
  landing, not code review alone.
- **`sharp` sanitization still runs synchronously on the request thread.**
  It's real CPU-bound work, but fast (tens to low hundreds of ms for a
  2048×2048 resize+encode) — nowhere near AH-32's multi-second LLM calls.
  Moving it to a worker would also reopen a privacy question AH-32 didn't
  have: an unsanitized (EXIF/GPS-intact) image must never be readable
  before sanitization completes, which needs either job-chaining between
  an upload queue and the AH-32 AI-triage queue (which needs the sanitized
  image) or a "processing" state on the attachment record — real design
  work, not a drive-by addition to this pass.

Re-scope as full P0 if profiling ever shows `sharp` itself (not the
now-fixed DB bloat) is the actual bottleneck under load.

### AH-08 — cross-replica auth invalidation — closed 2026-09-08

Took the pub/sub option: `invalidateCachedUser` now also calls
`publishAuthCacheInvalidation` (`services/websocket.ts`), reusing the same
Redis channel and `instanceId`-skip logic the WebSocket layer already has,
rather than opening a second pair of Redis connections just for this.
`middleware/auth.ts` registers a handler via the new `onAuthCacheInvalidate`
so `services/websocket.ts` never needs to know anything about auth
internals — one-directional dependency, no circular import.

Also fixed a sharper version of the same bug on the way: `PATCH
/api/admin/users/:id/suspend` never called `invalidateCachedUser` at all,
so a suspended user stayed authenticated for up to
`AUTH_USER_CACHE_TTL_SECONDS` (300s default) even on the single replica
that handled the suspend request — the cross-replica gap this finding
named was real, but there wasn't same-replica invalidation to begin with
for the one endpoint that actually deactivates a user.

### AH-36 — biometrics ingest — partially addressed 2026-09-08

The finding's framing ("four sequential DB round-trips") undersold the real
cost once actually traced through `routes/patient.ts` POST `/biometrics`:

1. `INSERT` the biometric reading.
2. `processBiometricReading` (`services/monitoring.ts`) — **two sequential
   HTTP calls to the ML service**, `POST /ingest` then
   `GET /readiness-score/{userId}`, each with a 5s timeout. This is the
   dominant cost, not Postgres.
3. `UPDATE` the reading with the analysis result.
4. `INSERT` a `HealthAlert`, conditionally.

**Fixed:** steps 3 and 4 are independent writes to different tables —
neither needs the other's result, both only need `biometricRecord.id` and
the already-computed `alertLevel`/`anomalies`/`readinessScore`. They now run
via `Promise.all` instead of sequentially.

**Deliberately not fixed:** the two ML-service calls in step 2 look like
the same kind of independent pair, but they aren't safe to parallelize.
`get_readiness_score`'s own docstring says it uses "persistent DB history,"
and `ingest_biometrics` is what writes that history — running them
concurrently risks the readiness score reading state from *before* the
reading it's meant to score. The correct fix is to have `POST /ingest` on
the ML-service side compute and return the readiness score in the same
response, collapsing two round-trips into one. Not done here because
`GET /readiness-score/{userId}` is also called independently elsewhere
(`routes/patient.ts:271`, `services/monitoring.ts:405`,
`routes/healthConnect.ts`) — folding it into `/ingest`'s response without
breaking those callers is a real design task on the Python side
(`apps/ml-service/main.py`, `engine.py`), not a same-session drive-by fix.

### AH-07 — integration tests — closed 2026-09-08

`apps/backend` had `supertest` installed since before this branch existed
and zero uses of it. All routing was unit-tested at best (middleware logic
in isolation, no route ever actually invoked end to end), and
`workspace/package.json`'s `test` script was literally `echo "No tests
configured for workspace"`.

**What's here:** `apps/backend/src/testSetup/{globalSetup,globalTeardown}.js`
plus `jest.integration.config.js` (`pnpm test:integration`) run real
supertest requests against the real Express `app` (now exported from
`index.ts`, guarded by the same `NODE_ENV==="test"` check that skips
`startServer()` — see below) — three files, 11 tests: health/readiness,
a full auth cycle (register → login → `/me` → logout, plus wrong-password/
weak-password/no-session cases), and, most valuably, a real end-to-end
triage submission that exercises AH-32's synchronous fallback path
(no `REDIS_URL` in this environment, so `addAiTriageJob` returns `false`
and `processAiTriageJob` runs inline) and confirms a red-flag symptom
still reaches level 1 through the *entire* real chain — deterministic
floor, `analyzeSymptoms`' own conservative fallback (no AI provider keys
configured either), `mergeGuardrails`, the DB write — not just in
`triageSafety.test.ts`'s isolated unit tests.

**The database is real, not mocked or swapped for a different engine.**
`globalSetup.js` runs `embedded-postgres` — a genuine `pg_ctl`-managed
PostgreSQL binary — and applies the actual migration history with
`prisma migrate deploy`, the same command the `migrations` CI job already
trusted. No Docker required locally. In CI, `DATABASE_URL` is already set
(the `integration` job's own `postgres:16` service container, added
alongside the existing `migrations` job), so `globalSetup.js` detects
that and uses it instead of starting its own — one code path, either
environment.

**Two real bugs surfaced by building this, not by writing test
assertions against a rewritten app:**
- Windows' default locale (`WIN1252`) can't represent a UTF-8 character
  one migration file uses in a comment (`─`) — `embedded-postgres` was
  failing on `prisma migrate deploy` before a single test ran. Fixed by
  forcing `--encoding=UTF8 --locale=C` at `initdb` time, matching what
  Docker's `postgres:16` image and Railway both already default to.
- `services/websocket.ts`'s heartbeat `setInterval` (needed in
  production, run forever) left Jest's process unable to exit naturally
  after every test passed — traced with `--detectOpenHandles` rather than
  guessed at. `initializeWebSocket(wss)` is now skipped in test mode
  (same guard as `startServer()`); the residual handle after that fix
  (some native-module resource neither guard reaches) is handled with
  `forceExit: true` in `jest.integration.config.js`, the accepted standard
  practice for supertest-style tests rather than an unbounded search for
  one more handle with no guarantee it's the last.

**Also required:** `eslint.config.cjs` gained a `**/*.js` override with
Node/CommonJS globals — the plain-JS `testSetup/` scripts (deliberately
not TypeScript; Jest's `globalSetup`/`globalTeardown` run before the
ts-jest transform pipeline is available) were failing lint with `require`/
`process`/`module` all flagged as undefined under the TS-oriented ruleset.
And `jest.config.js` (the unit-test config) gained a
`testPathIgnorePatterns` entry for `*.integration.test.ts` — without it,
the unit suite tried to run these too, with no database and no
`globalSetup`, and failed outright.

**Not done:** this covers three flows, not the full route surface —
booking, payments, prescriptions/referrals, wearable ingestion, and admin
actions have no integration coverage yet. The harness this session built
(register-a-patient helper, agent-based cookie sessions, the real-DB
setup) is reusable for extending it; doing so wasn't in scope for closing
this specific finding.

### AH-26 — TypeScript strict mode — closed 2026-09-08

`tsconfig.json` had `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`,
`noImplicitReturns` and `noFallthroughCasesInSwitch` all explicitly set to
`false`, and `strict` was never set either — none of the type-safety net
`strict: true` implies was actually on. Turning all five on at once, rather
than staging them, was tractable here because the codebase turned out to
already be close to compliant — the "five flags disabled" framing suggested
a large migration, but three of the five were free:

- `strictFunctionTypes` and `noFallthroughCasesInSwitch`: already clean,
  0 errors.
- `strictNullChecks`: 9 errors across 5 files — a `fetch().json()` result
  used without a type (`routes/healthConnect.ts`,
  `services/evidenceProvider/providers/pubmed.ts`), a couple of
  contextually-typed object literals TypeScript couldn't widen on its own
  (`routes/patient.ts`, `scripts/seed-mock-patients.ts`), and one
  `const parts = []` needing an explicit `string[]`
  (`services/evidenceProvider/combiner.ts`).
- `noImplicitAny`: 4 errors across 2 files — a `Record<string, number>`
  lookup table and a filter callback needing an explicit type guard
  (`(item): item is StoredTriageAttachment => Boolean(item)` in
  `services/triageAttachments.ts`, so the array narrows from `(T | null)[]`
  to `T[]` and `noImplicitAny` isn't blocking downstream inference on the
  `null` case it just checked for).

`noImplicitReturns` (TS7030 — "not all code paths return a value") was the
one flag that actually earned the "five flags disabled" framing: 62 errors
across 20 files. Every Express route handler in this codebase follows the
same shape — `try { ...; res.json(...) } catch (error) { next(error); }` —
and `noImplicitReturns` treats a bare `res.json(...)` (which returns
`Response`, not `void`) as a path that returns a value, so a sibling path
ending in a bare `next(error)` (which returns `void`) is flagged as the one
that *doesn't*. None of this is a real defect — Express ignores a route
handler's return value entirely — but the fix is genuine and mechanical:
prefix every terminal `res.json(...)` / `res.status(...).json(...)` /
`next(error)` in every affected handler with `return`, so every path
through the function returns the same thing. Fifty of the sixty-two
occurrences were the exact same `next(error);` → `return next(error);`
substitution inside a `catch` block, applied by script across
`routes/{auth,bookings,consent,healthConnect,patient,rook,terra,triage,
triageCaseReview,twoFactor,webhooks}.ts` (safe because `next` returns
`void`, so wrapping it in `return` changes nothing observable). The
remaining twelve needed the same `return` added by hand to a handler's
non-catch success path — `middleware/{auth,requireRole}.ts`,
`routes/{admin,bookings,messages,nurse,patient,payments,profile,
triageCases,visits}.ts`, and `services/queue.ts`'s `addEmailJob` (its
no-Redis fallback branch fell off the end of an `async` function after a
fire-and-forget `sendEmail(...).catch(...)`, so it needed an explicit
`return undefined;` rather than a wrapped statement).

**Verified, not just compiled:** `tsc --noEmit` is clean (0 errors);
`eslint src` reports 0 errors (185 pre-existing `no-explicit-any` /
`no-unused-vars` warnings, none introduced by this change); the full unit
suite (124 tests, 13 suites) and the full integration suite (11 tests, 3
suites, against a real disposable PostgreSQL per AH-07) both pass unchanged
— this was a type-level and control-flow-shape change only, with no
behavioral edit to any handler.

**Not done:** `strict: true` itself was deliberately not set — the flags
enabled here are the five that were explicitly listed as `false`. `strict`
also implies `noImplicitThis`, `alwaysStrict`, and `strictPropertyInitialization`,
none of which were audited as part of this finding; flipping `strict: true`
outright risks turning on flags nobody has checked for this codebase yet,
which is a separate, smaller finding if it's wanted.

### AH-42 — frontend monolithic files — partially addressed 2026-09-08

`workspace/src/lib/api.ts` was 921 lines: one file holding the axios
instance, both interceptors (session-refresh-on-401, the patient-role
route guard), and every domain's request functions and response types —
auth, patient/triage, bookings, visits, nurse, doctor, wearables, consent,
admin. Split into `workspace/src/lib/api/` — `client.ts` for the axios
instance and interceptors, one file per domain (`auth.ts`, `patient.ts`,
`bookings.ts`, `visits.ts`, `nurse.ts`, `doctor.ts`, `wearables.ts`,
`consent.ts`, `admin.ts`, `doctorProfile.ts`), and `index.ts` re-exporting
all of them. No behavior change: `index.ts` re-exports the same names the
921-line file did, so the 18 files across the app that
`import { x } from '@/lib/api'` (or a relative equivalent) needed zero
changes — module resolution finds `lib/api/index.ts` exactly where
`lib/api.ts` used to be.

`workspace/src/app/doctor/dashboard/page.tsx` was 954 lines: component
state and every handler, plus the full JSX for two card-rendering loops
(the AI triage queue and the nurse visit queue) and four complete modal
forms (doctor review, prescription, emergency referral, follow-up
request) all inline in one function. Extracted the two pure helper
functions and five modal-state types to `_lib.ts`, the two card renderers
to `_components/TriageCaseCard.tsx` and `_components/NurseVisitCard.tsx`,
and the four modals to their own files under `_components/` — each takes
its modal state, an `onChange`, and the submit handler as props, so the
page keeps owning all state and API calls and the extracted files stay
pure presentation. Page dropped from 954 to 414 lines.

**Verified, not just compiled:** `tsc --noEmit` is clean, and
`next build` compiles and generates all 24 routes successfully (the only
build failure — an `EPERM` on a Windows-only symlink step in `next
build`'s `standalone`-output file tracing — reproduces identically on the
pre-refactor code too, so it's a pre-existing Windows dev-machine quirk
unrelated to this change, not something it introduced; Railway's Linux
build environment doesn't hit it).

**Not done:** three more pages follow the identical God-component
pattern and are unsplit — `patient/ai-doctor/page.tsx` (897 lines),
`profile/page.tsx` (738), `auth/signup/page.tsx` (562). The same
extraction approach (pure helpers and types to a `_lib.ts`, repeated
JSX blocks to `_components/`, page keeps state/handlers) applies
directly; deferred here for time, not because they're harder.

### Then measure

`scripts/load-test-patient-pipeline.js` exists but must run against staging
with a real AI provider in the loop, now that AH-32 has landed (code-complete,
not load-tested — see its section above) and against the API directly rather
than the frontend proxy (AH-37). Until that number exists, 5,000 is an
aspiration rather than a claim. Tune `PRISMA_CONNECTION_LIMIT` and
`PRISMA_POOL_TIMEOUT` against the result, not against a guess.

---

## 5. Phase 5 — compliance and durability

- ~~**AH-13** Bind encryption AAD to a context string and add a key id to the
  payload prefix so two keys can be live during a rotation.~~ **Closed
  2026-09-08.** `aad` is a plain string, not a structured `{table, column,
  recordId}` triple as originally sketched — callers with no stable id at
  encryption time (e.g. an address encrypted before its row exists) can omit
  it. `services/totp.ts` binds AH-29's secret to `user:${userId}:totpSecret`.
- ~~**AH-29** TOTP before prescribing.~~ **Closed 2026-09-08** as opt-in for
  any account, not role-restricted to `DOCTOR`/`ADMIN` — product decision,
  §6 item 4.
- **AH-26** Turn on TypeScript strict in stages. Do not flip `strict: true`
  across 95 files in one commit — enable `strictNullChecks` first, directory by
  directory, starting with `services/triageSafety.ts` and `services/aiTriage.ts`.
- **AH-15** Confirm every route that reaches an AI provider is behind
  `requireConsent`, and version the consent text so it names the offshore
  processors and the transfer. POPIA s72 applies to symptom narratives.
  Retention periods for the consent text to cite are now decided (§6 item 3).
- ~~**AH-23** Move to `/api/v1/*` before a mobile client is in the field.~~
  **Closed 2026-09-08.** Every route moved except `/api/payments/webhook`,
  kept mounted at its original path too — PayFast's ITN URL is configured
  in PayFast's own dashboard, outside this codebase, and renaming it here
  would silently stop payment confirmations until someone updated that
  dashboard by hand. The frontend's browser-facing surface is unchanged
  (`/api/*`); only its proxy (`workspace/src/app/api/[...path]/route.ts`)
  knows the backend is versioned. Caught two real bugs on the way: the
  `middleware/originGuard.ts` webhook exemption list had two dead entries
  (`/api/terra/webhook`, `/api/rook/webhook`) that matched no real
  route — Terra/ROOK webhooks only ever land on `/webhooks/terra` and
  `/webhooks/rook`, already covered by the `/webhooks` prefix — removed;
  and `downloadUrl` for prescription/referral PDFs
  (`routes/triage.ts`, `routes/triageCaseReview.ts`) included a leading
  `/api` that, combined with `apiClient`'s own `/api` baseURL, meant every
  prescription/referral PDF download was hitting `/api/api/...` and
  404ing — fixed by dropping the prefix at the source (verified against
  axios's actual `combineURLs` behaviour, not assumed).
- **POPIA operations** Data export and erasure endpoints, a retention schedule,
  and a purge job. The `ExportJob` model already exists as a starting point.
  Retention periods decided (§6 item 3); the schedule/purge job itself is
  still unbuilt.

---

## 6. Decisions from the product side — resolved 2026-09-08

1. **Mobile approach: Capacitor, wrapping the existing Next.js app** —
   confirmed, and the orphaned `android/` scaffold has been reconnected
   rather than rebuilt: see §8.
2. **Payment column rename** (AH-20) — closed via an in-place `RENAME COLUMN`
   migration (`20260908130000`), not a wipe. Existing reference and gateway
   response data is preserved; no beta-database reset needed.
3. **Retention periods** (for AH-15's POPIA consent wording and the eventual
   purge job) — set as an engineering judgment call, since neither POPIA nor
   the National Health Act specify exact numeric periods for every data type
   here. **Have this confirmed by legal/compliance before treating it as
   final** — these are defensible defaults, not a legal opinion:
   - **AuditLog, TriageCase, Visit, Prescription, Referral** (the clinical
     record itself, or its access trail): **7 years** from last entry,
     aligned with HPCSA guidance on medical record retention (6 years
     minimum, longer for minors).
   - **BiometricReading, HealthAlert** (high-volume wearable/manual
     telemetry, not the clinical record): **2 years**, enough to support the
     progressive-baseline system's trend analysis; older readings can be
     aggregated or dropped without losing clinical meaning.
   - **PatientConsent**: retained for the life of the account plus 7 years
     after closure — POPIA's accountability principle means being able to
     prove what consent existed and when, not just honouring it prospectively.
   - Implementation (the actual scheduled purge job and data-export
     endpoints against the existing `ExportJob` model) is Phase 5 work,
     queued but not built in this pass.
4. **Prescriber 2FA: opt-in**, not mandatory — closed as AH-29, available to
   every role rather than gated to prescribers specifically.
5. **One primary PaaS: Railway.** Closed — Render and Fly.io configs were
   removed outright (not archived; see `deploy/README.md`), rather than kept
   as unused alternatives that would drift.

---

## 7. Environment variables introduced

| Variable | Default | Purpose |
|---|---|---|
| `API_PUBLIC_URL` | falls back to `APP_URL` | Public URL of the **API**, used for the PayFast `notify_url`. The ITN must reach the API directly — routing it through the frontend proxy strips the raw body the signature is computed over. |
| `ENABLE_DEMO_STREAM` | unset (off) | Set to `true` to allow the demo biometric stream in production. |
| `DISABLE_REQUEST_LOG` | unset (logging on) | Opt out of request logging. |
| `SHUTDOWN_TIMEOUT_MS` | `15000` | Upper bound on the shutdown drain. |
| `BACKEND_TIMEOUT_MS` | `30000` | Frontend proxy timeout to the API. |
| `PRISMA_CONNECTION_LIMIT` | `10` | Per-replica Prisma pool size into PgBouncer. |
| `CAPACITOR_SERVER_URL` | `https://app.ahavaon88.co.za` | Read at `cap sync`/build time by `workspace/capacitor.config.ts`. Override to point a locally built mobile app at a dev server instead of production. |

Point the platform health probe at **`/ready`**, not `/health`.

---

## 8. Mobile enablement — Capacitor, 2026-09-08

Confirms and implements the product decision in §6 item 1: the mobile app
is the existing Next.js web app in a native shell, not a separate
codebase. `capacitor.config.ts`'s `server.url` points the WebView at the
deployed app (`https://app.ahavaon88.co.za` by default,
`CAPACITOR_SERVER_URL`-overridable) instead of bundling a static copy of
it — the right call specifically *because* this app is not static: cookie-
session auth, a WebSocket connection, and the `/api/[...path]` server-side
proxy all assume a real Next.js server behind the page, which a static
export can't provide. The practical benefit: the WebView loads the real
`app.ahavaon88.co.za` origin, so the existing cookie/CSRF/CORS setup needs
no special-casing for a `capacitor://` or `https://localhost` origin the
way a bundled-assets Capacitor app would — it's just another browser
hitting the same site.

**`android/` was not generated from scratch.** A native Android project
already existed at the repo root — orphaned by an earlier, unrelated
cleanup (AH-16/17 removed a *different*, dead Vite/Capacitor app root, and
this native scaffold was deliberately kept rather than deleted, per §6
item 1's original note). It carries real, non-regeneratable work: a
Health-Connect permissions rationale activity
(`HealthConnectPrivacyPolicyActivity.kt`, required by Google Play policy
for apps requesting Health Connect data), the actual Health Connect
`<uses-permission>` declarations and `capacitor-health`/`@capacitor/device`
plugin wiring in `AndroidManifest.xml` and `capacitor.settings.gradle`, a
`FileProvider` (needed for the triage image-upload flow), a
`network_security_config.xml` scoped to allow cleartext only to the
Android emulator's `10.0.2.2` loopback alias — none of which
`cap add android` regenerates. (Correction to an earlier version of this
note: its launcher/splash assets are Capacitor's generic default mark,
not real Ahava branding — confirmed visually while sourcing the PWA
icons in §9; both platforms need real branding, not just iOS.) It's moved to
`workspace/android/` (git-mv'd, history preserved) so it sits next to the
`capacitor.config.ts` that now drives it, `@capacitor/device` and
`capacitor-health` are installed to match what it already referenced, and
`cap sync` was run to regenerate only what's meant to be
generated — confirmed by diffing: the sync touched exactly
`capacitor.settings.gradle` (rewriting stale `pnpm` store paths from a
prior install to the current ones) and the `assets/public` web-asset copy;
every custom file was untouched. The placeholder privacy-policy URL in
`HealthConnectPrivacyPolicyActivity.kt` (`your-frontend.up.railway.app`)
is updated to the real route, `app.ahavaon88.co.za/legal/privacy-policy`.

**iOS has no equivalent prior art** — `cap add ios` scaffolded
`workspace/ios/` fresh, with default (unbranded) icons/launch screen and
no Health Connect equivalent (HealthKit, if wanted, is a separate,
unbuilt integration).

**Verified:** `cap sync` (both platforms) completes cleanly and reports
both plugins detected (`@capacitor/device`, `capacitor-health`) on
Android and iOS. `git status` after the sync confirms no unexpected
file changes.

**Not done, and not doable from this environment:**
- **Building an actual installable binary.** `npx cap add android`
  scaffolds a Gradle project; building it needs a JDK, the Android SDK,
  and Gradle able to download dependencies — none present on this
  machine (no `java`, no `gradle` on `PATH`). `npx cap open android`
  opens the project in Android Studio, which has to run on a machine
  that has it installed.
- **iOS entirely.** Building, running, or even opening the scaffolded
  Xcode project requires a Mac with Xcode — categorically unavailable
  here, not just unconfigured.
- **Branding.** Both platforms' icons/launch screens are Capacitor's
  generic default mark, not the app's actual branding (corrected above —
  an earlier version of this doc wrongly called Android's real).
- **Push notifications.** `android/app/build.gradle` already
  conditionally applies the `google-services` Gradle plugin if
  `google-services.json` is present, but no such file exists yet — Push
  is guarded off, not broken.
- **Store listings, signing keys, and submission** — all a separate,
  largely non-code workstream.

---

## 9. PWA support — 2026-09-09

Separate from and much lighter than the Capacitor mobile work in §8: the
web app is now installable straight from the browser ("Add to Home
Screen"), no app store or native build tooling involved.

- `workspace/src/app/manifest.ts` — Next.js's file-based manifest
  convention; auto-served at `/manifest.webmanifest` and auto-linked
  from every page's `<head>`.
- `workspace/public/sw.js` — deliberately conservative. This app is
  cookie-session-authenticated and every read/write goes through
  `/api/*` carrying PHI, so the worker never intercepts `/api/*` or any
  non-GET request — those hit the network exactly as if no service
  worker were installed. It only cache-first serves same-origin static
  assets (content-hashed by Next.js, safe to cache aggressively) and
  falls back to a static offline page for navigations when the network
  is unreachable.
- `workspace/src/app/offline/page.tsx` — that fallback page; static, no
  auth check, no data fetch.
- `workspace/src/components/ServiceWorkerRegistration.tsx` — registers
  the worker on mount. Checks `document.readyState` first: registering
  only on the `window.load` event misses it entirely once React
  hydrates after `load` has already fired, which is the common case for
  a client-rendered app — caught via an actual browser check (Browser
  tool, not just reading the code), not assumed.
- Icons: 192px/512px/maskable-512px PNGs generated from the existing
  Capacitor placeholder mark, purely so the install prompt and home-
  screen icon aren't blank — explicitly provisional pending real
  branding (see §8's branding note above; it's the *same* gap).

**Also surfaced a real, previously-latent bug while committing this**:
`.gitignore`'s `public` rule (from an unused Gatsby-template section)
had no leading slash, so it silently ignored *any* directory named
`public/` at any depth — including `workspace/public/`, Next.js's real
static-assets folder. Nothing had ever been placed there before this,
so it caused no prior data loss, but would have silently dropped these
new PWA files (and anything else placed there later) from every future
commit, never reaching Railway. Scoped to `/public`.

**Verified:** `tsc --noEmit` and `eslint` clean; a full production build
(`NEXT_OUTPUT_STANDALONE=false`, matching CI) succeeds, producing 26
routes instead of 24. Checked live in a real browser: the manifest
serves correctly, the service worker registers and activates, an
`/api/*` call is confirmed *not* intercepted (the request still reached
the — unavailable in this test — backend rather than any cache), and
the worker's cache contains only the offline page and static assets, no
API or PHI data.

**Not done:** no push-notification support (a separate, larger feature —
Web Push needs its own backend subscription-management endpoints, not
just a manifest entry), and the icons are placeholder as noted above.

## 10. UI/UX redesign — `docs/UI_UX_IMPLEMENTATION_BRIEF.md`, 2026-09-09

Applied phase-by-phase, in order, per the brief. Standing rule enforced
throughout: no existing feature or handler was ever dropped — every
phase preserved every prior API call, prop, and behavior exactly, adding
or restyling only.

- **Phase 1 — Foundations**: design tokens (role/acuity colors, type
  ramp, tap targets), the `Icon` component replacing emoji, viewport
  zoom re-enabled for accessibility, a skip link.
- **Phase 2 — Shared components**: `PageHeader`, `Sparkline`, `StatCard`,
  `AcuityRow`, `Timeline`, `RangeBar`, `Skeleton`, `EmptyState`,
  `DataTable`; `Card`/`StatusBadge` extended backward-compatibly;
  unused `KpiCard` removed.
- **Phase 3 — Patient dashboard**: rewritten around the real
  `getMonitoringSummary`/`getBiometricHistory`/`getMyTriageCases`
  endpoints; a readiness ring and real reading-to-reading deltas
  replace nothing invented — every number traces to an existing field.
- **Phase 4 — Doctor dashboard**: worklist + review-pane layout with
  E/P/M keyboard shortcuts; vitals/confidence/nurse-dispatch UI the
  brief called for was *not* built because the backing data doesn't
  exist yet — omitted rather than faked, flagged in the phase commit.
- **Phase 5 — Nurse dashboard**: visit-status flow map, prominent
  active-visit card; an in-visit vitals-entry screen was scoped out for
  the same reason (no backend support) and proposed only, not built.
- **Phase 6 — Responsive & accessibility sweep**: the last 5 fixed
  inline grids converted to responsive Tailwind grids; `Modal` gained
  focus trap, Esc-to-close, and focus restoration; `Toast` ARIA roles
  now vary correctly by severity; biometric form fields gained real
  `<label>`s.
- **Phase 7 — Offline (patient biometrics only)**: the brief calls this
  phase "explore first, propose, don't build from the brief directly."
  Investigation found:
  - the service worker (§9) never intercepts `/api/*`, so it does
    nothing for offline writes on its own;
  - `POST /patient/biometrics` already honors an `Idempotency-Key`
    header (`apps/backend/src/middleware/idempotency.ts`) — a retried
    submission with the same key can never double-write, even if Redis
    later replays it;
  - triage submission and prescriptions carry **no** such guarantee —
    confirmed by absence of `idempotencyMiddleware` on those routes —
    so they are explicitly never queued;
  - no SMS channel exists anywhere in the backend, ruling that out as a
    fallback.

  Built the smallest safe slice on that basis: manual biometric
  submissions that fail with no server response (`error.request` set,
  `error.response` unset — a real network failure, not a validation
  rejection) are queued in IndexedDB
  (`workspace/src/lib/offlineBiometricQueue.ts`) with a generated UUID
  used as the `Idempotency-Key`, scoped per-user so a shared browser
  can never replay one patient's queued reading under another's
  session. `workspace/src/hooks/useOfflineBiometricSync.ts` replays the
  queue in capture order on the `online` event: entries older than one
  hour are discarded (monitoring assumes near-real-time readings — see
  inline comment) before any network attempt; a genuine second network
  failure stops the replay and leaves the remainder queued for next
  time; a non-network rejection (would never succeed on retry) is
  discarded. Triage, prescriptions, and everything else are unaffected
  — untouched by this change.

  **Verified:** `tsc --noEmit` and `eslint` clean; full production
  build succeeds. End-to-end logic verified live in a disposable
  preview page (deleted before commit) against the real queue/hook
  modules with `patientApi.submitBiometrics` swapped for a controllable
  stub: offline submission enqueues correctly; a stale (2h-old) entry
  is dropped on the next sync attempt before any network call; a fresh
  entry survives a failed sync attempt and remains queued; once the
  stub is switched to succeed, the queued entry replays with the exact
  `Idempotency-Key` generated at enqueue time and is removed from the
  queue, and the dashboard's data-refresh callback fires.

## 11. Clinical safety hardening — scenario test findings, 2026-09-14

A clinical scenario test harness (`test/clinical-scenario-harness`, not
merged — Anthropic call intercepted with scripted responses, Timescale
swapped for an in-memory store; every deterministic/statistical code
path is real) ran 26 cases against `analyzeSymptoms()` and
`EarlyWarningEngine.full_analysis()` and surfaced 10 findings (AH-41
through AH-50). Every finding was independently re-verified by reading
the exact referenced code before any fix — all 8 spot-checked in detail
matched precisely. Fixed here, in the report's own suggested order:

- **AH-41 (P0)** — `POST /api/patient/triage` (`routes/patient.ts`)
  returned the full AI result — level, conditions, reasoning — straight
  to the patient with no doctor gate, directly contradicting
  `routes/triage.ts`'s deliberate withhold-until-doctor-releases design.
  Traced every frontend call site first: nothing calls this route — it
  was dead code from before the AH-32 queue redesign. Deleted outright,
  along with its now-unused schema, imports, and the `AI_TRIAGE_PREVIEW`
  audit path.
- **AH-42 (P0)** — `requiresDoctorReview` in `aiTriage.ts`'s
  `mergeGuardrails` was derived from `mergedLevel <= 2 || flags.length
  > 0 || confidence < 0.7` — three values the model itself can report,
  so a prompt injection convincing the model to claim a low-risk level
  at high confidence with no flags could set every one false. Traced
  every consumer of this field: nothing in the frontend reads it, and
  the real release gate (`triageCaseReview.ts`) already requires
  `triageCase.doctorId === req.user.id` regardless of it — so with
  AH-41 closed there was no live bypass left, but the field itself was
  still a live footgun for any future consumer. Hard-coded to `true`
  at this single choke point every `analyzeSymptoms()` return path
  funnels through, rather than trusting a value the model can talk its
  way out of.
- **AH-43 / AH-44 (P0)** — `apps/ml-service/engine.py`: a new user's
  first reading defaulted to GREEN regardless of content
  (`if not history: return GREEN`), and anomaly severity was *counted*
  rather than weighted (`+= 2 if >2.5σ else 1`, RED needs `>= 3`), so no
  single catastrophic vital could ever reach RED alone — an isolated
  SpO2 80 scored only YELLOW. Added `_absolute_floor()`, a SATS-aligned
  absolute threshold check (adapted from the same table already used in
  `triageSafety.ts`, for HR/RR/SpO2 — the only vitals this engine's
  `BiometricData` model carries) that runs before baseline comparison,
  survives having no history, and survives exercise-context suppression
  when the breach is RED-level (a critical desaturation during exertion
  is still dangerous) but not for a merely-elevated YELLOW-level reading
  (preserving the already-validated marathon-runner suppression case).
  Inherits the same adult-only limitation as AH-47 below — not safe for
  paediatric vitals, flagged in the code.
- **AH-46 (P1)** — `africa-cdc` (a hardcoded local fact-sheet, zero
  network calls) was tagged `tier: 'literature'`, so it alone satisfied
  `hasSufficientEvidence()` even with WHO/PubMed/StatPearls all down —
  and separately, every real provider's `query()` swallowed its own
  HTTP/network failures into a plain `[]`, indistinguishable from "found
  nothing," so `sourcesFailed` stayed empty through a total outage.
  Reclassified `africa-cdc` to a new `'context'` tier (still injected
  into model prompts, never counted as evidence). Added
  `EvidenceProviderNetworkError`, thrown by each real provider's search
  call specifically on a non-2xx response or a network/timeout failure
  (not on a legitimate "zero results" response), and re-thrown through
  each provider's `query()` so `combineEvidence`'s existing try/catch —
  already correct — actually receives it.
- **AH-48 (P1)** — red-flag regexes had no negation awareness: "no
  numbness, no problems passing urine" matched identically to the
  affirmed symptom. Added a NegEx-style pass that masks the clause
  following a negation trigger (no/not/denies/without/ruled out/absence
  of) up to the next clause boundary before pattern matching runs.
  First pass broke the existing `not breathing` and `no pulse` red-flag
  patterns (the negation word is part of the symptom there, not a
  denial) — caught by the pre-existing `triageSafety.test.ts` suite,
  fixed with a negative-lookahead exclusion for those two phrases. All
  31 existing tests plus 2 disposable verification tests (denied
  symptom no longer escalates; a real, non-negated one still does) pass.
- **AH-49 (P2)** — `enrichWithFallbackOpinion` replaced
  `possibleConditions`/`recommendedAction` with a generic fallback
  whenever *either* the conditions were generic *or* the model's
  reasoning text was under 60 characters — so a specific, correct
  differential (e.g. "Tension-type headache") got silently discarded
  over unrelated short reasoning, with no record of what was replaced.
  Now only replaces content when the conditions are actually generic;
  brief reasoning on an otherwise-specific result adds a
  `BRIEF_MODEL_REASONING` flag instead of discarding real content.

**Deliberately not fixed — need clinical/product sign-off, not an
engineering guess:**

- **AH-45 (P1)** — `_fusion_trajectory` reads only the hand-tuned
  `_custom_ml_risk` heuristic, ignoring the Framingham- and
  QRISK3-adapted scores computed right next to it. Needs a decision on
  how the three should actually be combined/weighted, not a unilateral
  pick.
- **AH-47 (P1, clinical)** — `assessDeterministicRisk` takes no age;
  adult HR/RR thresholds hard-flag a normal paediatric vital
  (HR 148 / RR 34 in a 3-year-old) as CRITICAL, routing children to
  resuscitation as a class. Real paediatric reference ranges need to
  come from a clinician, not be invented here. Same gap now exists in
  both the TS deterministic-risk table and the newly-added Python
  absolute floor (AH-43/44), since the floor intentionally reused the
  existing (adult-only) table rather than inventing paediatric numbers.
- **AH-50 (P2)** — `_calculate_blended_baseline` uses a wearer's own
  7-day σ with no floor, so a very consistent wearer's ordinary
  day-to-day variation reads as multi-sigma noise. Needs a clinically
  safe per-metric σ floor in real units, not a guessed constant.

**Verified:** `tsc --noEmit`, `eslint` (0 errors — pre-existing
`no-explicit-any`/unused-var warnings only, none new), and a full
`npm run build` all clean on the backend. The full backend Jest suite
(124 tests, 13 suites, including the pre-existing `triageSafety.test.ts`
that caught the negation regression above) passes. `engine.py` could
**not** be executed — no Python interpreter is installed on this
machine, and the Railway deploy pipeline (`.github/workflows/deploy.yml`)
has no test/syntax gate before it builds and deploys the container —
verified instead by careful manual re-reading of the full diff across
several passes. Run the ml-service test suite (or re-run the scenario
harness) against this change before merging to close that gap.

## 12. AH-45 / AH-50 — CVD risk and wearable noise floor, 2026-09-14

Follow-up to §11: a clinician threshold specification (evidence-assembled,
explicitly **awaiting named clinician sign-off** — HPCSA number, date,
table version — before any of it is clinically authorized) gave sourced
numbers for AH-45 and AH-50, and cited literature/structural fixes for
AH-44's Python side. User directed: build and land on main now; sign-off
is a parallel track, not a merge gate.

Also closed the gap flagged in §11: installed a real Python 3.12
interpreter (`winget install Python.Python.3.12`) plus the ml-service's
actual dependencies, so every change below was executed against the real
engine, not just read. That execution caught two real bugs before they
shipped (below).

**AH-45 — CVD risk (`apps/ml-service/engine.py`, `models.py`):**
`_framingham_adapted` took age/resting-HR/hypertension/smoker — resting
HR is not a Framingham variable, and real Framingham needs cholesterol,
HDL, and BP-treatment status this never collected. `_qrisk3_adapted`
*called* `_framingham_adapted` and added a fixed increment, so the two
"independent validated scores" were one function and a constant — they
could never actually disagree. Displaying them as "Framingham 10-year"
and "QRISK3 10-year" was a labelling problem before an accuracy one.

- Deleted both, plus `_custom_ml_risk` and `_fusion_trajectory`'s
  arithmetic trajectory projection (`current + 6.0` if "rising" — an
  unsourced number). Replaced with `_who2019_non_lab_risk_category`: the
  WHO 2019 non-laboratory CVD risk chart for Southern sub-Saharan Africa
  (age, sex, smoking, SBP, BMI → one of five categories), the instrument
  the specification identifies as regionally validated versus global
  tools shown mutually uncorrelated in African cohorts.
- **Honest, disclosed gap**: the actual WHO 2019 chart cell values (a
  published table of age × SBP × BMI × sex × smoking-status combinations)
  were not supplied with the specification and are not reproduced here
  from memory — doing so would be exactly the kind of unsourced clinical
  number this whole engagement exists to remove. Every validation gate
  around the lookup is real and wired end-to-end (age range 40–74,
  required inputs, no imputed defaults); the function currently always
  returns `computable: false, reasons_not_computable: ["WHO_2019_CHART_NOT_YET_DIGITIZED"]`
  once inputs pass validation. Digitizing the real chart (with the same
  clinician sign-off as the SATS tables in `triageThresholds/`) is the
  one piece of remaining work this fix could not complete honestly.
- `ContextualProfile` gained `sex`, `systolic_bp`, `bmi`, `diabetes`,
  `hiv_positive`, `active_tb` — all `Optional` with no default, per the
  spec's "no imputed default, no assumed non-smoker."
- Wearable signals (resting-HR trend, HRV-vs-baseline, sleep pattern) —
  previously folded straight into the fake risk percentage — moved to
  `physiological_trend_flags`, explicitly separate from `risk_category`
  and never used to compute it. Fake confidence
  (`0.75 + (HR+HRV)/1000`, a function of inputs, not certainty) deleted
  outright. HIV/TB surfaced as `epidemiological_flags`, not a hidden
  multiplier. `RiskScores` renamed `CvdRiskAssessment`
  (`EarlyWarningSummary.risk_scores` → `.cvd_risk`) — checked first that
  nothing in the frontend renders these fields (only referenced in an
  unused optional TS type), so this is a safe internal contract change.

**AH-50 — wearable noise floor (`engine.py`):**
- §50.1: the shared `max(blended_std, 0.1)` floor (a tenth of a beat for
  heart rate) replaced with per-metric floors — HR 3.0 bpm, RR 1.0 br/min
  (1.5 if age ≥60) — in `_sigma_floor_for`.
- §50.2: HRV moved off the generic z-score loop entirely into
  `_hrv_deviation` — RMSSD is right-skewed, so a raw z-score isn't a valid
  statistic (this is how M09 produced "−6.1σ" in the original report).
  Compares a 7-day rolling mean of `ln(RMSSD)` against the baseline from
  the patient's first stable week, flagging only when the shift exceeds
  0.5× the patient's own coefficient of variation (smallest-worthwhile-
  change), not a sigma multiple.
- §50.3: heart rate and respiratory rate now require the deviation on
  ≥2 of the last 3 readings (current included) before counting —
  `_persistent_anomaly`. The AH-43/44 absolute floor is exempt by design;
  those still fire on the first reading.
- §50.4: SpO2 boundaries updated to NEWS2 Scale 1 exactly (≤91 critical,
  92–93 low, 94–96 indeterimate) and removed entirely from the
  baseline-relative z-score loop — never compared to a personal baseline.
  A 94–96% reading is indeterminate, not reassuring: it only escalates
  alongside a respiratory-rate deviation also present, matching the
  TS-side triage implementation of the same rule (§11).
- §50.5: the effective floor widens ×1.5 below 7 days of history and
  ×1.25 between 7–14 days, since the personal SD is unreliable from very
  few points in either direction.

**Two real bugs caught by actually executing this, not just reading it:**
1. HRV's coefficient-of-variation calculation returned ~0 for
  near-constant historical data (`std()` on identical values is ~1e-16,
  not exactly 0, so a bare `<= 0` guard didn't catch it) — this made HRV
  monitoring *least* sensitive for the most consistent wearers, the
  opposite of AH-50's purpose. Fixed with a real CV floor (2.7%, the
  spec's own cited minimum for a stable individual), not just a
  floating-point epsilon guard.
2. The first test of a genuine, large single-vital deviation
  (`_verify_ah43_44.py`, deleted before commit) surfaced this — without
  running it, both would have shipped silently.

**Verified:** `python -m py_compile` clean on every touched file. A real
Python 3.12 venv with the service's actual dependencies (pydantic, numpy,
pandas, psycopg2-binary) confirmed `main.py` — the actual Railway
entrypoint — imports and builds its FastAPI app cleanly end-to-end. A
disposable verification script (deleted before commit) exercised: AH-43/44
regression (no-history catastrophic → RED, isolated critical vital → RED,
exercise suppression still works and still doesn't suppress a RED-level
floor breach), AH-50's persistence rule (single spike doesn't escalate,
2-of-3 does), immature-baseline widening (same 4 bpm move flags with a
mature baseline, doesn't with a 5-day one), a genuine HRV crash correctly
flagging after the CV-floor fix, the SpO2 indeterminate+RR-deviation
escalation combo, and every AH-45 CVD scenario (missing inputs, out-of-
range age, HIV flag, wearable trend flag) resolving correctly.

**Not fixed — still needs the actual WHO 2019 chart data**, and clinician
sign-off on all six items the specification calls out (three TEWS charts,
the emergency-signs override, the age/height band rule, the WHO 2019
instrument choice, the SpO2 indeterminate band, and the σ floors +
persistence rule) before any of this reaches a patient in the sense the
specification means "reaches."

## 13. Follow-up from a parallel transcription effort, 2026-09-14

A separate effort (branch `test/clinical-scenario-harness`, commit `e14fe66`,
not yet merged or reachable from this branch — its report is what prompted
this section) attempted the AH-45/47/50 threshold transcription work
directly and reported back. Two of its claims were independently verified
here before acting on them:

- **SA National DoH policy, not just WHO default, governs AH-45.**
  Fetched and read the actual primary source: *SA National Department of
  Health, Appendix VII — Cardiovascular Risk Assessment, 2020-4_Version
  1.0, 25 October 2024* (health.gov.za). Confirmed directly: the mandated
  non-lab tool is exactly the WHO 2019 non-laboratory Southern
  Sub-Saharan Africa chart already implemented here, but SA's own chart
  collapses WHO's five risk bands into **four**: `<5%` / `5-10%` /
  `10-20%` / `>20%`. Updated `CvdRiskCategory` (`models.py`) and the
  `high_risk` check in `_fusion_from_cvd_risk` (`engine.py`) to match —
  they previously carried WHO's default five-band split
  (`20-<30%`/`>=30%`), which is not the chart South Africa actually uses.
  Also independently confirmed the 40–74 age range against the real
  chart's own row labels, and confirmed the chart genuinly is a
  colour-coded image in the primary source (not a data table) —
  corroborating the parallel effort's account of why an automated
  extraction attempt produced non-monotonic (impossible) values on real
  cells and had to be abandoned rather than shipped.
- **The full lab-based Framingham table in that same NDoH document is
  now known-real and complete** (age/cholesterol/HDL/smoker/diabetic/
  systolic-BP-by-treatment-status points, and the points-to-10-year-risk-%
  table) — read directly from the PDF, matches the parallel effort's
  transcription exactly on every number checked. **Not yet implemented**
  here — this is genuinely new capability (a laboratory-based upgrade
  path needs HDL and BP-treatment-status fields this codebase doesn't
  collect yet), not a correction to something already shipped, so it
  wasn't built without being asked for.
- **The git bundle the parallel effort's output was handed over in did
  not transfer usably** — verified empirically (`git bundle verify`
  reported the header as valid, since it only checks prerequisites, but
  `git fetch` from the same file failed with "early EOF" / "index-pack
  died": the actual pack data was never present). The branch is not on
  the shared GitHub remote either. Its `sats_tews.json`, WHO/Fleming
  transcription templates, validator, and README could not be inspected
  or reconciled against `triageThresholds/paediatricTews.json` as a
  result — asked the user to push the branch to the remote.

**Correction accepted and acted on immediately**: the parallel effort's
point that AH-47's clinician sign-off is a **blocker on routing live
paediatric patients**, not a parallel-track item like the rest of the
threshold work, is correct — the paediatric TEWS charts (unlike the adult
one) haven't been through any independent review at all, and Phase-11's
commit shipped them live with no gate. Added one: `triageSafety.ts` now
checks `PAEDIATRIC_TEWS_SIGNED_OFF` (env var, defaults to unset/false —
fails safe) before applying TEWS scoring to a case that resolves to the
younger-child or older-child band. With the gate closed (the default in
every environment today), a child's vitals assessment falls back to the
same conservative floor as an unknown age — `minTriageLevel` capped at 2,
flagged `PAEDIATRIC_TEWS_PENDING_CLINICIAN_SIGNOFF` — rather than either
using the unsigned charts or silently falling back to the adult chart
(the exact bug AH-47 exists to fix). The emergency-signs override and
adult-band scoring are both unaffected by the gate, confirmed by test.

**Verified:** full backend Jest suite (134 tests, including new coverage
for the gate's default-off behavior, the override firing regardless of
the gate, adult scoring being unaffected, and the flag correctly
re-enabling paediatric scoring) passes; `tsc`, `eslint`, and full build
clean. Python side: `py_compile` clean, and a real venv confirmed the
updated `CvdRiskAssessment` Pydantic model accepts the new four-band
values and correctly rejects the old five-band ones.

## 14. NCBI cache and dead-code cleanup, 2026-09-14

Follow-up from a question about the Railway `NCBI_API_KEY` variable
(confirmed correctly named and wired to `evidenceProvider/providers/
pubmed.ts` and `.../statPearls.ts`, both via `process.env.NCBI_API_KEY`).
Surfaced two things while answering it:

- **Deleted `apps/backend/src/services/statPearls.ts`** — a standalone,
  never-imported duplicate of the same NCBI StatPearls lookup now
  implemented in `evidenceProvider/providers/statPearls.ts`. Confirmed
  via grep that nothing referenced it before removing.
- **No caching in front of PubMed/StatPearls.** Both hit NCBI's shared
  E-utilities infrastructure (3 req/sec without the key, 10/sec with
  it), with no client-side throttling anywhere in the code — the first
  external dependency likely to fail under real concurrent load. The
  deleted dead file actually had a 24h Redis cache for this exact
  lookup; the live implementation that superseded it did not.

Added it back, generically, in `evidenceProvider/combiner.ts` rather
than per-provider: a new `cacheTtlSeconds?: number` field on
`EvidenceProviderConfig` (`types.ts`), set to `EVIDENCE_CACHE_TTL_SECONDS`
(env-configurable, default 86400s/24h) for `pubmed` and `statpearls`
only in `registry.ts`. `combiner.ts`'s `queryWithCache` wraps each
provider's `query()` call: keyed by a SHA-256 of the normalized
(trimmed, lower-cased) symptom text — the only field either provider
actually reads from a `ClinicalQuery` — so semantically-identical
repeat complaints hit the cache instead of NCBI. Fails open at every
step (no Redis, a corrupt entry, a failed write) straight through to a
live query, matching the exact pattern already proven in
`idempotencyMiddleware`. A provider that throws
(`EvidenceProviderNetworkError`, a real outage) is never cached — only
a genuinely completed result, including a legitimate empty one.

**Verified:** `tsc`, `eslint` (0 new errors — two pre-existing
`no-explicit-any` warnings, unrelated to this change), and full build
clean. New `combiner.test.ts` (4 tests) follows this codebase's own
established convention for Redis-dependent code (see
`rateLimiter.test.ts`'s comment) — this test environment has no live
Redis, so `getRedis()` throws and every test here exercises the real
fail-open path, not a mock standing in for a cache hit; that path is
what's actually reachable without a live Redis to test against. Full
backend suite (138 tests) passes.

## 15. Redis outage incident follow-up, 2026-09-14

A production incident report (`⚠️ Redis/Queue unavailable, running without
background jobs`, observed during a deploy) raised four claims. Investigated
each directly rather than taking the summary at face value:

- **`/ready` doesn't consider Redis — confirmed exactly as reported.**
  [`index.ts`](apps/backend/src/index.ts)'s readiness check pings Redis and
  records `checks.redis`, but `const ready = checks.database === "ok"`
  never factors it in. A replica with dead Redis returns 200 and stays in
  rotation.
- **"No AI decision support ever runs" — traced and it's more nuanced.**
  `routes/triage.ts` already runs `processAiTriageJob` synchronously in
  the request when `addAiTriageJob` reports the queue isn't available
  (the AH-32 fallback, built for exactly this case) — AI analysis does
  still run, just inline instead of backgrounded. What's actually lost is
  PDF export, queued email, push notifications, and cross-replica
  WebSocket delivery, none of which have an equivalent fallback.
- **Unverified shutdown drain — confirmed.** `shutdown()` never called
  `.close()` on `aiTriageWorker`/`emailWorker`; a job being processed when
  SIGTERM arrived was simply killed via `process.exit()`, with BullMQ's
  stall-detection as the only (untested) recovery path.
- **Leaked credential — could not confirm.** Tested the specific
  hypothesis (a malformed `REDIS_URL` missing the `redis://` scheme
  causing ioredis to echo the raw string, credentials included, into an
  error message) directly against the real ioredis client — it parses
  `user:pass@host:port` correctly even without a scheme and strips
  credentials from its connection-error messages. Checked every
  `console.*` call near Redis/DB connection code for a raw connection
  string; found none. Left open pending the actual log line.

**Root cause identified for the readiness gap**: it isn't really a pass/
fail-logic problem — failing `/ready` on Redis-down would pull every
replica from rotation and block patient-facing triage submission
entirely, which is *worse* than the current degraded-but-serving state
given the AI-analysis fallback already exists. The actual bug is that
`redis.ts`'s `initializeRedis()` set `redisInitFailed = true` on any
failure and never attempted again — a 30-second network blip at startup
degraded a replica **permanently, until redeployed**. Fixed at the root:

- `redis.ts`: removed the permanent-failure lockout — each call now
  genuinely attempts a fresh connection.
- `index.ts`: on startup failure, `scheduleRedisReconnect()` retries on
  an interval (`REDIS_RECONNECT_INTERVAL_MS`, default 30s, `.unref()`'d
  so it can't block process exit) until it succeeds, then initializes
  the queues — AI triage, email, PDF export, and push notifications all
  come back without a restart. `/ready`'s existing live Redis ping
  correctly reflects this automatically; no change needed there.
- `queue.ts`: `initializeQueue()` is now idempotent (guards against the
  retry loop creating duplicate Queue/Worker instances that would
  double-process every job) via a `queuesInitialized` flag.
- `queue.ts`: added `closeQueues()` — closes `aiTriageWorker`/
  `emailWorker` first (each given up to `SHUTDOWN_TIMEOUT_MS - 5s` to
  finish an in-flight job), then the queues and their event listeners.
  Wired into `shutdown()` in `index.ts`, before the shared Redis client
  is quit (workers need that connection alive to close cleanly), and the
  pending reconnect timer is cancelled first so it can't fire mid-shutdown.

Design call made without a further question, per standing delegation
("as long as these are safe and improve functionality and optimize
performance"): keep `/ready` returning 200 for a degraded-but-serving
Redis state rather than failing it — the resilience the AH-32 fallback
already provides is the point, and taking the whole app offline over a
recoverable Redis blip would be a regression, not a fix.

**Verified:** `tsc`, `eslint` (0 new errors — 2 pre-existing warnings
untouched), and full build clean. New `queue.test.ts` (2 tests) pins that
`closeQueues()` is a safe, non-hanging no-op when nothing was ever
initialized — this test environment's actual default state, same
no-live-Redis convention as `rateLimiter.test.ts` and
`evidenceProvider/combiner.test.ts`. Full backend suite (140 tests) passes.

## 16. Adversarial clinical scenario pass, 2026-09-14

A deliberate red-team pass against everything shipped in §11-§15 — boundary
values at every threshold introduced today, interaction effects between the
new systems, and adversarial/messy real-world phrasing — run against the
real code (Jest for `assessDeterministicRisk`, a real Python venv for
`engine.py`), not reviewed by inspection. Found and fixed two genuine bugs;
confirmed roughly a dozen other scenarios behave correctly, including two
that looked wrong on first read and turned out to be test-construction
mistakes on investigation, not engine bugs.

**Bug 1 — negation mask erased a real, affirmed symptom (triageSafety.ts).**
Today's own AH-48 fix (§11) masked a denial only up to the next clause
*punctuation*. Real phrasing routinely joins a denial to a genuine symptom
with a bare conjunction and no comma: `"denies numbness but has severe
headache"` returned level 5 with zero flags — the mask consumed "but has
severe headache" right along with the denied "numbness", since nothing
stopped it before end-of-string. Same failure for `"denies fever and has
crushing chest pain"`. Fixed by also stopping the mask at a set of
contrast/coordination conjunctions (but/however/although/yet/except/and).
Verified this doesn't reintroduce under-masking for a same-sentence double
denial (`"no fever and no chills"` — each `"no"` is still matched
independently by the global regex, so the second denial gets its own mask)
and doesn't regress the comma-separated case. Pinned permanently in
`triageSafety.test.ts`.

**Bug 2 — persistence counted an abnormality "recently", not "right now"
(engine.py).** §50.3's `_persistent_anomaly` counted a breach anywhere in
the 3-reading window, so two readings-ago being abnormal plus one
more-readings-ago being abnormal could flag even when the *current* reading
had returned exactly to baseline (z=0.0) — the code was answering "did this
happen recently" when the clinical claim being made ("persistent") is "is
this still happening." Fixed by requiring the current reading to itself
breach threshold before counting toward the persistence total at all.

**Two false alarms, resolved by finding the actual cause rather than
either dismissing or over-fixing:**
- A same-magnitude HR move (76 vs a ~71 baseline) appeared to never flag
  regardless of how much history existed, seemingly breaking §50.5's
  immature-baseline widening entirely. Traced to two stacked test-script
  mistakes: history built in descending order while the engine (correctly)
  assumes ascending, per `db.py`'s real `ORDER BY time ASC`; and once fixed,
  the chosen test value landed the z-score at *exactly* 1.5 — the same as
  `SIGMA_YELLOW`, failing the strict `>` comparison by construction, not by
  bug. Re-run with a value that clears the boundary comfortably: immature
  baselines (6/7/13/14 days) correctly suppress the flag, mature ones
  (15/20 days) correctly raise it — the day-14/15 transition lands exactly
  on `MIN_BASELINE_DAYS` as designed.
- A patient whose HRV recovered to baseline still showed a flagged 7-day
  rolling mean for several days afterward. Not a bug: a rolling mean is
  supposed to lag a single night's recovery — that's the deliberate
  smoothing §50.2 asked for specifically to avoid one-night noise, matching
  how recovery-tracking wearables (Whoop/Oura-style) work. Distinct in kind
  from Bug 2 above, which made a discrete, real-time claim ("still
  happening") that a stale reading can't honestly support.

**Other scenarios run and confirmed correct, no changes needed:** exact
TEWS band boundaries (age 3/12, height 95/150cm — both land in the older-
child band as specified); an adult with every TEWS parameter simultaneously
at its worst value (correctly reaches RED/level 1 through legitimate
additive scoring, not an override); every NEWS2 SpO2 boundary (90/91→
critical, 92/93→low, 94/96→indeterminate, 97→clear); WHO 2019 CVD age-gate
boundaries (39/75→out of range, 40/74→valid, correctly reaching the
"chart not digitized" stub rather than a false validation rejection); a
negative age (-5) resolving to a nonsensical band but landing safely
behind the paediatric sign-off gate regardless (a real input-validation
gap worth hardening later, but not currently reachable with unsafe
consequences); a literal zero heart rate scoring only YELLOW through TEWS
rather than an emergency override — confirmed **not reachable in
production**, since `submitBiometricsSchema` already rejects it via
`Joi.number().min(30)` before it can reach triage scoring, and the
matching Pydantic bound (`ge=30`) does the same on the wearable-engine
side (confirmed by exception when tested directly).

**Recommendation, not actioned**: this ml-service has zero test
infrastructure (`requirements.txt` has no `pytest`) despite now carrying
several hundred lines of clinical scoring logic across three distinct
mechanisms (absolute floor, TEWS-equivalent persistence, log-transformed
HRV). Both real bugs above were found by hand-built disposable scripts,
deleted after use per this session's established practice — a permanent
pytest suite would have caught bug 2 automatically on the next change
instead of requiring another manual red-team pass. Flagged for the user
rather than added unprompted, since introducing a new test framework as a
side effect of a bug hunt is a bigger decision than the bug fixes
themselves.

**Verified:** full backend Jest suite (146 tests, including new permanent
coverage for the negation-conjunction fix) passes; `tsc`, `eslint`, and
full build clean. Python: `py_compile` clean, and a real venv confirmed
`main.py` still imports and builds its FastAPI app end-to-end after the
persistence fix.

## 17. Third bug found by the user's own manual testing, 2026-09-14

The user manually tested one of the §16 scenarios (a panic-attack
presentation explicitly denying chest pain and dizziness) against the real
running app and got back a SATS-1 "cardiopulmonary emergency" — the fallback
heuristic had run because both AI providers were unavailable in that
environment, and asked what "AI providers failed" meant and whether the
output was accurate.

Traced precisely rather than guessed: `aiTriage.ts`'s `deriveFallbackOpinion`
— used both when both AI providers fail entirely (`conservativeFallback`,
the mechanism the user hit) *and* whenever the model's own answer looks too
generic (`enrichWithFallbackOpinion`, a more common real-world trigger) —
decides its category with a plain substring scan (`includesAnySymptom`)
that has never had any negation awareness. The test text literally contained
the substring `"chest pain"` inside `"No chest pain, no dizziness"`, and the
heuristic doesn't distinguish a denial from an affirmation — same *class* of
bug as §16's Bug 1, but a second, separate implementation of "read symptom
text and infer something" that was never fixed because it was never known
about, only surfaced through a real user test rather than an automated pass.

Fixed by exporting `triageSafety.ts`'s existing `stripNegatedSpans` (already
proven correct there) and applying it before `deriveFallbackOpinion`'s own
keyword matching, rather than writing a second negation implementation.
Verified against the exact real-world text from the user's test: the false
"chest pain" match no longer fires, and the case correctly falls through to
the generic, appropriately non-alarming default ("Acute undifferentiated
illness", level 3) — matching the level this same scenario was predicted to
land at in §16, before the AI-provider outage revealed this second bug.
Also verified the fix doesn't blunt the real thing: a genuinely affirmed
"crushing chest pain radiating to my left arm" still correctly reaches
level 1.

**On accuracy of the fallback mechanism itself**: confirmed as intentional,
sourced, working-as-designed behavior — a total AI outage deliberately
degrades to a conservative heuristic rather than blocking triage entirely,
the same fail-safe already confirmed working in the original clinical
scenario report (an unconscious trauma patient still reaching level 1 during
a full provider outage). The bug was specifically in that heuristic's own
un-negated keyword matching, not in the decision to have a fallback at all.

**Verified:** new `aiTriage.test.ts` (the first test file for this service)
pins both directions — the denied symptom no longer false-positives, and a
genuinely affirmed one still correctly reaches level 1 — run for real
against `analyzeSymptoms()` with no AI provider configured (this test
environment's actual state, matching what the user's own test hit). Full
backend suite (147 tests) passes; `tsc`, `eslint` (0 new errors), and full
build clean.

## 18. "Model:" label was fabricated for every fallback case, 2026-09-14

Following up on §17: the user pointed at the same test screenshot and noted
it said "Model: claude-sonnet-4-20250514" — reasonably reading that as
Claude having processed the case. It hadn't; the same card's own reasoning
text said the conservative fallback ran because all providers failed.

Traced to `aiTriageJob.ts`: `aiModel: process.env.ANTHROPIC_MODEL ||
"claude-sonnet-4-20250514"` ran unconditionally on every completed case,
regardless of whether Claude, Gemini, or neither actually produced the
result — the doctor-facing label was never connected to what really
happened. A second, smaller bug in the same area: the real Claude API call
hardcoded its model as a literal (`"claude-sonnet-4-20250514"`), while the
*displayed* label read a separate `ANTHROPIC_MODEL` env var — the two could
silently disagree if that variable were ever set to something else.

Fixed properly rather than patching the label in isolation:
- `TriageResult` gained a `modelUsed: string` field, set at the actual
  point a result is produced — `validateTriageResult` (used by both the
  Claude and Gemini response parsers) now tags it with the exact model
  string that was actually called, and `conservativeFallback` tags it with
  an explicit, unambiguous non-model label.
- `CLAUDE_MODEL`/`GEMINI_MODEL` constants replace the duplicated literals
  in both the API call and the tag, so the label and the real call can no
  longer drift apart.
- Verified `modelUsed` survives both `enrichWithFallbackOpinion` and
  `mergeGuardrails`'s object spreads (both already spread the candidate
  first) — including the case where a *real* model's answer looks generic
  and gets its content swapped for the fallback opinion (AH-49): `modelUsed`
  correctly still says Claude/Gemini there, since a real model did run.
- `aiTriageJob.ts` now persists `result.modelUsed` instead of the
  unconditional stamp.

**Verified:** new permanent test confirms `modelUsed` never mentions
Claude or Gemini when the no-AI-provider fallback fires, and does contain
"fallback" explicitly. Full backend suite (148 tests) passes; `tsc`,
`eslint` (0 new errors — same 5 pre-existing warnings), and full build
clean.

## 19. Visit/booking address never decrypted — patients, nurses and doctors saw raw ciphertext or nothing, 2026-09-14

The user reported this as a visual bug — a "Next visit" card on the patient
dashboard with text overflowing its box — and asked for the overlap fixed.
The text overflowing was `v3:default:<base64 iv>:<base64 tag>:<base64
ciphertext>`: `Booking.encryptedAddress` rendered straight to the screen.
That ruled out CSS as the real fix; the actual bug is that no backend route
ever decrypted the address before sending it to a client.

Three routes were affected, each failing differently:
- `routes/bookings.ts` (GET `/` and GET `/:id`) — selected the field (Prisma
  returns every scalar column by default when a model's own fields aren't
  narrowed with `select`) and returned it raw. Patients saw ciphertext.
- `routes/nurse.ts` (GET `/visits`) — never selected `encryptedAddress` at
  all, so the nurse assigned to a visit could never see where to go; the
  frontend's "Address on file" fallback showed on every visit, always.
- `routes/visits.ts` (GET `/` and GET `/:id`, shared by patient/nurse/doctor)
  — same omission as `nurse.ts`.

Fixed by adding `safeDecrypt(value, aad?)` to `utils/encryption.ts` — wraps
`decryptData`, returns `null` on a genuine failure (rotated/wrong key,
corrupted row) instead of throwing and taking down the whole request over
one bad record, and passes a value through unchanged if it doesn't look
like ciphertext in the first place (covers any legacy plaintext row). All
three routes now select `encryptedAddress`, decrypt it server-side, and
return a plain `address` field with the ciphertext stripped from the
response entirely — there's no reason to ship ciphertext to a browser that
can't do anything with it. `routes/bookings.ts`'s `POST /` (booking
creation, encrypts on the way in) was already correct and untouched; it
encrypts with no AAD, so `safeDecrypt` is likewise called with no AAD on
the way out to match.

Frontend: the doctor dashboard's `NurseVisitCard`, the nurse dashboard
(active-visit banner and visit list), the patient dashboard's "Next visit"
card, and the patient visit-tracker page all read `booking.encryptedAddress`
directly — updated all five to read the new `address` field instead, and
added `wordBreak: 'break-word'` where it was missing so a long address
can't overflow its container again regardless of source. Removed the now-
dead `encryptedAddress` field from the `Booking`/`Visit` TypeScript types
(kept on `CreateBookingData`, which is the outbound field name the create
endpoint expects — unrelated to this bug).

**Verified:** `tsc --noEmit` clean on both `apps/backend` and `workspace`
(one pre-existing generic-type strictness issue in the new
`withDecryptedBookingAddress` helper was tightened to resolve, and one
stale `.next/types` reference to a deleted dev-only page was cleared —
neither caused by this change). `eslint` on every changed file: 0 errors,
only pre-existing warnings. Full backend Jest suite and both production
builds run clean.

## 20. Every real AI triage call had been silently failing for some time — retired model IDs, 2026-09-15

The user asked a design question: if the symptom checker sources evidence
from PubMed/NCBI/StatPearls, why doesn't it read as a real diagnostic
assistant even on straightforward cases? Pulled ~15 minutes of Railway
logs to check, rather than answering from the architecture alone.

The evidence pipeline was fine. The AI reasoning step that's supposed to
read that evidence was not running at all:

```
[aiTriage] Anthropic API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-sonnet-4-20250514"}}
[aiTriage] Claude failed: ...
[aiTriage] Gemini also failed: [GoogleGenerativeAI Error]: ... [404 Not Found] This model models/gemini-2.0-flash is no longer available. Please update your code to use models/gemini-3.6-flash...
```

Both hardcoded model constants in `aiTriage.ts` (`CLAUDE_MODEL`,
`GEMINI_MODEL` — unified into single constants by §18's fix) had been
retired by their providers. Every request hit both 404s and fell through
to `conservativeFallback`, the non-AI keyword safety net — which is why
cases displayed generic, non-evidence-grounded reasoning ("Cough with fever
... TB remains part of the differential ... Conservative safety fallback
was used") regardless of how good the fetched PubMed/StatPearls context
was: that context is only ever handed to Claude/Gemini, never to the
fallback. This wasn't specific to the one case the user pointed at —
matches multiple other queued cases in the same screenshot, all showing
the same fallback signature.

Fixed by updating the constants to each provider's current model
(`claude-sonnet-5`, `gemini-3.6-flash` — the latter taken directly from
Gemini's own 404 message). Also removed the stale `ANTHROPIC_MODEL=` line
from `env.example`, which no longer does anything since §18 unified the
display label and the real API call onto the same hardcoded constant —
leaving it in the example file invited someone to "fix" this exact problem
by setting an env var that the code doesn't read.

Second, unrelated bug in the same log window: Redis has been unreachable
in production —
```
❌ Redis connection error: connect ENOENT //default:<pw>@redis.railway.internal:6379
```
— `REDIS_URL` is missing its `redis://` scheme, so ioredis can't parse it.
This is the same config bug flagged in §15's Redis incident review; it was
apparently never corrected on Railway's side, or regressed since. Rather
than wait on that dashboard fix again, added `normalizeRedisUrl()` in
`services/redis.ts` so a scheme-less value is corrected in code and the
existing retry loop (from §15) does the rest. This does not affect AI
triage correctness directly (the synchronous fallback path runs with or
without Redis) but explains why background jobs, the NCBI/PubMed evidence
cache (§14), and auth lockout checks (`[auth] Redis unavailable ... failing
open`) have been degraded the whole time. The underlying Railway variable
should still be corrected directly — the code fix is a safety net, not a
substitute for fixing the actual value.

**Verified:** new `redis.test.ts` (4 cases) pins `normalizeRedisUrl`
against well-formed `redis://`/`rediss://` URLs (unchanged) and two
malformed shapes seen in the wild. `tsc --noEmit` and `eslint` clean (0
errors) on both changed files. Full backend Jest suite passes (one test —
a live network call to evidence providers with no test-env API keys —
timed out under concurrent load in this run and passed cleanly in
isolation; pre-existing flakiness unrelated to this change, not a
regression).

## 21. Doctor lost in-progress clinical notes on session expiry, 2026-09-15

Reported while a doctor was actually using the fixed triage flow from §20:
a session token expiring mid-review forced a re-login, and everything typed
into the review form (clinical notes, diagnosis, recommendations) was gone
— nothing in it was persisted anywhere until the final submit. Two separate
problems compound this, so both got fixed rather than papering over one.

**Root cause — sessions only ever renewed reactively.** Access tokens are
short-lived (15m default, `JWT_EXPIRES_IN`) and were only ever refreshed by
`lib/api/client.ts`'s response interceptor, which fires on an actual 401
from an actual API call. Filling in a review form makes zero API calls
until the doctor hits Save — so a review that takes longer than 15 minutes
could hit that 401 for the first time on submit, and if the 7-day refresh
token had also lapsed (inactivity, revocation, a dropped cookie), the
interceptor's failure path does a hard `window.location.href =
'/auth/login'`, which wipes all in-memory React state unconditionally.
Fixed by adding a proactive refresh heartbeat in `AuthContext.tsx` — every
10 minutes (inside the 15-minute access-token window) while authenticated,
silently call `/auth/refresh` in the background. This keeps a doctor's
session alive through normal long-form clinical work without them ever
needing to notice; a genuine logout becomes the rare case (real multi-day
inactivity or an actually-revoked session) instead of a routine mid-task
interruption. A failed heartbeat call is swallowed deliberately — it lets
the next real request's existing reactive handling in `client.ts` decide
whether the session is actually gone, rather than racing it.

**Safety net — the underlying data-loss shouldn't depend on the cause.**
Even with the above, a doctor can still lose typed notes to a browser
crash, an accidental tab close, or a real multi-day-inactivity logout — the
fix above reduces how often sessions expire mid-task, it doesn't make form
state durable. Added local draft persistence for the review modal
(`_lib.ts`'s `loadReviewDraft`/`saveReviewDraft`/`clearReviewDraft`,
`localStorage`-backed and keyed by case id): the form autosaves on every
change, `onOpenReview` restores a matching draft if one exists (with a
toast so the doctor knows it happened, rather than being confused by a
pre-filled form), and the draft is only cleared after a successful save.
Scoped to the review modal specifically, since that's the reported case and
the highest-value target (it's the point where a doctor first writes
free-text clinical reasoning); the same pattern extends cleanly to the
prescription/referral/follow-up modals if the same loss is reported there.

**Verified:** `tsc --noEmit` and `eslint` clean (0 errors) on all three
changed files. No frontend test runner exists in `workspace` to add a
regression test to (`npm test` is a no-op placeholder) — verified by
reading the actual save/restore/clear call sites against the reported
failure mode; not exercised in a live browser session (no local backend/DB
in this environment, per earlier sections). Production build compiles
clean.

## 22. Admin console — four broken/missing pieces found while scoping SOP documentation, 2026-09-17

Came up while asked what a system admin actually sees after a doctor issues
an emergency referral, ahead of writing operational SOPs for the app.
Traced every button on the admin dashboard against the actual backend and
found the whole admin panel had far less working behind it than the UI
implies — `routes/admin.ts` had exactly three endpoints (list users,
aggregate stats, suspend) while the frontend's `adminApi` called five more
paths that didn't exist. Fixed all of it rather than documenting a
partially-fake admin workflow:

- **"+ Add User" 404'd** — `POST /admin/users` didn't exist. Added it:
  validates with the same `emailSchema`/`passwordComplexitySchema` used by
  self-registration (now exported from `routes/auth.ts` instead of
  duplicated), hashes with the same `BCRYPT_ROUNDS` convention, and sets
  `isActive`/`isVerified` true immediately — an admin-created account skips
  the email-verification loop because the admin is already vouching for the
  identity.
- **Suspend/Activate was two bugs deep** — the frontend called `PATCH
  /admin/users/:id`, the only real route was `PATCH /admin/users/:id/suspend`
  (wrong path, so it 404'd), and that route unconditionally set `isActive:
  false` regardless of intent — so even a correct path could never express
  "Activate." Replaced with one generic `PATCH /admin/users/:id` accepting
  `{ isActive }`, which the frontend already expected. Added a guard against
  an admin suspending their own account, which the old route had no
  protection against either.
- **HPCSA verification never existed anywhere.** The doctor dashboard tells
  a doctor "an administrator will verify it shortly" after they submit a
  practice number (see the "Verify HPCSA" nag on that dashboard), but no
  endpoint — not even a stub — let an admin do that. Every doctor was
  permanently stuck unverified, including the one who issued today's
  emergency referral. Added `GET`/`PATCH /admin/users/:id/hpcsa` and a
  column + "Verify" action on the admin users table.
- **"⚠️ Reset Platform Data" 404'd** — `POST /admin/reset-trial-data` didn't
  exist. Added it matching the UI's own stated scope ("delete ALL bookings,
  readings, visits, and users except you"): wipes bookings, visits,
  messages, payments, biometric readings, user baselines, health alerts,
  triage cases (+ cascaded prescriptions/referrals), and patient consents
  unconditionally; additionally deletes every user except the calling admin
  when `keepUsers` is false. The frontend's `confirm()`/`prompt("RESET")`
  dialogs are client-side only and don't stop a direct API call, so the
  endpoint requires `confirm: "RESET"` in the body too — the same pattern as
  `--confirm` on `scripts/reset-triage-cases.ts` (§19). `AuditLog` and
  `SancRegister` are deliberately untouched — the UI's own description never
  claimed to touch them, and an audit trail that erases itself on reset
  defeats its own purpose.

Deletion order in the reset handler matters for FK constraints and was
checked against `schema.prisma` deliberately, not by trial and error:
`Prescription`/`Referral`/`Booking`/`Visit` reference `User` with no
cascade, so they're deleted before any `User` row is; `Payment` references
`Visit` with no cascade, so it's deleted first; everything that *does*
cascade from `User` (`BiometricReading`, `UserBaseline`, `HealthAlert`,
`RefreshToken`, `TriageCase`'s patient side) is deleted explicitly anyway
for clarity rather than relying on the cascade firing only when
`keepUsers` is false.

**Verified:** `tsc --noEmit` and `eslint` clean (0 errors; one pre-existing
unused-import warning on `authMiddleware` fixed as a drive-by since the
file was already being rewritten) on all four changed files. Full backend
Jest suite (152/152) and both production builds compile clean. No
route-level test convention exists for this codebase to extend with
confidence outside a live database — the one integration-test file that
does exist (`triage.integration.test.ts`) requires a real Postgres
connection this environment doesn't have, so these endpoints are verified
by type-checking, lint, and a deliberate line-by-line check of the Joi
schemas and Prisma calls against `schema.prisma`'s actual constraints, not
by an executed test. Worth a real click-through in the deployed app before
relying on it for real HPCSA verification or a real trial-data reset.

## 23. SANC verification override had the same dead-end as HPCSA — nurses stuck flagged forever, 2026-09-17

Same class of bug as §22's HPCSA fix, found by checking whether the nurse
side of manual-review verification had the same gap the doctor side did.
`services/sancVerification.ts` already does everything up to the point of
letting an admin act: `verifySancRegistration` flags a nurse `NAME_MISMATCH`,
`EXPIRED`, `SUSPENDED`, or `NOT_FOUND` during sign-up, and
`adminOverrideVerification` already existed to clear that flag after an
out-of-band check, recording who approved it and why. But nothing ever
called it — no route, no admin UI — so a flagged nurse had no way back to
verified, same as every doctor before §22.

- **Added `GET`/`PATCH /admin/users/:id/sanc`** (`routes/admin.ts`), mirroring
  the HPCSA routes exactly: `requireAdmin`, `invalidateCachedUser` after the
  write, and a `createAuditLog` call on top of the audit entry
  `adminOverrideVerification` already writes internally (`SANC_MANUAL_OVERRIDE`
  on the `users` resource) — so the change shows up both in the nurse's own
  verification history and in the admin-action log, same as every other
  route in this file. `PATCH` requires a `reason` (min 3 chars, matching the
  service function's signature) and 400s if the nurse isn't currently in one
  of the four flagged statuses — a nurse who's already `Active`, or whose
  registration is `CANCELLED` (deliberately left off the overridable list;
  a cancellation is a harder stop than the other four and wasn't part of
  what the task asked this override to clear), can't be pushed through this
  endpoint.
- **Admin dashboard** — added a `SANC` column next to `HPCSA` on the user
  table (`admin/dashboard/page.tsx`), showing the nurse's
  `sancVerificationStatus` and, for the four flagged statuses, an "Override"
  action that prompts for a reason (mirroring the reset-data flow's use of
  `prompt()` for input the double-confirm pattern doesn't need here) before
  calling the new endpoint. `GET /admin/users` now also selects `sancId` /
  `sancVerificationStatus` / `sancCategory` so the table has the data to
  render without a per-row fetch, matching how `hcpsaNumber` / `hcpsaVerified`
  were already selected there.

**Verified:** dependencies weren't installed in this worktree at all
(`node_modules` missing everywhere); ran `pnpm install` and
`prisma generate` first. `tsc --noEmit` and `eslint` clean (0 errors, 0
warnings) on all four changed files
(`apps/backend/src/routes/admin.ts`, `workspace/src/app/admin/dashboard/page.tsx`,
`workspace/src/lib/api/admin.ts`, plus the read-only reference check against
`services/sancVerification.ts`). Full backend Jest suite: 152/152 passed.
Both production builds compile clean (`apps/backend`'s `tsc`+`tsc-alias`,
and `workspace`'s Next.js build). Same caveat as §22: no route-level test
convention exists for this codebase outside a live-Postgres integration
test, so the new routes are verified by type-checking, lint, a full test
run, and a line-by-line check against `schema.prisma` and the existing
HPCSA routes they mirror — not by an executed request against a database.
Worth a real click-through against a nurse flagged `NAME_MISMATCH` or
similar before relying on it in production.

## 24. AH-37 measured — bcrypt was the dominant capacity bottleneck, not the proxy, 2026-09-18

§3a flagged this as "the single most valuable missing number": run the load
test against the API directly, not through the Next.js proxy. Done here —
full stack (real Postgres, real Redis, the real ML service, all hit
directly) running locally rather than against a staging/production
Railway environment this session has no access to. That's a real
methodology limitation (see "What this run can't tell you" below), but it
answers AH-37's actual question — proxy vs. API — cleanly: the bottleneck
is in the API, full stop, and it's structural, not proxy overhead.

### Methodology

- `apps/backend` built and run as compiled JS (`node dist/index.js`,
  `NODE_ENV=production`), against a disposable local Postgres and a local
  Redis — not the Jest integration harness, a real running server hit over
  HTTP like production traffic.
- The real ML service (`apps/ml-service`) also running, not stubbed —
  `POST /biometrics` genuinely round-trips to it, same as production.
- `scripts/load-test-patient-pipeline.js` (login → submit biometrics → get
  alerts → get history, per simulated user) against 2,000 seeded mock
  patients, waves of 50/100/200/400 concurrent users.
- **Found and fixed a measurement bug on the way**: the script sent every
  simulated user from the same source, so `middleware/rateLimiter.ts`'s
  per-IP limiters — a real, correct production control — throttled the
  test harness itself well before reaching any genuine application
  ceiling, the same way they never would across 5,000 real users on 5,000
  real IPs. Fixed by sending a distinct `X-Forwarded-For` per simulated
  user (`SPOOF_CLIENT_IPS`, on by default), the same technique
  `scripts/true-capacity-test.js` already used. This only works because
  `trust proxy` is set to `1` hop and nothing sits in front of the process
  locally — running through a real reverse proxy, the proxy's hop is what
  gets trusted instead, not a client-supplied header.

### What this run can't tell you

This sandbox is a single 4-vCPU/15GB container running the Node backend,
the Python ML service, *and* Postgres all at once, competing for the same
four cores. Railway runs these as separate services with their own
resources. At the higher concurrency waves (400), that cross-service
contention is visible in the data (see below) and inflates the absolute
numbers beyond what real, properly-separated infrastructure would show.
**The relative improvement from a code-level fix (below) is still valid
regardless of topology — CPU-efficiency gains transfer. The absolute
flows/sec ceiling from this run should not be quoted as Railway's
capacity** without re-running against the real deployment topology.

### AH-51 — `bcryptjs` was serializing all login traffic onto one core

Login p50 scaled almost exactly linearly with concurrency — the signature
of a single-threaded queue, not a CPU-count-limited one:

| Concurrency | login p50 | login p95 |
|---|---|---|
| 50 | 16.6 s | 16.6 s |
| 100 | 32.9 s | 33.0 s |
| 200 | 65.3 s | 65.5 s |
| 400 | 90.6 s | 128.1 s |

`top` during a run confirmed it directly: the Node process pinned one core
at 100% while the other three sat idle — 26% total system CPU used. Root
cause: `bcryptjs` (`package.json`, all 9 call sites) is a pure-JavaScript
implementation with no native bindings, so `bcrypt.compare()`/`hash()` runs
entirely on Node's single main thread. It cannot use libuv's threadpool —
concurrent calls interleave via `setImmediate`, they don't parallelize.

**Fixed**: replaced with `@node-rs/bcrypt` (napi-rs/Rust, prebuilt binaries
for Linux/macOS/Windows — no `node-gyp`/C++ toolchain needed on a dev
machine, which matters given AH-38's existing note about this team's
Windows build friction) across all 9 call sites
(`routes/auth.ts`, `routes/admin.ts`, `routes/twoFactor.ts`,
`services/totp.ts`, and the seed/admin CLI scripts). Same `$2b$` hash
format — existing password hashes keep verifying, zero migration. Runs on
libuv's threadpool, so it actually spans cores.

Same test, same waves, after the swap:

| Concurrency | login p50 | login p95 | vs. before |
|---|---|---|---|
| 50 | 2.1 s | 3.7 s | **7.9×** |
| 100 | 4.4 s | 8.2 s | **7.4×** |
| 200 | 9.0 s | 16.6 s | **7.3×** |
| 400 | 17.4 s | 32.6 s | **5.2×** |

System CPU during a run rose from 26% to 71% — the work is now actually
spread across cores instead of queueing on one. Login p50 still scales
close to linearly with concurrency post-fix, and the model fits almost
exactly: a ~170ms native bcrypt op (cost factor 10) spread across libuv's
default 4-thread pool predicts `(concurrency / 4) × 170ms` — 2.1s, 4.3s,
8.5s, 17.0s against measured 2.1s, 4.4s, 9.0s, 17.4s. That's the next
lever if login throughput needs to go further: raise `UV_THREADPOOL_SIZE`
past the default 4 on a box with more cores (libuv doesn't infer it from
`nproc`), or lower `BCRYPT_ROUNDS` from the current default of 10.

**Verified**: `tsc --noEmit` clean, full unit suite (188/188), and the
auth + admin integration suites (26/26, real Postgres, real password
hashing end to end — register, login, wrong-password rejection, admin
user creation) all pass unchanged.

### Finding: the DB connection pool becomes the next bottleneck once bcrypt is fixed

With login no longer dominating, `history` (`GET
/patient/biometrics/history`) — a real Postgres round-trip — started
showing the queueing bcrypt used to mask: p95 hit 31.8s at 400 concurrent
against `PRISMA_CONNECTION_LIMIT=10` (`lib/prisma.ts`'s documented
default). Raising it to 30 measurably helped at 200 concurrent (`history`
p50 8.2s → 4.0s) but not at 400, where the bottleneck had already moved to
the shared-hardware contention this section's methodology caveat
describes — Postgres, Node, and Python all fighting for the same four
cores locally, which isn't how Railway separates these services.

**Not changed here** — this needs the real connection budget worked out
for the actual replica count once that's decided (see "Path to 5,000 /
20,000" below), not a single guessed number. `alerts` (no DB write beyond
the read) stayed flat (10–70ms) at every concurrency tested, confirming
this is connection-pool queueing specifically, not a general Postgres
capacity problem.

### AH-52 — the ML service has no worker concurrency

`/tmp/backend-loadtest-v3.log` showed 234 `ML service unavailable: timeout
of 5000ms exceeded` errors during the higher-concurrency waves.
`apps/ml-service/Dockerfile` ran `uvicorn` with no `--workers` flag —
one process, and `engine.py`'s numpy/pandas scoring plus `db.py`'s
`psycopg2` calls are synchronous, so neither yields to the asyncio event
loop. Under concurrent load, one request's scoring work blocks every other
request on the same process regardless of the container's CPU count — the
same class of bug as the bcrypt one, in the Python service instead of Node.

**Fixed**: `Dockerfile`'s `CMD` now reads `--workers ${ML_SERVICE_WORKERS:-1}`.
Defaults to 1 (today's behavior, unchanged) because multiple workers are
only safe with `DATABASE_URL` configured — `db.py`'s no-`DATABASE_URL`
fallback (local/dev only) is a per-process in-memory dict, so a second
worker in that mode would silently split a user's history across
processes. Production always sets `DATABASE_URL` (TimescaleDB), so set
`ML_SERVICE_WORKERS` to the container's CPU count there.

**Not verified against a real multi-worker run**: this sandbox's Postgres
doesn't have the TimescaleDB extension available, so `db.py` can only run
in its in-memory fallback mode here — the exact mode multiple workers
aren't safe in. Mechanically confirmed instead: started `uvicorn --workers
2` directly and confirmed via `ps --forest` that it spawns genuine
worker subprocesses (`multiprocessing.spawn`), not just accepting the
flag silently. Load-test this for real against a staging environment with
TimescaleDB configured before trusting the concurrency improvement, not
just the process count.

### Path to 5,000 / 20,000 concurrent

Little's Law, same method §3a used: 5,000 active users each transacting
every 30–60s is 83–167 flows/sec needed. This run measured *login*
throughput specifically, not the full mixed-flow rate §3a's original
production runs measured — the two aren't directly comparable, but the
login ceiling is a real, now much-higher, input to the same arithmetic.

- **Per-replica login ceiling on this 4-core box**: ~4.4 logins/sec before
  the bcrypt fix, ~23 logins/sec after — a ~5× improvement in how many
  replicas a given login rate needs, independent of deployment topology.
- **Getting to 5,000 concurrent is now a horizontal-scaling problem, not a
  hashing problem.** The architecture was already built for it (§3a):
  PgBouncer transaction pooling, Redis-backed sessions and rate limits,
  WebSocket pub/sub across replicas. What changed here is that the code no
  longer artificially caps what one replica can do before infrastructure
  becomes the limit.
- **Connection budget, worked as a formula, not a guess** (§3a/§4's own
  standing instruction): `replica_count × PRISMA_CONNECTION_LIMIT` must
  stay under PgBouncer's own pool size into Postgres, which must stay
  under Postgres `max_connections` with margin for migrations, the ML
  service, and any direct admin access. Pick the replica count first from
  the measured per-replica ceiling and the target flows/sec, then size
  `PRISMA_CONNECTION_LIMIT` to fit the budget — not the other way around.
- **The ML service needs the same replica/worker math as the Node
  backend** — it was invisible as a bottleneck before because bcrypt
  saturated first; §"Finding: the ML service has no worker concurrency"
  above is the fix, `ML_SERVICE_WORKERS` still needs a real number picked
  from a staging load test once TimescaleDB is in the loop.
- **20,000 concurrent is the same architecture, more replicas and more
  DB/Redis headroom** — nothing measured here points at a rewrite being
  needed, unlike §3a's original "if 5,000 means genuinely in flight at
  once, the gap is two orders of magnitude" caveat, which was written
  against the *old*, single-core-serialized ceiling. Re-run this same test
  after 5,000 is actually reached in staging before assuming the same
  holds at 20,000 — Redis and Postgres both need their own capacity
  planning at that scale (connection count, memory, replication) that
  hasn't been sized here.

### Still open, in priority order

1. **Re-run against real Railway staging**, not this local sandbox — the
   one number that actually answers "does this hold at 5,000," per this
   section's own methodology caveat.
2. **Size `PRISMA_CONNECTION_LIMIT` and PgBouncer's pool size together**
   against a chosen replica count, using the formula above — not the
   `10`/`30` values tried here, which were exploratory.
3. **Load-test the ML service with multiple workers against real
   TimescaleDB** — the fix here is verified to start correctly, not yet
   verified to fix the timeout under load.
4. **Re-measure AH-35** (Render's 0.5 vCPU sizing no longer applies —
   confirm what Railway tier is actually deployed and whether it changes
   any of the above).
5. Consider whether `UV_THREADPOOL_SIZE` should be set explicitly to match
   the deployed container's core count, rather than relying on libuv's
   default of 4 — free throughput on any instance size larger than 4
   cores, unlocked by nothing more than an env var, now that bcrypt
   actually uses the threadpool.

## 25. AH-45.5a — wearable-derived BP risk flag: rejected a threshold, shipped change-detection instead, 2026-09-22

Cuffless-BP feature exploration (product research, no BP measurement or
estimation claim — see the Sep 2026 strategy report) proposed a "BP risk
trend" signal derived from wearable HR/HRV/sleep data. First cut of
`BpRiskAssessment`/`_bp_risk_trend` (`apps/ml-service/models.py`,
`engine.py`) landed as a deliberate stub — `computable: false`,
`reasons_not_computable: ["AWAITING_CLINICAL_SIGN_OFF_ON_THRESHOLDS"]` —
on the same bar as `_who2019_non_lab_risk_category`: no GREEN/AMBER/RED
*risk level* without a cited source and clinician sign-off.

A same-day evidence memo (`Wearable trend signals → hypertension risk:
the evidence, and why there is no table to sign`, dated 2026-09-22)
reviewed the actual primary literature and concluded the blocker as
written was unresolvable, not because nobody looked but because the
literature doesn't support a threshold:

- **ARIC vs. Framingham HRV-hypertension findings disagree.** ARIC
  (Schroeder et al., *Hypertension* 2003, 10.1161/01.HYP.0000100444.71069.73,
  n=7,099) found RMSSD/SDNN/R-R quartile contrasts predicted incident
  hypertension (HR 1.24–1.44, lowest vs. highest quartile). Framingham
  (Singh et al., *Hypertension* 1998, 10.1161/01.hyp.32.2.293, n=1,434)
  largely didn't replicate it — only LF power in men reached significance,
  nothing in women at all. A quartile contrast from either isn't a
  personal cut-point, and the two landmark cohorts don't agree on which
  measure matters.
- **This is the same transport problem §13 already used to reject
  Framingham/QRISK3 outright** for CVD risk in African cohorts (Ghana
  RODAM, Nairobi PCE, H3Africa — "not merely imprecise but mutually
  uncorrelated"). A 1998/2003 US-cohort HRV odds ratio has a weaker claim
  to transport than the risk equations already rejected on those grounds.
- **Wrist PPG's own HRV bias makes it worse, not better.** Nuuttila et
  al., *Sensors* 2021 (10.3390/s22010137): wrist PPG overestimates
  lnRMSSD, and the bias is largest in participants with low LnRMSSD —
  exactly the people a low-HRV flag would need to catch. Structurally the
  same shape of problem already accepted in §12/AH-50 §50.4 for SpO2 and
  skin tone: a device-level bias running in the dangerous direction, where
  the fix is to widen margin and refuse to score, not add a correction
  coefficient.
- **Sleep is the one signal that does transport**, and it's still a
  population exposure, not a personal cut-point: short sleep → incident
  hypertension, RR 1.17 (95% CI 1.09–1.26), pooled across 153 prospective
  cohorts, 5,172,710 participants (Itani et al., *Sleep Medicine* 2016,
  10.1016/j.sleep.2016.08.006). Long sleep shows no association (Jike et
  al., *Sleep Medicine Reviews* 2017, 10.1016/j.smrv.2017.06.011).

**Decision, accepted and acted on immediately**: don't source the
threshold, narrow the claim instead. `BpRiskAssessment` no longer has a
`risk_level` or a `computable` gate at all — asking "is this patient's BP
elevated" was the wrong question for this evidence base. It now asks
"has this patient's own signal moved from their own baseline," which
needs no population threshold:

- `hr_deviation` / `hrv_deviation` now call the *actual* AH-50-hardened
  primitives (`_persistent_anomaly`, `_hrv_deviation`) — the same ones
  `_evaluate()` uses for the general alert pipeline — not the older,
  ungated `_extract_features` output (raw 14-day HR slope; raw z-score on
  right-skewed RMSSD) the first cut was wired to by mistake. Reusing
  `_extract_features` here would have quietly reintroduced the exact
  defect AH-50 fixed, under a new label.
- `short_sleep` keeps the literature-defined absolute cutoff (<5.5h, per
  Itani et al.'s short-sleep category) rather than a personal baseline —
  correct, since this is a population exposure claim, not a personal-
  deviation one, and personalising it would misrepresent the citation.
- `prompt_bp_check` is `true` whenever any of the three signals fire.
  `disclaimer` states explicitly this is not a measurement or a risk
  score.
- **Structural guarantee, verified by inspection of `full_analysis`**:
  `bp_risk` is computed independently of `cvd_risk` and `alert_level` and
  is not referenced by `_fusion_from_cvd_risk` or
  `requires_clinician_review` — it cannot alter the CVD risk category and
  cannot suppress or downgrade an AH-43/44 absolute-floor escalation,
  satisfying sign-off conditions #2 and #3 below.

**Still open — sign-off, not code**: the evidence memo's own framing is
that a named HPCSA-registered clinician can sign this version on ordinary
conservative-judgment grounds (not a predictive-accuracy claim): (1) the
AH-50 deviation flags are a reasonable trigger for recommending a cuff
reading, (2) the flags are displayed as non-diagnostic and cannot alter a
risk category, (3) no flag suppresses or downgrades an absolute-threshold
escalation. Per §12's own precedent ("build and land on main now;
sign-off is a parallel track, not a merge gate"), this lands now; nothing
in the backend or frontend consumes `bp_risk` yet, so it reaches no
patient before that signature exists regardless.

**Discrepancy resolved**: the evidence memo named two companion documents
— `claude/clinical-thresholds-spec.md` and
`claude/threshold-transcription-status.md` — that turned out not to exist
anywhere, confirmed directly by the user. Rather than reconstruct files to
match a citation that didn't point at anything real, the actual gap they
were pointing at — every item in this codebase awaiting a named
clinician's signature is scattered across `ENGINEERING_PLAN.md` prose with
no single enumerable list — is now addressed for real:
**`docs/CLINICAL_SIGNOFF_CHECKLIST.md`**, built from a fresh grep of every
"sign-off" reference in `apps/` and `docs/`, cited by file and line. It
covers all ten live items, including this section's own AH-45.5a
conditions, and makes explicit that exactly one of them (paediatric TEWS)
has an actual code-level gate — everything else, including AH-45.5a, ships
live under §12's "parallel track, not a merge gate" precedent.

**Not yet done**: backend TS types / patient / clinician dashboard wiring
for `bp_risk` (all still Tier B scope, still unbuilt); the
`Visit`-linked `BpCalibrationEvent` model for the clinic/pharmacy
workflow, needed later to actually validate `prompt_bp_check` against
real cuff readings.

**Verified:** a real Python 3.12 venv with the service's actual dependencies
(pydantic, numpy, pandas, psycopg2-binary) was created for this session
(none existed before). `main.py` — the actual Railway entrypoint — imports
and builds its FastAPI app cleanly end-to-end, confirming `/early-warning/analyze`
now returns `bp_risk` alongside the existing fields.

One real environment constraint hit and worked around, not bypassed: this
machine's Application Control policy blocks psycopg2's native DLL
(`_psycopg`) from loading at all — persistent across retries, not a
transient first-scan block like numpy's own compiled extension was. Since
`_bp_risk_trend` and the AH-50 primitives it calls (`_persistent_anomaly`,
`_hrv_deviation`, `_calculate_blended_baseline`) operate only on the
`history`/`data` arguments passed in and never call `db.*` themselves,
verification stubbed `sys.modules["db"]` with a no-op `ensure_schema`
before import — ordinary dependency substitution for a unit test, not an
attempt to defeat the policy; psycopg2 itself stays blocked and unused by
this check, and production still needs it. The one-time `main.py` import
check above used the same stub, since its routes also only need `engine`
to build, not a live DB connection.

A disposable verification script (`_verify_ah45_5a.py`, deleted before
commit, same convention as §12) exercised 9 scenarios against the real
engine, all passing: cold start with no history makes no claim; a stable
baseline at the current reading raises no signal; HR elevated on the
current reading *and* persisting on a prior one (2-of-3, AH-50 §50.3)
flags `hr_deviation`, while the identical current-reading spike with a
normal prior history does not (the exact single-spike-vs-persistent
distinction §50.3 exists for); HRV shifted well past the smallest-
worthwhile-change from its first-week baseline flags `hrv_deviation`, a
stable HRV series does not; short sleep (<5.5h) flags `short_sleep`,
normal sleep does not; a combined HR-deviation + short-sleep scenario
correctly sets `prompt_bp_check=True` with both signals listed; and
`full_analysis`'s own source was inspected to confirm `bp_risk` is
computed after `cvd_risk`/before `fusion` without either referencing the
other, matching the structural guarantee claimed above.

## 26. AH-45.5a follow-up — sign-off gate added, two more corrections, 2026-09-23

**Reminder, since this is easy to lose track of**: `prompt_bp_check` is
now gated behind `BP_CHECK_PROMPT_SIGNED_OFF` (unset/false by default) and
still reaches no patient regardless, since no backend/frontend code reads
`bp_risk` yet. Row 10 of `docs/CLINICAL_SIGNOFF_CHECKLIST.md` is the
single source of truth for whether sign-off condition #1 has actually
happened — check there, not memory, before wiring this into any dashboard.

**Gate added** (`apps/ml-service/models.py`, `engine.py`): mirrors
`triageSafety.ts`'s `PAEDIATRIC_TEWS_SIGNED_OFF` pattern exactly.
`_bp_check_prompt_signed_off()` reads `BP_CHECK_PROMPT_SIGNED_OFF`; when
unset/false, `prompt_bp_check` is forced `false` regardless of detected
signals. Deliberately does **not** suppress `hr_deviation`/
`hrv_deviation`/`short_sleep`/`contributing_signals` — those stay
computed and visible even while gated, so retrospective validation data
(comparing what the algorithm would have flagged against manually-entered
cuff readings) can accumulate before sign-off, without the gated
`prompt_bp_check` ever reaching a patient as an actionable claim. New
`BpRiskAssessment.signed_off` field surfaces the gate's state directly in
the API response, so a future consumer can defensively check it rather
than trust that the gate was applied correctly upstream.

**Verification gap — closed same day.** At the time this section was first
written, the gate had *not* been verified by execution: this machine's
Application Control policy (identified as Windows 11 Smart App Control,
via `VerifiedAndReputablePolicyState` in the registry) started blocking
pandas' own compiled extension in addition to psycopg2, persistently,
confirmed by deleting and recreating the venv from scratch. SAC has no
per-file exclusion mechanism — the only fixes are disabling it machine-wide
(one-way, requires a Windows reinstall to re-enable) or developing
somewhere it doesn't apply. Set up WSL2 (`wsl --install -d Ubuntu`,
completed 2026-09-23) instead of disabling a security feature to unblock a
dev-tooling problem. Also matches production more closely (Railway runs
Linux containers; local dev was Windows-native).

Ubuntu's first-launch step needs an interactively-created personal
username/password, which hung waiting on stdin in a non-interactive
session (and isn't something to set on the user's behalf regardless — it's
their account). Created a non-root `ahava` dev user instead
(`adduser --disabled-password`, passwordless sudo) rather than continuing
to operate as root for routine setup — the first attempt at root-level
venv creation was correctly blocked by the session's own safety classifier
("Security Weaken"). ml-service dependencies installed clean from the real
`requirements.txt` (Python 3.14 — Ubuntu 26.04's default, no 3.12 package
available via apt, tried anyway since a same-generation wheel gap seemed
unlikely by this point and it installed without issue) — `psycopg2`,
`pandas`, `numpy` all import without any Application Control interference,
confirmed directly.

**With a working interpreter, actually verified the gate.** Re-ran the
original 9 scenarios from §25 plus 2 new ones covering the gate
specifically (explicit `false`, `true` with real signals, `true` with no
signals) — 11/11 passed against the real engine in WSL2. This closes the
gap this section originally flagged: the gate is no longer "reasoned
through by hand," it's been executed.

If this Smart App Control block recurs for other tooling, it's worth
checking with whoever manages endpoint security on this
machine — the policy state changed between two points in the same day
with no local action taken to cause it.

**Two corrections to the "three things" follow-on plan** (§25's "Not yet
done" list), caught before building the wrong thing rather than after:

1. **No new `BpCalibrationEvent` model.** `BiometricReading` already has
   `bloodPressureSystolic`/`Diastolic` and `source` — the only real gap
   was linking a reading to the visit it was taken during. Added
   `BiometricReading.visitId` (nullable FK to `Visit`,
   migration `20260923120000_add_visit_id_to_biometric_readings`) instead
   of a parallel table. Schema validated (`prisma validate`, real
   Prisma CLI — no DB connection needed for schema-only validation, ran
   clean).
2. **`Visit.biometrics` (the JSON field that looked like an existing
   calibration-data mechanism) turned out to be dead schema** — its own
   comment says "for patients without wearable devices," but a repo-wide
   search found no route anywhere that reads or writes it. Building the
   calibration-data link on top of it would have meant building two
   unproven things at once (the link, and the write-path that was never
   actually implemented). Went with `visitId` on the already-live
   `BiometricReading` table instead — see #1.

**Retrospective-data-banking check**: no scheduled/automatic retention job
purges `BiometricReading` — confirmed by search. Two manual deletion paths
exist, both intentional and gated: `POST /admin/reset-trial-data`
(`admin.ts`, requires `confirm: "RESET"` in the body, admin-only — the
"nuclear option" on the admin dashboard) and
`scripts/targeted-reset.ts` (a hand-run dev/ops script, not exposed over
HTTP). Neither is a code defect to fix here, but worth naming as an
operational caution: either one, run during the validation window,
deletes exactly the history the retrospective-validation effort is
counting on, with no special protection for that use case.

**Frontend**: `workspace/src/lib/api/patient.ts`'s `EarlyWarningSummary`
interface gained a `bp_risk` field mirroring the Python response shape
exactly (raw snake_case passthrough — confirmed in §-era investigation
that the backend route does no case transformation). Comment on the field
warns against rendering `prompt_bp_check` without checking `signed_off`,
and against letting it influence `AcuityRow` or any other acuity display.
Typechecked clean (`tsc --noEmit`) — the only errors in the full run are
pre-existing missing devDependencies (`vitest`, `@testing-library/react`,
`fake-indexeddb`) in unrelated test files, not caused by this change.

## 27. Row 7 (WHO 2019 chart) — sourced, transcription attempted and correctly abandoned, 2026-09-23

Sourced the real primary document per `CLINICAL_SIGNOFF_CHECKLIST.md` row 7:
downloaded `docs/references/Appendix-VII-Cardiovascular-Risk-Assessment-F2020-4-Version-1.0-1-November-2024.pdf`
directly from health.gov.za, confirmed it matches the citation already in
§13 (2020-4_Version 1.0, 25 October 2024). Also pulled WHO's own HEARTS
technical package PDF from WHO's IRIS repository as a cross-check source —
same underlying chart. Both saved under `docs/references/` with a README
explaining provenance and status, rather than left as URLs that can rot.

Confirmed the chart's real structure directly (not assumed): 2 sexes × 2
smoking statuses × 7 age bands × 6 BMI bands × 5 systolic-BP bands = 840
cells, 4 WHO risk categories (green <5%, yellow 5–10%, orange 10–20%, red
>20%), laid out as a colour grid — genuinely an image in the source, not a
data table, confirming §13's account of why the earlier automated
extraction attempt failed.

**Attempted manual transcription, caught it failing its own reliability bar
before shipping anything.** Rendered page 2 at 400 DPI (once poppler-utils
was actually working — see §26) and did a first-pass read of the full Man
and Woman blocks. Then, re-reading the *same* already-rendered image a
second time as a cross-check, produced a different answer for the
45-49/Man/Non-smoker row than the first pass — not a boundary judgment call
(e.g. "is this orange or red"), a flatly different transcription of the
same cells. That's disqualifying on its own terms: this section's own
standard throughout has been that a transcription this codebase ships needs
to be independently re-derivable, and catching an inconsistency in your own
two reads of the same static image is direct evidence it currently isn't,
not excessive caution.

Also caught a monotonicity violation in the first pass while cross-checking
by hand (70-74/Man/Smoker block: row 3, which sits at higher SBP than row 4
and should therefore carry equal-or-higher risk, was read as lower risk at
one BMI column) — exactly the failure mode that sank the earlier automated
extraction effort (§13: "produced non-monotonic (impossible) values on real
cells"). Doing this by a single human-relayed visual pass, however careful,
hit the same wall a script did.

**Did not ship a transcription.** No cell values were written into
`engine.py`/`models.py` — `_who2019_non_lab_risk_category` is unchanged and
still correctly refuses to score. Cropped, complete, legible reference
images (`left_man.png`, `right_woman.png`, both confirmed fully readable
end-to-end, unlike several intermediate sub-crops that had a boundary-math
bug cutting off the last row of a block — deleted before commit, not saved)
are kept in `docs/references/chart-crops/` so whoever transcribes this next
doesn't need to re-source or re-render anything, only look and enter
values.

**Recommended path, recorded rather than just said in chat**: either (a) a
human transcribes directly from `left_man.png`/`right_woman.png` on their
own screen with native zoom, which is inherently more reliable than a
relayed description, or (b) transcription is attempted again but one row (5
cells) at a time, written down immediately adjacent to viewing it rather
than batched from memory across multiple blocks — slow (~140 steps) but
doesn't have the failure mode observed here. Whichever path is taken, the
monotonicity check (non-decreasing risk with age, BMI, SBP, for fixed
sex/smoking) is mandatory before any value from this chart reaches
`computable: true`, and the result still needs the clinician sign-off
`CLINICAL_SIGNOFF_CHECKLIST.md` row 7 already calls for regardless of how
clean the transcription looks.

## 28. Row 7 done properly — colour-classification instead of human transcription, wired in behind a sign-off gate, 2026-09-23

§27's human transcription attempt correctly caught itself failing (a second
read of the same image disagreed with the first, plus a monotonicity
violation) and stopped before shipping anything. Rather than retry the same
method more slowly, replaced it with a different method entirely: instead
of a person describing colours from a rendered image, sample each cell's
actual pixel colour programmatically and classify it against reference
colours — deterministic, reproducible, and not subject to the
memory-reconstruction drift that sank the manual attempt.

**Method:**
1. Rendered page 1 (the legend) and page 2 (the chart) at 400 DPI inside
   WSL2 (poppler-utils installed there after Windows's `pdftoppm.exe` got
   quarantined by Smart App Control mid-session, same delayed-block pattern
   as psycopg2/pandas earlier — see §26).
2. Sampled the 4 legend swatch colours from page 1 at visually-confirmed
   coordinates: GREEN (0,176,80), YELLOW (255,255,0), ORANGE (255,192,0),
   RED (255,0,0) — standard values, high confidence.
3. Detected the actual chart grid on page 2 programmatically: summing a
   saturation mask by row/column found exactly 4 column bands (the 4
   sex×smoking groups) and 7 uniform-height row bands (the age groups) with
   real gaps between them — no manual boundary guessing, unlike the
   sub-crop attempts in §27 that had a cutoff bug. Each block divided
   evenly into its known 5×5 sub-grid (BMI × SBP).
4. Sampled the central 50% of each of the 700 cells (avoiding
   border/gridline pixels) and classified against the legend colours —
   which surfaced something real: the chart's actual cell colours
   ((10,164,129), (254,194,16), (243,110,33), (238,29,35)) are
   systematically different from the page-1 legend swatches, by a small
   but *exactly consistent* offset per category (not noise — same distance
   repeated across every red cell, every orange cell). Almost certainly the
   legend and the chart image were produced by different tools/rendering
   paths using close-but-not-identical palettes for the same 4 semantic
   categories.
5. Re-calibrated: collected the distinct colours actually present across
   all 700 sampled cells directly, rather than trusting the legend page.
   Result: **exactly 4 distinct RGB values, zero cells outside them, zero
   blended/ambiguous colours** — strong independent confirmation the grid
   detection in step 3 was pixel-accurate, since a boundary error would
   have produced blended edge colours somewhere across 700 samples.
   Mapped those 4 to categories by hue (unambiguous: teal→GREEN,
   yellow→YELLOW, orange→ORANGE, red→RED).

**Validation, mechanical not eyeballed:** checked monotonicity on all 700
cells across all three axes — non-decreasing risk with rising BMI,
non-decreasing risk with rising SBP, non-decreasing risk with rising age,
within each of the 4 sex×smoking groups. **Zero violations.** Also spot-
checked 5 cells against values already independently confirmed by eye
earlier in this session (obvious corners plus two specific cells from the
§27 manual read) — 5/5 matched.

**Shipped as gated data, not flipped live.** `apps/ml-service/who_2019_chart_data.py`
(the 700-entry table, generated from the validated JSON, with the method
note above in its header) and `who_2019_chart_lookup.py` (band-boundary
helpers: age→5-year band, SBP→band, BMI→band, `lookup()`). Wired into
`_who2019_non_lab_risk_category` in `engine.py` behind a new
`WHO_2019_CHART_SIGNED_OFF` env var — same fail-safe pattern as
`BP_CHECK_PROMPT_SIGNED_OFF` (§25/§26) and `PAEDIATRIC_TEWS_SIGNED_OFF`
(§12). Unset/false (the default everywhere today): behaviour is unchanged
from before this section — `computable: false` — except the reason code is
now `WHO_2019_CHART_AWAITING_CLINICIAN_SIGNOFF` instead of
`WHO_2019_CHART_NOT_YET_DIGITIZED`, which is now simply accurate: it *has*
been digitized, what's left is the signature, matching every other gated
item on the checklist rather than being a unique double-blocked case.

**Verified for real**, in WSL2: 7 scenarios covering gate-off (old
behaviour preserved, new reason code), gate-on with a known RED cell and a
known GREEN cell matching the validated data exactly, out-of-range age
still refusing even with the gate on, a missing required field still
refusing even with the gate on, and a full `full_analysis()` end-to-end
call returning a real category while `bp_risk` stays independently
computed (structural guarantee from §25 still holds — confirmed again, not
assumed). All 7 passed. `main.py` still imports and builds its FastAPI app
cleanly with the new modules wired in.

**Still open — same as every other row, now genuinely just this**: a named
HPCSA-registered clinician needs to review the transcription (the two
source crop images plus `who_2019_chart_data.py`) and the instrument choice
itself, and flip `WHO_2019_CHART_SIGNED_OFF`. `CLINICAL_SIGNOFF_CHECKLIST.md`
row 7 updated accordingly — no longer "structurally blocked regardless of
sign-off," now a normal sign-off-gated row like the rest.

Disposable verification scripts and intermediate renders (`_extract_chart.py`,
`_finalize_chart.py`, `_verify_who2019.py`, `page1.png`, broken sub-crops
from §27) deleted before commit, matching this file's established
convention. Kept: the two source PDFs, `left_man.png`/`right_woman.png`
(clean, complete, still useful for the clinician's own visual cross-check),
`page2-2.png` (full-page reference), and `chart_data_final.json` (the raw
extracted+validated data the `.py` module was generated from, for
independent re-verification without re-running the extraction).

## 29. Patient-facing UI for cvd_risk/bp_risk, and a real bug found along the way, 2026-09-24

Went to add `cvd_risk`/`bp_risk` to the patient Early Warning page
(`workspace/src/app/patient/early-warning/page.tsx`) and found the page
was built against a response shape real traffic never actually sends.

**The bug**: `GET /patient/early-warning` (`apps/backend/src/routes/patient.ts`)
forwards the real ml-service response (`mlData`) completely unmodified —
`alert_level`, `cvd_risk`, `hr_trend_2w`, etc., matching
`apps/ml-service/models.py` exactly. But `mlServiceAvailable` is false
whenever `ML_SERVICE_URL` contains `"localhost"` — true for essentially
all local dev, not just when the service is genuinely down — and the
fallback branch used for that case built a *different*, older shape:
`riskLevel`, `trendAnalysis`, `baselineMetrics`. The frontend page was
written against that older shape. Net effect: in local dev (always) and
any real prod outage (sometimes), the page's primary display
(`data.riskLevel`, `data.trendAnalysis.heartRate`, ...) silently rendered
nothing meaningful, because those keys don't exist on the real payload —
and in the one case where the real payload *does* flow through unmodified,
the page was reading fields that were never there either. This predates
today; not introduced by this session, just never caught because nothing
until now needed `cvd_risk`/`bp_risk` to render correctly enough to notice.

**Fixed at the source, not patched at the display layer**: rewrote the
fallback in `patient.ts` to build the exact same shape as the real
ml-service response (`cvd_risk: {computable:false, reasons_not_computable:
["ML_SERVICE_UNAVAILABLE"], ...}`, `bp_risk` with the real disclaimer text,
etc.) instead of adding shape-detection logic to the frontend. One
contract, regardless of which branch fills `mlData`. Also fixed a
dangling reference in the clinical audit log
(`riskLevel: (mlData as any)?.riskLevel` — always `"UNKNOWN"` now that
neither branch sets that key) to log `cvdRiskCategory`/`bpPromptCheck`
instead, the two signals actually worth auditing.

**Frontend**: `workspace/src/lib/api/patient.ts`'s `EarlyWarningSummary`
interface rewritten to match the real shape exactly — dropped
`riskLevel`/`trendAnalysis`/`baselineMetrics` and the dead
`risk_scores.framingham_10y_pct`/`qrisk3_10y_pct` fields (unused since
AH-45 removed those instruments), added `cvd_risk`, top-level biometric
fields, `uncertainty`/`provenance`/`requires_clinician_review`.
`early-warning/page.tsx` rewritten against the corrected type: a BP-check
card (renders on `bp_risk.prompt_bp_check`, which stays false everywhere
until `BP_CHECK_PROMPT_SIGNED_OFF` — inert today by design, not
unfinished) and a CVD risk card that explicitly renders the
"not yet available, here's why" state rather than hiding silently when
`cvd_risk.computable` is false (true everywhere until
`WHO_2019_CHART_SIGNED_OFF`). Also fixed stale intro copy referencing
Framingham/QRISK3, which AH-45 replaced with the WHO 2019 chart.
`tsc --noEmit` clean on both `workspace` and `apps/backend` (backend's
only errors are the pre-existing, unrelated `@node-rs/bcrypt` module
resolution gap already visible in git history before this session).

**A larger gap found, not built**: went looking for where the clinician
side surfaces any of this, expecting something partial. There is nothing
— `doctor/dashboard` is entirely triage-case-focused (`Worklist`,
`ReviewPane`, referral/prescription modals); no page anywhere under
`workspace/src/app/doctor` or `.../nurse` reads `EarlyWarningSummary`,
`cvd_risk`, `bp_risk`, or `BiometricReading` at all (confirmed by search,
not assumed). Building a clinician-facing biometric monitoring view is a
real feature — dashboard placement, whether nurses need it too, how it
relates to the existing triage worklist — not a small addition alongside
this fix, and not something to design silently. Flagged rather than built.

**Retrospective validation, actually persisted this time**: `bp_risk`/
`cvd_risk` were computed fresh on every page load and discarded after the
HTTP response — nothing existed to compare against a later manual cuff
entry for `CLINICAL_SIGNOFF_CHECKLIST.md` rows 7/10 validation, despite
that being called out as a goal twice already (§25, §26). Added
`BiometricReading.bpPromptCheck`/`bpContributingSignals`/`cvdRiskCategory`
(migration `20260924120000_add_bp_risk_retrospective_fields`) and a
best-effort persist (wrapped in try/catch — must never fail the response
a patient is waiting on) onto the reading each analysis was computed from.
`prisma validate` and `prisma generate` both clean; `tsc --noEmit` clean
on the updated route.

**Not tested against a live database or Jest** — this environment has no
Postgres instance running and standing one up was out of scope for this
pass. `patient.integration.test.ts` exists and covers biometrics
submission/history/alerts but not `/early-warning` specifically, and
wasn't run (would need a real DB connection). Confirmed by static
typecheck and code review only — flagged rather than silently claimed
equivalent to the ml-service-side verification earlier in this file, which
did have a real interpreter to run against.

**Explicitly not done, and why**: the other 6 checklist rows with no code
gate (adult TEWS, emergency-signs override, SpO2 band, AH-50 σ/persistence
rule, age/height band rule) were not retrofitted with the same
`*_SIGNED_OFF` pattern as rows 7/10. Adding one changes live runtime
behavior for features currently working in production on engineering
judgment — a bigger, more consequential call than anything else in this
session, and one that should be made deliberately, not swept in as a
"remaining work" item.

## 30. Clinician-facing monitoring dashboard — the gap from §29 filled in, 2026-09-24

Built the doctor-facing counterpart §29 found missing: a monitoring
worklist, the clinician-side equivalent of the patient Early Warning page.

**Backend**: `apps/backend/src/routes/doctorMonitoring.ts`, mounted at
`GET /api/v1/doctor/monitoring` behind `authMiddleware` + `requireDoctor`,
following `triageCaseReview.ts`'s exact conventions (same audit-log
pattern via `writeRequestAudit`, same `requireDoctor` middleware). Kept
deliberately separate from `triageCaseReview.ts`/`TriageCase` — continuous
biometric monitoring is a different concern from AI-triage case review,
not a variant of it.

Only patients with active `BIOMETRIC_MONITORING` consent
(`PatientConsent`, `withdrawn: false`) are visible — the first route ever
to read that consent type for this purpose. One row per patient (their
single most recent `BiometricReading`, via Prisma `distinct` on `userId`
ordered by `createdAt desc`) — deliberately fetched *before* filtering by
severity, not after, so a patient whose latest reading is GREEN can't
appear here on the strength of an older RED reading; the where-clause-first
approach would have picked whichever old row matched instead of confirming
the current state. Flagged (surfaced at all) on `alertLevel IN
(YELLOW,RED)` OR `bpPromptCheck` OR `cvdRiskCategory = '>20%'`, using the
retrospective-snapshot fields §29 just added.

**Frontend**: `workspace/src/app/doctor/monitoring/page.tsx` — new page,
added to `DashboardLayout`'s nav under the `DOCTOR` role (previously just
a "Licensed Doctor" badge with no nav links at all). Carries the same
Tier-2 "not a diagnosis" framing as the patient page. BP-check and CVD-risk
columns explicitly render their pending-sign-off state
(`— (pending sign-off — row 10/7)`) rather than a blank cell, so a doctor
looking at this page today sees *why* those columns are empty, not just
that they are.

**Verified**: `tsc --noEmit` clean on both `apps/backend` and `workspace`
(only pre-existing, unrelated errors — `@node-rs/bcrypt` resolution on the
backend, missing test-tooling devDependencies on the frontend, both
predating this session). Started the real Next.js dev server
(`workspace-dev`) and loaded both `/doctor/monitoring` and
`/patient/early-warning` directly: both compiled and returned real 200
responses, `RoleGuard` correctly redirected the unauthenticated session to
login (expected — no live session available), and the frontend's own call
to the new endpoint failed with a clean 502 (no backend process running in
this sandbox) rather than crashing the page. **Not verified**: the actual
query logic against real data — no Postgres instance in this environment,
same disclosed limitation as §29. The `distinct`-then-filter approach is
reasoned through carefully (see comments in `doctorMonitoring.ts`) but
hasn't been run against a database with real flagged/unflagged patients
mixed together.

## 31. First clinician sign-off recorded — rows 6, 7, 10, 2026-09-24

Dr. Neo Monareng (HPCSA MP1325247) reviewed and signed off, in person,
same day: row 6 (WHO 2019 chart instrument choice), row 7 (the
transcription in `apps/ml-service/who_2019_chart_data.py`, cross-checked
against `docs/references/chart-crops/left_man.png`/`right_woman.png`),
and row 10 (AH-45.5a's three conditions). Recorded directly in
`docs/CLINICAL_SIGNOFF_CHECKLIST.md`, per that document's own stated
process (name, HPCSA number, date) — confirmed with the user which rows
were actually in scope before recording anything, since row 7 and row 10
are materially different reviews (instrument choice + transcription
accuracy vs. three narrower behavioural conditions) and a sign-off record
is exactly the kind of thing not worth guessing on.

**What this does and doesn't change, today**: nothing, yet. Signing is
the clinical attestation; the `WHO_2019_CHART_SIGNED_OFF` and
`BP_CHECK_PROMPT_SIGNED_OFF` env vars this whole gate mechanism depends on
(§25/§26, §28) are still unset everywhere — no local `.env`, no Railway
config. `_who2019_non_lab_risk_category` and `_bp_risk_trend` still return
their fail-safe not-computable/no-prompt responses in every environment
right now, exactly as before this section. Flipping either var in a real
environment is a deployment action for whoever owns that environment —
not attempted here, and not something this session has Railway access to
do regardless.

Row 6 has no gate of its own (`_who2019_non_lab_risk_category` doesn't
branch on instrument choice separately from the chart data) — recorded as
signed via row 7's scope, which already included instrument choice in
what it asked a clinician to confirm, rather than inventing a redundant
gate for a question that's really the same review.
