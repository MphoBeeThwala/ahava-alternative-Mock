/**
 * Load test: patient pipeline (login, submit biometrics, get alerts, get history).
 * Run after seeding mock patients (seed:mock-patients).
 *
 * Usage:
 *   node scripts/load-test-patient-pipeline.js
 *   BASE_URL=http://localhost:4000 MOCK_PATIENT_PASSWORD=MockPatient1! COUNT=100 CONCURRENCY=10 node scripts/load-test-patient-pipeline.js
 *
 * Env:
 *   BASE_URL                 Backend base URL (default http://localhost:4000)
 *   MOCK_PATIENT_PASSWORD    Same as used in seed (default MockPatient1!)
 *   COUNT                    Number of users to simulate (default 1000)
 *   CONCURRENCY              Parallel requests per wave (default 20)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const PASSWORD = process.env.MOCK_PATIENT_PASSWORD || 'MockPatient1!';
const COUNT = Math.min(parseInt(process.env.COUNT || '1000', 10) || 1000, 10000);
const CONCURRENCY = Math.min(Math.max(1, parseInt(process.env.CONCURRENCY || '20', 10)), 100);

function pad(n) {
  return String(n).padStart(4, '0');
}

async function login(email) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || res.statusText };
  let token = data.accessToken || data.access_token;
  if (!token) return { ok: false, error: 'No token in response' };
  token = String(token).trim();
  return { ok: true, token };
}

async function submitBiometrics(token) {
  const authHeader = 'Bearer ' + String(token).trim();
  const res = await fetch(`${BASE_URL}/api/patient/biometrics`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify({
      heartRate: 72,
      heartRateResting: 70,
      hrvRmssd: 52,
      oxygenSaturation: 98,
      respiratoryRate: 16,
      stepCount: 4500,
      activeCalories: 180,
      source: 'wearable',
      deviceType: 'load_test',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || res.statusText };
  return { ok: true };
}

async function getAlerts(token) {
  const res = await fetch(`${BASE_URL}/api/patient/alerts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || res.statusText };
  return { ok: true };
}

async function getHistory(token) {
  const res = await fetch(`${BASE_URL}/api/patient/biometrics/history?limit=10&offset=0`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || res.statusText };
  return { ok: true };
}

async function runOneUser(index) {
  const email = `patient_${pad(index)}@mock.ahava.test`;
  const timings = { login: 0, biometrics: 0, alerts: 0, history: 0 };
  let t0 = Date.now();
  const loginResult = await login(email);
  timings.login = Date.now() - t0;
  if (!loginResult.ok) return { ok: false, email, error: loginResult.error, timings };

  const token = loginResult.token;

  t0 = Date.now();
  const bioResult = await submitBiometrics(token);
  timings.biometrics = Date.now() - t0;
  if (!bioResult.ok) return { ok: false, email, error: `biometrics: ${bioResult.error}`, timings };

  t0 = Date.now();
  const alertsResult = await getAlerts(token);
  timings.alerts = Date.now() - t0;
  if (!alertsResult.ok) return { ok: false, email, error: `alerts: ${alertsResult.error}`, timings };

  t0 = Date.now();
  const historyResult = await getHistory(token);
  timings.history = Date.now() - t0;
  if (!historyResult.ok) return { ok: false, email, error: `history: ${historyResult.error}`, timings };

  return { ok: true, email, timings };
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const i = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, i)];
}

async function run() {
  console.log(`Load test: ${COUNT} users, concurrency ${CONCURRENCY}, base ${BASE_URL}\n`);

  const results = [];
  const timings = { login: [], biometrics: [], alerts: [], history: [] };

  for (let i = 0; i < COUNT; i += CONCURRENCY) {
    const batch = Math.min(CONCURRENCY, COUNT - i);
    const promises = [];
    for (let j = 0; j < batch; j++) {
      promises.push(runOneUser(i + j + 1));
    }
    const batchResults = await Promise.all(promises);
    for (const r of batchResults) {
      results.push(r);
      if (r.ok && r.timings) {
        timings.login.push(r.timings.login);
        timings.biometrics.push(r.timings.biometrics);
        timings.alerts.push(r.timings.alerts);
        timings.history.push(r.timings.history);
      }
    }
    if ((i + batch) % 100 === 0 || i + batch === COUNT) {
      const ok = results.filter((r) => r.ok).length;
      console.log(`  Progress: ${i + batch}/${COUNT} (${ok} ok)`);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  console.log('\n--- Summary ---');
  console.log(`Success: ${okCount}/${results.length} (${((okCount / results.length) * 100).toFixed(1)}%)`);
  if (failCount > 0) {
    console.log(`Failures: ${failCount}`);
    const sample = results.filter((r) => !r.ok).slice(0, 5);
    sample.forEach((r) => console.log(`  ${r.email}: ${r.error}`));
  }

  if (timings.login.length > 0) {
    console.log('\nLatency (ms) - P50 / P95:');
    console.log(`  login:     ${percentile(timings.login, 50)} / ${percentile(timings.login, 95)}`);
    console.log(`  biometrics: ${percentile(timings.biometrics, 50)} / ${percentile(timings.biometrics, 95)}`);
    console.log(`  alerts:    ${percentile(timings.alerts, 50)} / ${percentile(timings.alerts, 95)}`);
    console.log(`  history:   ${percentile(timings.history, 50)} / ${percentile(timings.history, 95)}`);
  }

  process.exit(failCount > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
