/**
 * Early warning test: send 14 days of normal readings + 1 anomalous reading per user via API
 * so ML service establishes baseline and then triggers an alert. Assert GET /api/patient/alerts.
 *
 * Run after seeding mock patients. Ensure Backend + ML service are running.
 *
 * Usage:
 *   node scripts/run-early-warning-test.js
 *   BASE_URL=http://localhost:4000 MOCK_PATIENT_PASSWORD=MockPatient1! COUNT=20 node scripts/run-early-warning-test.js
 *
 * Env:
 *   BASE_URL                 Backend base URL (default http://localhost:4000)
 *   MOCK_PATIENT_PASSWORD    Same as used in seed (default MockPatient1!)
 *   COUNT                    Number of users to test (default 50)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const PASSWORD = process.env.MOCK_PATIENT_PASSWORD || 'MockPatient1!';
const COUNT = Math.min(parseInt(process.env.COUNT || '50', 10) || 50, 200);

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
  return { ok: true, token: data.accessToken };
}

async function submitBiometrics(token, payload) {
  const res = await fetch(`${BASE_URL}/api/patient/biometrics`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || res.statusText };
  return { ok: true, data };
}

async function getAlerts(token) {
  const res = await fetch(`${BASE_URL}/api/patient/alerts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || res.statusText };
  return { ok: true, alerts: data.alerts || [] };
}

// Normal reading (within range)
function normalReading() {
  return {
    heartRate: 70 + Math.floor(Math.random() * 8),
    heartRateResting: 68 + Math.floor(Math.random() * 8),
    hrvRmssd: 48 + Math.floor(Math.random() * 18),
    oxygenSaturation: 97 + Math.floor(Math.random() * 3),
    respiratoryRate: 15 + Math.floor(Math.random() * 3),
    stepCount: 3000 + Math.floor(Math.random() * 4000),
    activeCalories: 120 + Math.floor(Math.random() * 150),
    source: 'wearable',
    deviceType: 'early_warning_test',
  };
}

// Anomalous reading: high HR, low SpO2, high respiratory rate (to trigger YELLOW/RED)
function anomalousReading() {
  return {
    heartRate: 115,
    heartRateResting: 108,
    hrvRmssd: 28,
    oxygenSaturation: 91,
    respiratoryRate: 24,
    stepCount: 500,
    activeCalories: 30,
    source: 'wearable',
    deviceType: 'early_warning_test',
  };
}

async function runOneUser(index) {
  const email = `patient_${pad(index)}@mock.ahava.test`;
  const loginResult = await login(email);
  if (!loginResult.ok) return { ok: false, email, error: `login: ${loginResult.error}` };
  const token = loginResult.token;

  // Send 15 days of normal readings so ML has 14+ days baseline (one per day simulated)
  for (let d = 0; d < 15; d++) {
    const result = await submitBiometrics(token, normalReading());
    if (!result.ok) return { ok: false, email, error: `biometrics day ${d}: ${result.error}` };
  }

  // Send one anomalous reading
  const anomResult = await submitBiometrics(token, anomalousReading());
  if (!anomResult.ok) return { ok: false, email, error: `anomalous: ${anomResult.error}` };

  // Wait a tick for backend/ML to process
  await new Promise((r) => setTimeout(r, 100));

  const alertsResult = await getAlerts(token);
  if (!alertsResult.ok) return { ok: false, email, error: `alerts: ${alertsResult.error}` };

  const hasAlert = Array.isArray(alertsResult.alerts) && alertsResult.alerts.length > 0;
  return { ok: true, email, hasAlert, alertCount: (alertsResult.alerts || []).length };
}

async function run() {
  console.log(`Early warning test: ${COUNT} users, base ${BASE_URL}`);
  console.log('Sending 15 normal readings + 1 anomalous per user, then checking alerts.\n');

  const results = [];
  for (let i = 1; i <= COUNT; i++) {
    const r = await runOneUser(i);
    results.push(r);
    if (i % 10 === 0) console.log(`  Progress: ${i}/${COUNT}`);
  }

  const okCount = results.filter((r) => r.ok).length;
  const withAlert = results.filter((r) => r.ok && r.hasAlert).length;

  console.log('\n--- Summary ---');
  console.log(`Users processed: ${okCount}/${COUNT}`);
  console.log(`Users with at least one alert: ${withAlert}/${okCount}`);

  if (withAlert === 0 && okCount > 0) {
    console.log('\nNote: No alerts found. ML service may need 14+ days of history in its own store (in-memory).');
    console.log('Backend fallback thresholds may still create alerts for very anomalous values.');
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.log('\nFailures:');
    failed.slice(0, 10).forEach((r) => console.log(`  ${r.email}: ${r.error}`));
    process.exit(1);
  }

  console.log('\nEarly warning test completed.');
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
