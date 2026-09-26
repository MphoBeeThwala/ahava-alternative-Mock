"""
Error tracking must never ship patient data off-box.

Two layers are tested: scrub_event on its own, and the real sentry-sdk
pipeline end to end — a subprocess imports main.py with SENTRY_DSN pointed
at a local HTTP sink, forces a 500 on /early-warning/analyze with vitals in
the body, and the test inspects exactly what the SDK transmitted.
"""
import gzip
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from monitoring import scrub_event

SERVICE_DIR = Path(__file__).resolve().parent.parent


def _sensitive():
    # Built at runtime (reversed) so the literals never appear in source
    # context lines Sentry legitimately attaches to stack frames.
    r = lambda s: s[::-1]  # noqa: E731
    return {
        "name": r("eoDenaJ"),
        "token": r("NEKOTTERCES"),
        "cookie": r("LAVEIKOOC"),
        "hr": "187.25",
    }


def test_scrub_event_strips_request_user_extra_vars_and_breadcrumbs():
    s = _sensitive()
    event = {
        "request": {
            "url": f"http://ml/early-warning/analyze?user_id={s['name']}",
            "data": {"biometrics": {"heart_rate": 187}},
            "cookies": {"sid": s["cookie"]},
            "query_string": f"user_id={s['name']}",
            "headers": {"x-ahava-service-key": s["token"], "User-Agent": "ua"},
            "env": {"REMOTE_ADDR": "41.1.2.3"},
        },
        "user": {"id": "u1", "email": "x@y.z", "ip_address": "41.1.2.3"},
        "extra": {"body": s["name"]},
        "exception": {"values": [{"stacktrace": {"frames": [{"function": "f", "vars": {"hr": 187}}]}}]},
        "breadcrumbs": {"values": [{"category": "http", "level": "info", "message": s["name"], "data": {"x": 1}}]},
    }
    out = scrub_event(event)
    assert out["request"] == {"url": "http://ml/early-warning/analyze", "headers": {"User-Agent": "ua"}}
    assert out["user"] == {"id": "u1"}
    assert "extra" not in out
    assert out["exception"]["values"][0]["stacktrace"]["frames"][0] == {"function": "f"}
    blob = json.dumps(out)
    for needle in (s["name"], s["token"], s["cookie"], "41.1.2.3", "x@y.z"):
        assert needle not in blob


class _Sink(BaseHTTPRequestHandler):
    received: list = []

    def do_POST(self):  # noqa: N802
        body = self.rfile.read(int(self.headers.get("content-length", 0)))
        if self.headers.get("content-encoding") == "gzip":
            body = gzip.decompress(body)
        _Sink.received.append(body.decode("utf-8", "replace"))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *args):
        pass


CHILD = r"""
import os, json, socket, threading, time
import requests, uvicorn, sentry_sdk
import main

def boom(*a, **k):
    raise RuntimeError("scoring failed")
main.engine.full_analysis = boom

sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close()
server = uvicorn.Server(uvicorn.Config(main.app, host="127.0.0.1", port=port, log_level="critical"))
threading.Thread(target=server.run, daemon=True).start()
for _ in range(100):
    if server.started: break
    time.sleep(0.05)

s = json.loads(os.environ["SENSITIVE"])
r = requests.post(
    f"http://127.0.0.1:{port}/early-warning/analyze?user_id={s['name']}",
    headers={"x-ahava-service-key": s["token"], "cookie": "sid=" + s["cookie"]},
    json={"biometrics": {
        "timestamp": "2026-09-26T10:00:00Z", "heart_rate_resting": float(s["hr"]), "hrv_rmssd": 40,
        "spo2": 97, "skin_temp_offset": 0.1, "respiratory_rate": 16,
    }},
)
sentry_sdk.flush(5)
server.should_exit = True
print("STATUS", r.status_code)
"""


def test_real_sdk_pipeline_sends_no_patient_data():
    server = HTTPServer(("127.0.0.1", 0), _Sink)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    _Sink.received.clear()
    s = _sensitive()
    env = {
        **os.environ,
        "SENTRY_DSN": f"http://publickey@127.0.0.1:{port}/1",
        "ML_SERVICE_REQUIRE_AUTH": "false",
        "SENSITIVE": json.dumps(s),
    }
    env.pop("DATABASE_URL", None)
    try:
        proc = subprocess.run(
            [sys.executable, "-c", CHILD], cwd=SERVICE_DIR, env=env, capture_output=True, text=True, timeout=60
        )
    finally:
        server.shutdown()
    assert "STATUS 500" in proc.stdout, proc.stdout + proc.stderr

    events = [line for body in _Sink.received for line in body.splitlines() if '"exception"' in line]
    assert events, "the SDK sent no error event — monitoring is not wired up"
    event = json.loads(events[0])
    assert "scoring failed" in json.dumps(event["exception"])

    blob = "\n".join(_Sink.received)
    for needle in (s["name"], s["token"], s["cookie"], s["hr"]):
        assert needle not in blob, f"sensitive value reached Sentry: {needle!r}"
