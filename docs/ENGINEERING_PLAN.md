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

Phases 1–3 landed on `hardening/enterprise-readiness-p0`. Nothing in that branch
has been compiled or executed — the review environment has no package registry
access, so CI is the first thing that will genuinely verify it. Expect the first
run to be red, and treat that output as the next unit of work.

| Phase | Scope | State |
|---|---|---|
| 1 | Quality gate | Landed, unverified |
| 2 | Security blockers | Landed, unverified |
| 3 | Cleanup and operability | Landed, unverified |
| 4 | Throughput to 5,000 concurrent | Designed, not started |
| 5 | Compliance and durability | Not started |

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

Partial coverage also landed for AH-07 (tests): four unit suites covering token
typing, PayFast signatures, the CSRF guard, and the clinical safety thresholds.

### Open

| ID | Finding | Priority |
|----|---------|----------|
| AH-32 | AI triage is `await`ed inside the HTTP handler — the primary blocker to 5,000 concurrent | P0 for scale |
| AH-02b | Rate limiters use an in-memory store; limits are per-replica and reset on deploy | P0 for scale |
| AH-33 | Image processing runs in-process on base64 inside a 20 MB JSON body | P1 for scale |
| AH-08 | Auth cache is per-replica; deactivation lags up to 300s across the fleet | P1 |
| AH-26 | TypeScript strict is off — five flags disabled, `strict` never set | P1 |
| AH-07 | Integration and end-to-end tests still absent | P1 |
| AH-29 | No 2FA for prescribers | P1 |
| AH-03b | Double-submit CSRF token, for defence in depth beyond the origin check | P2 |
| AH-13 | PHI encryption has no AAD binding and no key rotation path | P2 |
| AH-15 | Cross-border PHI transfer to AI providers not named in the consent record | P2 |
| AH-20 | `Payment.paystackReference` / `paystackData` on a PayFast gateway | P2 |
| AH-23 | No API versioning | P2 |
| AH-24 | Red-flag triage patterns are singular and `\b`-anchored — "seizures" does not match "seizure" | P1 (clinical) |
| AH-34 | `demoStream` holds a `setInterval` per user in-process | P2 |

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

### AH-02b — distributed rate-limit store

Add `rate-limit-redis` and give each limiter a `RedisStore` backed by
`getRedis()`. Without it, limits are multiplied by the replica count and reset
on every deploy. The key-derivation fix (AH-02) already removed the unbounded
key-growth risk.

### AH-33 — image handling

Triage images arrive base64-encoded inside a 20 MB JSON body and are processed
by `sharp` in-process. That is CPU-bound native work on the request path, with
roughly 1.37× memory overhead from base64 and full buffering before processing.
Move to multipart upload, store the object, and process in a worker.

### AH-08 — cross-replica auth invalidation

Drop the in-process `Map` in `middleware/auth.ts` and rely on Redis alone, or
publish invalidations over the pub/sub channel the WebSocket layer already uses.

### Then measure

`scripts/load-test-patient-pipeline.js` exists but must run against staging with
a real AI provider in the loop, after AH-32. Until that number exists, 5,000 is
an aspiration rather than a claim. Tune `PRISMA_CONNECTION_LIMIT` and
`PRISMA_POOL_TIMEOUT` against the result, not against a guess.

---

## 5. Phase 5 — compliance and durability

- **AH-26** Turn on TypeScript strict in stages. Do not flip `strict: true`
  across 95 files in one commit — enable `strictNullChecks` first, directory by
  directory, starting with `services/triageSafety.ts` and `services/aiTriage.ts`.
- **AH-15** Confirm every route that reaches an AI provider is behind
  `requireConsent`, and version the consent text so it names the offshore
  processors and the transfer. POPIA s72 applies to symptom narratives.
- **AH-13** Bind encryption AAD to `{table}:{column}:{recordId}` and add a key
  id to the payload prefix so two keys can be live during a rotation.
- **AH-29** TOTP for `DOCTOR` and `ADMIN` before prescribing. Sequenced after
  AH-01, because MFA on a session that cannot be revoked is theatre.
- **AH-23** Move to `/api/v1/*` before a mobile client is in the field.
- **POPIA operations** Data export and erasure endpoints, a retention schedule,
  and a purge job. The `ExportJob` model already exists as a starting point.

---

## 6. Decisions needed from the product side

These are not engineering calls:

1. **`android/`** is orphaned — no `capacitor.config`, and the app it wrapped
   has been removed. Recommendation: delete it and rebuild from the Next.js
   frontend when mobile is funded. Left in place pending that call.
2. **Payment column rename** (AH-20) — whether the beta database can be wiped
   or needs a data migration.
3. **Retention periods** for audit logs and biometrics, for AH-15.
4. **Whether prescriber 2FA is mandatory** or opt-in at launch.
5. **One primary PaaS.** Railway, Render and Fly configs all sit in the repo and
   will drift. Recommendation: Railway primary, the rest archived under `deploy/`.

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
