/**
 * End to end through the real @sentry/node pipeline: SENTRY_DSN points at a
 * local HTTP sink, a route throws with patient data in the URL, headers and
 * body, and the test inspects exactly what the SDK transmitted. Guards the
 * dataCollection config in monitoring.ts, not just scrubEvent — Sentry v11
 * collects request data and stack-frame locals by default.
 */
import http from "http";
import zlib from "zlib";
import express from "express";
import type { AddressInfo } from "net";

// Built at runtime so the literals never appear in the source-context lines
// Sentry legitimately attaches to stack frames.
const R = (x: string) => x.split("").reverse().join("");
const S = {
  name: R("eoDenaJ"),
  token: R("NEKOTTERCES"),
  cookie: R("LAVEIKOOC"),
  email: R("moc.elpmaxe@enaj"),
  symptoms: R("niap tsehc gnihsurc"),
  idNumber: R("7809005101008"),
};

describe("Sentry pipeline (real SDK, local sink)", () => {
  const received: string[] = [];
  let sink: http.Server;
  let api: http.Server;
  let monitoring: typeof import("./monitoring");

  beforeAll(async () => {
    sink = http
      .createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          let b = Buffer.concat(chunks);
          if (req.headers["content-encoding"] === "gzip") b = zlib.gunzipSync(b);
          received.push(b.toString());
          res.end("{}");
        });
      })
      .listen(0);
    await new Promise((r) => sink.once("listening", r));
    process.env.SENTRY_DSN = `http://publickey@127.0.0.1:${(sink.address() as AddressInfo).port}/1`;

    monitoring = await import("./monitoring");
    monitoring.initMonitoring("api-test");
    const { errorHandler } = await import("../middleware/errorHandler");

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.requestId = "req-test-1";
      req.user = { id: "user-123", role: "PATIENT", email: S.email };
      next();
    });
    app.post("/api/v1/triage/:id", (req) => {
      const symptoms: unknown = req.body.symptoms; // a PHI-bearing local
      throw new Error("scoring failed: " + typeof symptoms);
    });
    app.post("/api/v1/bad", () => {
      throw Object.assign(new Error("bad input"), { statusCode: 400 });
    });
    app.use(errorHandler as any);
    api = app.listen(0);
    await new Promise((r) => api.once("listening", r));
  });

  afterAll(async () => {
    delete process.env.SENTRY_DSN;
    await new Promise((r) => api.close(r));
    await new Promise((r) => sink.close(r));
  });

  it("reports a 5xx with request id, route and role — and no patient data", async () => {
    const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/api/v1/triage/abc?name=${S.name}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${S.token}`, cookie: `sid=${S.cookie}` },
      body: JSON.stringify({ symptoms: S.symptoms, idNumber: S.idNumber }),
    });
    expect(res.status).toBe(500);
    await fetch(`${base}/api/v1/bad`, { method: "POST" });
    await monitoring.flushMonitoring(5000);

    const events = received
      .flatMap((b) => b.split("\n"))
      .filter((l) => l.includes('"exception"'))
      .map((l) => JSON.parse(l));
    expect(events).toHaveLength(1); // the 400 is not reported
    const [event] = events;
    expect(event.exception.values[0].value).toBe("scoring failed: string");
    expect(event.tags).toMatchObject({
      request_id: "req-test-1",
      route: "/api/v1/triage/:id",
      status_code: "500",
      user_role: "PATIENT",
    });
    expect(event.user).toEqual({ id: "user-123" });

    const all = received.join("\n");
    for (const needle of Object.values(S)) expect(all).not.toContain(needle);
  });
});
