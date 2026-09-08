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
| 5 | Compliance and durability | In progress — AH-13, AH-29 landed 2026-09-08; AH-26, AH-15's purge job, AH-23 still open |

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
| AH-41 (new) | `routes/webhooks.ts` carried a second, unauthenticated "POST /payment" webhook from before the PayFast migration that marked payments `COMPLETED` with none of AH-04/05's checks — its signature check failed *open* whenever `NODE_ENV` wasn't exactly `"production"` and `PAYSTACK_SECRET_KEY` was unset (the deployed default). Removed; PayFast's ITN handler in `routes/payments.ts` is the only payment webhook now. | `routes/webhooks.ts` |

Partial coverage also landed for AH-07 (tests): four unit suites covering token
typing, PayFast signatures, the CSRF guard, and the clinical safety thresholds,
plus new suites for the AH-13 encryption AAD/rotation and AH-29 2FA flow.

### Open

| ID | Finding | Priority |
|----|---------|----------|
| AH-32 | AI triage is `await`ed inside the HTTP handler — the primary blocker to 5,000 concurrent | P0 for scale |
| AH-33 | Image processing runs in-process on base64 inside a 20 MB JSON body | P1 for scale |
| AH-26 | TypeScript strict is off — five flags disabled, `strict` never set | P1 |
| AH-07 | Integration and end-to-end tests still absent | P1 |
| AH-03b | Double-submit CSRF token, for defence in depth beyond the origin check | P2 |
| AH-15 | Cross-border PHI transfer to AI providers not named in the consent record | P2 |
| AH-23 | No API versioning | P2 |
| AH-34 | `demoStream` holds a `setInterval` per user in-process | P2 |
| AH-35 | The Render `plan: starter` (0.5 vCPU) sizing this was measured against no longer applies — Render was removed in favour of Railway-only (§6). Re-measure against whatever Railway tier is actually deployed before assuming the bcrypt-saturation finding still holds at the same concurrency | P0 for scale — re-verify |
| AH-36 | Biometrics ingest — partially addressed 2026-09-08, see below | P1 for scale (downgraded — see note) |
| AH-37 | Load tests hit the Next.js proxy, so proxy and API latency are indistinguishable. Nobody knows which to fix. The load-test script already supports `BASE_URL` pointed at the API directly (it defaults there); the four historical runs just happened to target the production frontend domain instead — re-running against the real backend URL needs a live environment and is a manual step, not a code fix | P0 — measure first |
| AH-38 | The primary dev machine's Application Control policy blocks `pnpm.exe`. `corepack pnpm` works around it, but a new engineer hits this on day one. Get pnpm allowlisted, or commit to builds happening only in CI and Docker | P1 — infrastructure |

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

### AH-32 — move AI triage off the request path

`routes/triage.ts:488` awaits `analyzeSymptoms()` inside the HTTP handler. That
is a multi-second LLM call holding a socket, an event-loop slot and potentially
a database connection. At 5,000 concurrent with 5% submitting triage, roughly
250 requests sit parked on an external provider. Everything else in this phase
is secondary to it.

The infrastructure needed already exists and is unused for this path:

1. `POST /api/triage` validates, runs `assessDeterministicRisk` synchronously
   (it is pure and fast, and it is the clinical safety floor), creates the
   `TriageCase` in `PENDING_REVIEW`, enqueues an `ai-triage` BullMQ job, and
   returns `202 Accepted` with the case id.
2. A worker runs `analyzeSymptoms`, writes the result, and emits over the
   existing WebSocket fan-out.
3. The client subscribes to the case instead of blocking on the response.
4. Job failure leaves the case in `PENDING_REVIEW` with a flag — which is the
   conservative outcome anyway, since a doctor reviews every case regardless.

This changes the clinical flow's shape and needs a real staging run, not a unit
test. It is deliberately not in the first branch.

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

### AH-33 — image handling

Triage images arrive base64-encoded inside a 20 MB JSON body and are processed
by `sharp` in-process. That is CPU-bound native work on the request path, with
roughly 1.37× memory overhead from base64 and full buffering before processing.
Move to multipart upload, store the object, and process in a worker.

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

### Then measure

`scripts/load-test-patient-pipeline.js` exists but must run against staging with
a real AI provider in the loop, after AH-32. Until that number exists, 5,000 is
an aspiration rather than a claim. Tune `PRISMA_CONNECTION_LIMIT` and
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
- **AH-23** Move to `/api/v1/*` before a mobile client is in the field.
- **POPIA operations** Data export and erasure endpoints, a retention schedule,
  and a purge job. The `ExportJob` model already exists as a starting point.
  Retention periods decided (§6 item 3); the schedule/purge job itself is
  still unbuilt.

---

## 6. Decisions from the product side — resolved 2026-09-08

1. **Mobile approach: Capacitor, wrapping the existing Next.js app** —
   confirmed. `android/` is still orphaned (no `capacitor.config`, no
   `@capacitor/*` dependency, no synced web build) but is not being deleted:
   it will be rebuilt clean as part of mobile enablement rather than
   regenerated from scratch, since the native scaffold (package id, icons,
   Health Connect activity) has some reusable value. See the mobile-strategy
   assessment for the phased plan.
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

Point the platform health probe at **`/ready`**, not `/health`.
