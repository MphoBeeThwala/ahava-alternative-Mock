const BASE_URL = process.env.BASE_URL || 'https://app.ahavaon88.co.za';
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
const WAVES = (process.env.WAVES || '5,10,20,30,40,60,80').split(',').map(s=>parseInt(s.trim(),10)).filter(Boolean);
const ITERATIONS = parseInt(process.env.ITERATIONS || '3', 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '15000', 10);

if (!EMAIL || !PASSWORD) {
  console.error('Missing TEST_EMAIL/TEST_PASSWORD');
  process.exit(1);
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b)=>a-b);
  const i = Math.max(0, Math.ceil((p/100)*s.length)-1);
  return s[i];
}

async function req(path, options={}) {
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${path}`, { ...options, signal: controller.signal });
    const ms = Date.now() - start;
    let body = null;
    try { body = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, ms, body };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now()-start, error: e?.message || String(e) };
  } finally {
    clearTimeout(t);
  }
}

async function oneIteration() {
  const t = { login: 0, me: 0, bookings: 0, monitor: 0 };
  let r;

  r = await req('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  t.login = r.ms;
  if (!r.ok) return { ok:false, step:'login', status:r.status, t, detail:r.body || r.error };

  const token = r.body?.accessToken || r.body?.access_token;
  if (!token) return { ok:false, step:'login-token', status:200, t, detail:'missing token' };
  const h = { Authorization: `Bearer ${String(token).trim()}` };

  r = await req(`/api/auth/me?t=${Date.now()}`, { headers: h });
  t.me = r.ms;
  if (!r.ok) return { ok:false, step:'me', status:r.status, t, detail:r.body || r.error };

  r = await req('/api/bookings?limit=10&offset=0', { headers: h });
  t.bookings = r.ms;
  if (!(r.ok || r.status === 304)) return { ok:false, step:'bookings', status:r.status, t, detail:r.body || r.error };

  r = await req('/api/patient/monitoring/summary', { headers: h });
  t.monitor = r.ms;
  if (!(r.ok || r.status === 304)) return { ok:false, step:'monitor', status:r.status, t, detail:r.body || r.error };

  return { ok:true, t };
}

async function worker(iterations) {
  const out = [];
  for (let i=0;i<iterations;i++) out.push(await oneIteration());
  return out;
}

async function runWave(concurrency) {
  const start = Date.now();
  const jobs = Array.from({ length: concurrency }, () => worker(ITERATIONS));
  const nested = await Promise.all(jobs);
  const results = nested.flat();
  const durationMs = Date.now() - start;

  const ok = results.filter(r=>r.ok).length;
  const fail = results.length - ok;
  const failRate = results.length ? (fail/results.length)*100 : 0;

  const loginMs = results.map(r=>r.t.login);
  const meMs = results.map(r=>r.t.me);
  const bookingsMs = results.map(r=>r.t.bookings);
  const monitorMs = results.map(r=>r.t.monitor);

  const failuresByStep = {};
  const failuresByStatus = {};
  const failureSamples = [];
  for (const r of results.filter(x=>!x.ok)) failuresByStep[r.step] = (failuresByStep[r.step]||0)+1;
  for (const r of results.filter(x=>!x.ok)) {
    const key = String(r.status || 0);
    failuresByStatus[key] = (failuresByStatus[key] || 0) + 1;
    if (failureSamples.length < 5) {
      failureSamples.push({
        step: r.step,
        status: r.status,
        detail: r.detail
      });
    }
  }

  return {
    concurrency,
    iterationsPerUser: ITERATIONS,
    totalTransactions: results.length,
    ok,
    fail,
    failRate: Number(failRate.toFixed(2)),
    durationMs,
    tps: Number((results.length/(durationMs/1000)).toFixed(2)),
    p95: {
      login: pct(loginMs,95),
      me: pct(meMs,95),
      bookings: pct(bookingsMs,95),
      monitor: pct(monitorMs,95)
    },
    failuresByStep,
    failuresByStatus,
    failureSamples
  };
}

(async () => {
  console.log(`Running concurrency probe on ${BASE_URL}`);
  console.log(`User: ${EMAIL}, waves: ${WAVES.join(', ')}, iterations/user: ${ITERATIONS}`);

  const report = [];
  for (const c of WAVES) {
    const w = await runWave(c);
    report.push(w);
    console.log(`Wave ${c}: failRate=${w.failRate}% p95(login/me/bookings/monitor)=${w.p95.login}/${w.p95.me}/${w.p95.bookings}/${w.p95.monitor}ms tps=${w.tps}`);
    if (w.failRate > 20) {
      console.log('Stopping early due to high failure rate.');
      break;
    }
  }

  console.log('\nJSON_REPORT_START');
  console.log(JSON.stringify(report, null, 2));
  console.log('JSON_REPORT_END');
})();
