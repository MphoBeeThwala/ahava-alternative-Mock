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
| 4 | Throughput to 5,000 concurrent | Designed, not started |
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
| AH-35 | The Render `plan: starter` (0.5 vCPU) sizing this was measured against no longer applies — Render was removed in favour of Railway-only (§6). Re-measure against whatever Railway tier is actually deployed before assuming the bcrypt-saturation finding still holds at the same concurrency | P0 for scale — re-verify |
| AH-36 | Biometrics ingest — partially addressed 2026-09-08, see below | P1 for scale (downgraded — see note) |
| AH-37 | Load tests hit the Next.js proxy, so proxy and API latency are indistinguishable. Nobody knows which to fix. The load-test script already supports `BASE_URL` pointed at the API directly (it defaults there); the four historical runs just happened to target the production frontend domain instead — re-running against the real backend URL needs a live environment and is a manual step, not a code fix | P0 — measure first |
| AH-38 | The primary dev machine's Application Control policy blocks `pnpm.exe`. `corepack pnpm` works around it, but a new engineer hits this on day one. Get pnpm allowlisted, or commit to builds happening only in CI and Docker | P1 — infrastructure |
| AH-42 (new) | Frontend monolithic files — `lib/api.ts` and `doctor/dashboard/page.tsx` split 2026-09-08, no behavior change — see below. `patient/ai-doctor/page.tsx` (897 lines), `profile/page.tsx` (738), and `auth/signup/page.tsx` (562) follow the same pattern and are unsplit | P2 — maintainability, not correctness |

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
Android emulator's `10.0.2.2` loopback alias, and branded launcher/splash
assets — none of which `cap add android` regenerates. It's moved to
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
- **Branding.** iOS's icons/launch screen are Capacitor's defaults, not
  the app's actual mark. Android's are real assets already in the
  scaffold; nothing to redo there.
- **Push notifications.** `android/app/build.gradle` already
  conditionally applies the `google-services` Gradle plugin if
  `google-services.json` is present, but no such file exists yet — Push
  is guarded off, not broken.
- **Store listings, signing keys, and submission** — all a separate,
  largely non-code workstream.
