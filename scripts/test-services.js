#!/usr/bin/env node
/**
 * Smoke test: backend health, auth, and key services.
 * Run with: node scripts/test-services.js
 * Requires backend at http://localhost:4000 (pnpm dev:api).
 */

const BASE = process.env.BACKEND_URL || 'http://localhost:4000';
const API = `${BASE}/api`;

async function request(method, path, body = null, token = null) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function main() {
  const results = [];
  function ok(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(pass ? `  \u2713 ${name}` : `  \u2717 ${name}${detail ? ': ' + detail : ''}`);
  }

  console.log('\n--- Backend & services smoke test ---\n');

  // 1. Health
  try {
    const health = await request('GET', `${BASE}/health`);
    ok('Health', health.status === 200, health.status === 200 ? '' : String(health.data));
  } catch (e) {
    ok('Health', false, e.message);
  }

  // 2. Register (idempotent: may fail if user exists)
  let token = null;
  const testUser = {
    email: `test-services-${Date.now()}@test.ahava.local`,
    password: 'Test1234!',
    firstName: 'Test',
    lastName: 'Service',
    role: 'PATIENT',
    phone: '+27000000000',
  };
  try {
    const reg = await request('POST', '/auth/register', testUser);
    if (reg.status === 201 || reg.status === 200) {
      token = reg.data?.accessToken || reg.data?.token;
      ok('Register', !!token);
    } else {
      ok('Register', false, reg.data?.error || String(reg.data));
    }
  } catch (e) {
    ok('Register', false, e.message);
  }

  // If no token from register, try login with a known user (optional)
  if (!token) {
    try {
      const login = await request('POST', '/auth/login', {
        email: testUser.email,
        password: testUser.password,
      });
      if (login.status === 200) {
        token = login.data?.accessToken || login.data?.token;
        ok('Login (fallback)', !!token);
      }
    } catch (_) {}
  }

  if (!token) {
    console.log('\n  Skipping authenticated tests (no token). Register or login first.\n');
    process.exit(results.some((r) => !r.pass) ? 1 : 0);
  }

  // 3. Patient: monitoring summary
  try {
    const summary = await request('GET', '/patient/monitoring/summary', null, token);
    ok('Patient monitoring summary', summary.status === 200 || summary.status === 404, summary.status === 200 ? '' : `status ${summary.status}`);
  } catch (e) {
    ok('Patient monitoring summary', false, e.message);
  }

  // 4. Patient: submit biometrics
  try {
    const bio = await request(
      'POST',
      '/patient/biometrics',
      {
        heartRate: 72,
        bloodPressure: { systolic: 120, diastolic: 80 },
        oxygenSaturation: 98,
        source: 'manual',
      },
      token
    );
    ok('Patient submit biometrics', bio.status === 200 || bio.status === 201, bio.status >= 200 && bio.status < 300 ? '' : JSON.stringify(bio.data));
  } catch (e) {
    ok('Patient submit biometrics', false, e.message);
  }

  // 5. Patient: biometric history
  try {
    const history = await request('GET', '/patient/biometrics/history?limit=5', null, token);
    ok('Patient biometric history', history.status === 200, history.status === 200 ? '' : `status ${history.status}`);
  } catch (e) {
    ok('Patient biometric history', false, e.message);
  }

  // 6. Patient: early-warning (may 503 if no ML)
  try {
    const ew = await request('GET', '/patient/early-warning', null, token);
    ok('Patient early-warning', ew.status === 200 || ew.status === 404 || ew.status === 503, ew.status === 200 ? '' : `status ${ew.status}`);
  } catch (e) {
    ok('Patient early-warning', false, e.message);
  }

  // 7. Bookings list
  try {
    const bookings = await request('GET', '/bookings', null, token);
    ok('Bookings list', bookings.status === 200, bookings.status === 200 ? '' : `status ${bookings.status}`);
  } catch (e) {
    ok('Bookings list', false, e.message);
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n--- Done ---');
  console.log(failed.length === 0 ? 'All checks passed.\n' : `${failed.length} check(s) failed.\n`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
