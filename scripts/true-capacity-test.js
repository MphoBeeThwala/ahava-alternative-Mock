const BASE_URL = process.env.BASE_URL || "https://app.ahavaon88.co.za";
const PASSWORD = process.env.TEST_PASSWORD || "LoadTest1!";
const WAVES = (process.env.WAVES || "10,25,50,100,150,200")
  .split(",")
  .map((x) => parseInt(x.trim(), 10))
  .filter(Boolean);
const TARGET_P95_MS = parseInt(process.env.TARGET_P95_MS || "1200", 10);
const TX_PER_USER = parseInt(process.env.TX_PER_USER || "1", 10);
const USER_PREFIX = process.env.USER_PREFIX || `cap_${Date.now()}`;
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || "20000", 10);
const LOGIN_EACH_FLOW =
  String(process.env.LOGIN_EACH_FLOW || "true").toLowerCase() === "true";

function xffFor(i) {
  return `10.${Math.floor(i / 65536) % 255}.${Math.floor(i / 256) % 255}.${i % 255 || 1}`;
}
function emailFor(i) {
  return `${USER_PREFIX}_${String(i).padStart(4, "0")}@ahava.test`;
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.max(0, Math.ceil((p / 100) * s.length) - 1);
  return s[i];
}

async function req(path, opts = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...opts,
      signal: c.signal,
    });
    const ms = Date.now() - start;
    let body = null;
    try {
      body = await res.json();
    } catch {}
    return { ok: res.ok, status: res.status, ms, body };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - start,
      error: e?.message || String(e),
    };
  } finally {
    clearTimeout(t);
  }
}

async function ensureUser(i) {
  const email = emailFor(i);
  const xff = xffFor(i);
  const reg = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": xff },
    body: JSON.stringify({
      firstName: "Cap",
      lastName: `User${i}`,
      email,
      password: PASSWORD,
      role: "PATIENT",
    }),
  });

  // If registration succeeded, reuse the token it already returned.
  // This avoids logging in immediately after registering (same second →
  // identical JWT iat → duplicate refresh-token hash in DB).
  if (reg.ok) {
    const token = reg.body?.accessToken || reg.body?.access_token;
    if (token) return { ok: true, email, token: String(token).trim(), xff };
  }

  // User already existed (400) or token missing — fall through to login.
  // Add a small delay so the iat second ticks over before we create a new token.
  if (reg.status === 400) await new Promise((r) => setTimeout(r, 1100));

  if (!reg.ok && reg.status !== 400) {
    return {
      ok: false,
      email,
      reason: "register_failed",
      detail: reg.body || reg.error || reg.status,
    };
  }

  const login = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": xff },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!login.ok) {
    return {
      ok: false,
      email,
      reason: "login_failed",
      detail: login.body || login.error || login.status,
    };
  }
  const token = login.body?.accessToken || login.body?.access_token;
  if (!token)
    return { ok: false, email, reason: "missing_token", detail: login.body };

  return { ok: true, email, token: String(token).trim(), xff };
}

async function runFlow(user, iterationIndex) {
  const t = { login: 0, me: 0, bookings: 0, monitor: 0, biometrics: 0 };
  let token = String(user.token || "").trim();
  if (LOGIN_EACH_FLOW) {
    const login = await req("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": user.xff,
      },
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    });
    t.login = login.ms;
    if (!login.ok) {
      return {
        ok: false,
        step: "login",
        status: login.status,
        t,
        detail: login.body || login.error,
      };
    }
    token = String(
      login.body?.accessToken || login.body?.access_token || "",
    ).trim();
    if (!token) {
      return {
        ok: false,
        step: "login-token",
        status: 200,
        t,
        detail: "missing token",
      };
    }
  }
  const relogin = async () => {
    const login = await req("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": user.xff,
      },
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    });
    t.login = Math.max(t.login, login.ms);
    if (!login.ok) return null;
    const refreshed = String(
      login.body?.accessToken || login.body?.access_token || "",
    ).trim();
    return refreshed || null;
  };

  const h = { Authorization: `Bearer ${token}`, "X-Forwarded-For": user.xff };

  let me = await req(`/api/auth/me?t=${Date.now()}_${iterationIndex}`, {
    headers: h,
  });
  if (!LOGIN_EACH_FLOW && me.status === 401) {
    const refreshed = await relogin();
    if (refreshed) {
      token = refreshed;
      user.token = refreshed;
      const h2 = {
        Authorization: `Bearer ${token}`,
        "X-Forwarded-For": user.xff,
      };
      me = await req(`/api/auth/me?t=${Date.now()}_${iterationIndex}_retry`, {
        headers: h2,
      });
    }
  }
  t.me = me.ms;
  if (!(me.ok || me.status === 304))
    return {
      ok: false,
      step: "me",
      status: me.status,
      t,
      detail: me.body || me.error,
    };

  const activeHeaders = {
    Authorization: `Bearer ${token}`,
    "X-Forwarded-For": user.xff,
  };

  const bookings = await req("/api/bookings?limit=10&offset=0", {
    headers: activeHeaders,
  });
  t.bookings = bookings.ms;
  if (!(bookings.ok || bookings.status === 304))
    return {
      ok: false,
      step: "bookings",
      status: bookings.status,
      t,
      detail: bookings.body || bookings.error,
    };

  const monitor = await req("/api/patient/monitoring/summary", {
    headers: activeHeaders,
  });
  t.monitor = monitor.ms;
  if (!(monitor.ok || monitor.status === 304))
    return {
      ok: false,
      step: "monitor",
      status: monitor.status,
      t,
      detail: monitor.body || monitor.error,
    };

  const biometrics = await req("/api/patient/biometrics", {
    method: "POST",
    headers: { ...activeHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "wearable",
      deviceType: "capacity_probe",
      heartRate: 72 + (iterationIndex % 5),
      heartRateResting: 66,
      oxygenSaturation: 98,
      respiratoryRate: 16,
      stepCount: 1000 + iterationIndex,
      activeCalories: 120,
    }),
  });
  t.biometrics = biometrics.ms;
  if (!biometrics.ok)
    return {
      ok: false,
      step: "biometrics",
      status: biometrics.status,
      t,
      detail: biometrics.body || biometrics.error,
    };

  return { ok: true, t };
}

async function runWave(concurrency, users) {
  const flows = [];
  const started = Date.now();
  for (let i = 0; i < concurrency; i++) {
    const user = users[i];
    for (let k = 0; k < TX_PER_USER; k++) {
      flows.push(runFlow(user, k + 1));
    }
  }
  const results = await Promise.all(flows);
  const durationMs = Date.now() - started;

  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  const failRate = results.length ? (fail / results.length) * 100 : 0;

  const metrics = {
    login: results.map((r) => r.t.login),
    me: results.map((r) => r.t.me),
    bookings: results.map((r) => r.t.bookings),
    monitor: results.map((r) => r.t.monitor),
    biometrics: results.map((r) => r.t.biometrics),
  };

  const failuresByStep = {};
  const failuresByStatus = {};
  const sample = [];
  for (const r of results.filter((x) => !x.ok)) {
    failuresByStep[r.step] = (failuresByStep[r.step] || 0) + 1;
    const s = String(r.status || 0);
    failuresByStatus[s] = (failuresByStatus[s] || 0) + 1;
    if (sample.length < 5)
      sample.push({ step: r.step, status: r.status, detail: r.detail });
  }

  return {
    concurrency,
    flows: results.length,
    ok,
    fail,
    failRate: Number(failRate.toFixed(2)),
    durationMs,
    tps: Number((results.length / (durationMs / 1000)).toFixed(2)),
    p95: {
      login: pct(metrics.login, 95),
      me: pct(metrics.me, 95),
      bookings: pct(metrics.bookings, 95),
      monitor: pct(metrics.monitor, 95),
      biometrics: pct(metrics.biometrics, 95),
    },
    failuresByStep,
    failuresByStatus,
    sample,
  };
}

(async () => {
  const maxWave = Math.max(...WAVES);
  console.log(`Preparing ${maxWave} users on ${BASE_URL} ...`);
  console.log(`Mode: ${LOGIN_EACH_FLOW ? "login-per-flow" : "token-reuse"}`);
  const users = [];
  for (let i = 1; i <= maxWave; i++) {
    const u = await ensureUser(i);
    if (!u.ok) {
      console.error(
        "USER_PREP_FAILED",
        i,
        u.email,
        u.reason,
        JSON.stringify(u.detail),
      );
      process.exit(1);
    }
    users.push(u);
    if (i % 25 === 0 || i === maxWave) console.log(`Prepared ${i}/${maxWave}`);
  }

  const report = [];
  for (const c of WAVES) {
    const wave = await runWave(c, users);
    report.push(wave);
    console.log(
      `Wave ${c}: fail=${wave.failRate}% p95(login/me/bookings/monitor/biometrics)=${wave.p95.login}/${wave.p95.me}/${wave.p95.bookings}/${wave.p95.monitor}/${wave.p95.biometrics}ms tps=${wave.tps}`,
    );
  }

  const safe =
    report
      .filter(
        (w) =>
          w.failRate < 1 &&
          w.p95.login < TARGET_P95_MS &&
          w.p95.me < TARGET_P95_MS &&
          w.p95.bookings < TARGET_P95_MS &&
          w.p95.monitor < TARGET_P95_MS &&
          w.p95.biometrics < TARGET_P95_MS,
      )
      .pop() || null;

  console.log("\nSAFE_WAVE");
  console.log(JSON.stringify(safe, null, 2));

  console.log("\nJSON_REPORT_START");
  console.log(JSON.stringify(report, null, 2));
  console.log("JSON_REPORT_END");
})();
