#!/usr/bin/env node
/**
 * Read-only smoke test for a deployed Ahava stack (frontend, backend, ML service).
 *
 * Safe to run against production: it creates no accounts, signs in as nobody and
 * writes no clinical data. Every request is either a GET, or a POST that the
 * server must reject before it stores anything. It answers "is the deployed
 * stack up, wired together and still refusing what it should?" and nothing more;
 * the business logic is covered by the integration suites, which run against a
 * disposable database and must never be pointed at production.
 *
 *   BACKEND_URL=https://api.example FRONTEND_URL=https://app.example \
 *   ML_URL=https://ml.example ML_SERVICE_SHARED_SECRET=... node scripts/prod-smoke.js
 *
 * Only BACKEND_URL is required; checks for the others are skipped when unset.
 * ML_SERVICE_SHARED_SECRET is optional and only used to prove the key is accepted.
 * Exit code is non-zero if any check fails, so it can gate a deploy or run on a schedule.
 */
const BACKEND = (process.env.BACKEND_URL || "").replace(/\/+$/, "");
const FRONTEND = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
const ML = (process.env.ML_URL || "").replace(/\/+$/, "");
const ML_SECRET = process.env.ML_SERVICE_SHARED_SECRET || "";
const SLOW_MS = Number(process.env.SMOKE_SLOW_MS || 3000);

if (!BACKEND) {
  console.error("BACKEND_URL is required");
  process.exit(2);
}

let failed = 0;
let warned = 0;

async function req(method, url, { body, headers = {} } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method,
      redirect: "manual",
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, ms: Date.now() - t0, headers: res.headers };
  } catch (e) {
    return { status: 0, json: null, text: String(e), ms: Date.now() - t0, headers: new Headers() };
  }
}

function check(name, ok, detail = "", ms = 0) {
  if (!ok) failed++;
  const slow = ok && ms > SLOW_MS;
  if (slow) warned++;
  console.log(`${ok ? (slow ? "SLOW" : "PASS") : "FAIL"} ${name}${!ok && detail ? `  [${detail}]` : ""}${slow ? `  [${ms} ms]` : ""}`);
}

async function backend() {
  console.log(`\nBackend  ${BACKEND}`);
  const health = await req("GET", `${BACKEND}/health`);
  check("GET /health is ok", health.status === 200 && health.json?.status === "ok", `status ${health.status}`, health.ms);

  const ready = await req("GET", `${BACKEND}/ready`);
  check("GET /ready reports the database up", ready.status === 200 && ready.json?.checks?.database === "ok", `status ${ready.status} ${JSON.stringify(ready.json?.checks)}`, ready.ms);
  if (ready.json?.checks) {
    for (const [name, state] of Object.entries(ready.json.checks)) {
      if (state !== "ok") { warned++; console.log(`WARN dependency "${name}" is ${state}`); }
    }
  }

  // Protected routes must refuse an anonymous caller. A 200 here would be a
  // data-exposure bug; a 5xx means the route is broken.
  for (const path of [
    "/api/v1/patient/early-warning",
    "/api/v1/patient/anomaly-timeline",
    "/api/v1/triage-cases",
    "/api/v1/visits",
    "/api/v1/admin/users",
    "/api/v1/doctor/monitoring",
    "/api/v1/access-grants/my-record",
  ]) {
    const r = await req("GET", BACKEND + path);
    check(`anonymous GET ${path} is refused (401)`, r.status === 401, `status ${r.status}`, r.ms);
  }

  // A malformed sign-up must be rejected by validation, creating nothing.
  const bad = await req("POST", `${BACKEND}/api/v1/auth/register`, { body: { email: "not-an-email" } });
  check("POST /auth/register rejects invalid input (400)", bad.status === 400, `status ${bad.status}`, bad.ms);

  const missing = await req("GET", `${BACKEND}/api/v1/no-such-route-${Date.now()}`);
  check("unknown route is a clean 404", missing.status === 404, `status ${missing.status}`, missing.ms);
}

async function frontend() {
  console.log(`\nFrontend ${FRONTEND}`);
  const home = await req("GET", FRONTEND + "/");
  check("GET / serves the app", home.status === 200 || home.status === 307 || home.status === 308, `status ${home.status}`, home.ms);

  // Browser -> Next proxy -> backend: a 401 from the backend proves the whole chain.
  const proxied = await req("GET", `${FRONTEND}/api/patient/early-warning`);
  check("proxy reaches the backend (anonymous call answered 401)", proxied.status === 401, `status ${proxied.status}`, proxied.ms);

  const traversal = await req("GET", `${FRONTEND}/api/..%2Fadmin`);
  check("proxy refuses a smuggled path (not 200)", traversal.status !== 200, `status ${traversal.status}`, traversal.ms);
}

async function mlService() {
  console.log(`\nML       ${ML}`);
  const health = await req("GET", ML + "/");
  check("GET / is ok", health.status === 200 && health.json?.status === "ok", `status ${health.status}`, health.ms);

  const anon = await req("GET", `${ML}/readiness-score/smoke-test-nobody`);
  check("anonymous call is refused (401)", anon.status === 401, `status ${anon.status}`, anon.ms);

  const wrong = await req("GET", `${ML}/readiness-score/smoke-test-nobody`, { headers: { "x-ahava-service-key": "wrong-key" } });
  check("wrong service key is refused (401)", wrong.status === 401, `status ${wrong.status}`, wrong.ms);

  if (ML_SECRET) {
    // Read-only: an unknown id returns a default score and stores nothing.
    const ok = await req("GET", `${ML}/readiness-score/smoke-test-nobody`, { headers: { "x-ahava-service-key": ML_SECRET } });
    check("correct service key is accepted", ok.status === 200 && typeof ok.json?.score === "number", `status ${ok.status}`, ok.ms);

    // Rejected by validation before anything is stored.
    const invalid = await req("POST", `${ML}/ingest/bp?user_id=smoke-test-nobody`, {
      headers: { "x-ahava-service-key": ML_SECRET },
      body: { timestamp: new Date().toISOString(), systolic: 100, diastolic: 125 },
    });
    check("transposed BP is rejected (422)", invalid.status === 422, `status ${invalid.status}`, invalid.ms);
  }
}

(async () => {
  await backend();
  if (FRONTEND) await frontend(); else console.log("\nFrontend skipped (FRONTEND_URL not set)");
  if (ML) await mlService(); else console.log("\nML skipped (ML_URL not set)");
  console.log(`\n${failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`}${warned ? `, ${warned} warning(s)` : ""}`);
  process.exit(failed === 0 ? 0 : 1);
})();
