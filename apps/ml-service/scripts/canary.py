#!/usr/bin/env python3
"""
Synthetic canary and load test for a running ML service (local, staging or production).

Standard library only. Uses throwaway user ids prefixed `canary-`, so it never
touches a real patient's history. Every check prints PASS/FAIL; the exit code is
non-zero if any check fails.

  python scripts/canary.py --url http://localhost:8000 --secret-env ML_SERVICE_SHARED_SECRET
  python scripts/canary.py --url https://<ml-host> --secret-env ML_SERVICE_SHARED_SECRET --writes --load 200 --concurrency 10

The shared secret is read from an environment variable, never from the command line.
Without --writes only read-only checks run (health, auth, validation rejects).
Cleanup of the rows a --writes run leaves behind:
  DELETE FROM biometric_time_series WHERE user_id LIKE 'canary-%';
  DELETE FROM measured_vitals_time_series WHERE user_id LIKE 'canary-%';
"""
import argparse
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

HDR = "x-ahava-service-key"
results = []


def call(base, method, path, secret, body=None, key=True, timeout=30):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if key and secret:
        req.add_header(HDR, secret)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"null"), time.perf_counter() - t0
    except urllib.error.HTTPError as e:
        try:
            data = json.loads(e.read())
        except Exception:
            data = None
        return e.code, data, time.perf_counter() - t0
    except Exception as e:  # network error or timeout
        return 0, str(e), time.perf_counter() - t0


def check(name, ok, detail=""):
    ok = bool(ok)
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--secret-env", default="ML_SERVICE_SHARED_SECRET")
    ap.add_argument("--writes", action="store_true", help="also run checks that write canary rows")
    ap.add_argument("--load", type=int, default=0, help="number of requests for the load phase (needs --writes)")
    ap.add_argument("--concurrency", type=int, default=8)
    a = ap.parse_args()
    base = a.url.rstrip("/")
    secret = os.environ.get(a.secret_env, "")
    if not secret:
        print(f"note: ${a.secret_env} is empty; authenticated checks will fail if the service requires a key")
    now = datetime.now(timezone.utc)
    ok_body = {"timestamp": iso(now), "systolic": 120, "diastolic": 80}

    # ---- read-only
    s, _, _ = call(base, "GET", "/", secret, key=False)
    check("health endpoint answers without a key", s == 200, f"HTTP {s}")
    s, _, _ = call(base, "POST", "/ingest/bp?user_id=canary-auth", secret, ok_body, key=False)
    check("request without the service key is refused (401/503)", s in (401, 503), f"HTTP {s}")
    s, _, _ = call(base, "POST", "/ingest/bp?user_id=canary-auth", "wrong-secret-value", ok_body)
    check("request with a wrong key is refused", s in (401, 503), f"HTTP {s}")
    bad = [
        ("transposed BP (100/125) is rejected", {"timestamp": iso(now), "systolic": 100, "diastolic": 125}),
        ("impossible BP (400/80) is rejected", {"timestamp": iso(now), "systolic": 400, "diastolic": 80}),
        ("future timestamp (+3 days) is rejected", {"timestamp": iso(now + timedelta(days=3)), "systolic": 120, "diastolic": 80}),
        ("missing field is rejected", {"timestamp": iso(now), "systolic": 120}),
    ]
    for name, body in bad:
        s, _, _ = call(base, "POST", "/ingest/bp?user_id=canary-validate", secret, body)
        check(name, s == 422, f"HTTP {s}")

    if not a.writes:
        print("\nread-only run complete (add --writes for functional and load checks)")
        return 0 if all(results) else 1

    # ---- functional, writes canary rows
    uid = f"canary-{int(time.time())}"
    t = now - timedelta(hours=1)
    s, d, _ = call(base, "POST", f"/ingest/bp?user_id={uid}", secret, {"timestamp": iso(t), "systolic": 118, "diastolic": 76})
    check("normal BP is GREEN", s == 200 and d and d.get("alert_level") == "GREEN", f"HTTP {s} {d}")
    crisis = {"timestamp": iso(t + timedelta(minutes=5)), "systolic": 201, "diastolic": 122}
    s, d, _ = call(base, "POST", f"/ingest/bp?user_id={uid}", secret, crisis)
    check("hypertensive-crisis BP is RED", s == 200 and d and d.get("alert_level") == "RED"
          and d["anomalies"][0].startswith("bp_crisis_range"), f"HTTP {s} {d}")
    s, d2, _ = call(base, "POST", f"/ingest/bp?user_id={uid}", secret, crisis)
    check("a retried identical reading gives the same answer", s == 200 and d2 and d2.get("alert_level") == "RED", f"HTTP {s}")
    w = {"timestamp": iso(t + timedelta(minutes=10)), "heart_rate_resting": 70, "hrv_rmssd": 45, "spo2": 97,
         "skin_temp_offset": 0, "respiratory_rate": 15, "step_count": 3000, "active_calories": 0,
         "sleep_duration_hours": 7, "spo2_night_min": 93, "night_odi_per_hr": 2}
    s, d, _ = call(base, "POST", f"/ingest?user_id={uid}", secret, w)
    check("wearable reading is accepted and still sees the recent crisis (RED within 6h)",
          s == 200 and d and d.get("alert_level") == "RED", f"HTTP {s} {d}")
    s, d, _ = call(base, "GET", f"/readiness-score/{uid}", secret)
    check("readiness score never reads high during RED (<= 40)", s == 200 and d and d.get("score", 100) <= 40, f"HTTP {s} {d}")
    ctx = {"context": {"age": 45, "sex": "male", "smoker": False, "bmi": 30, "systolic_bp": 150}}
    s, d, _ = call(base, "POST", f"/early-warning/summary/{uid}", secret, ctx)
    check("summary reports RED", s == 200 and d and d.get("alert_level") == "RED", f"HTTP {s}")
    if s == 200 and d:
        u = d.get("uncertainty", {})
        check("summary carries uncertainty, provenance and a clinician-review flag",
              "score" in u and d.get("provenance", {}).get("decision_trace_id") and d.get("requires_clinician_review") is True, str(u))
        check("summary exposes the measured BP assessment", (d.get("bp_assessment") or {}).get("readings_7d", 0) >= 1)

    # ---- load
    if a.load:
        errs, lat, lock = [], [], threading.Lock()
        run_id = int(time.time())  # fresh users each run, so earlier runs cannot slow this one
        base_t = now - timedelta(days=1)

        def one(i):
            user = f"canary-load-{run_id}-{i % 20}"
            body = {"timestamp": iso(base_t + timedelta(seconds=i)), "systolic": 110 + (i % 25), "diastolic": 70 + (i % 12)}
            st, dd, dt = call(base, "POST", f"/ingest/bp?user_id={user}", secret, body)
            with lock:
                lat.append(dt)
                if st != 200:
                    errs.append((st, str(dd)[:80]))

        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=a.concurrency) as ex:
            list(ex.map(one, range(a.load)))
        wall = time.perf_counter() - t0
        lat.sort()

        def pct(q):
            return lat[min(len(lat) - 1, int(q * len(lat)))] * 1000

        print(f"\nload: {a.load} requests, {a.concurrency} concurrent, {wall:.1f}s wall, {a.load / wall:.1f} req/s")
        print(f"latency ms: p50={pct(0.5):.0f} p95={pct(0.95):.0f} p99={pct(0.99):.0f} max={lat[-1] * 1000:.0f}; errors={len(errs)}")
        check("load: no errors", not errs, str(errs[:3]))
        check("load: p95 latency under 2s", pct(0.95) < 2000, f"p95={pct(0.95):.0f}ms")
    print(f"\n{sum(results)}/{len(results)} checks passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
