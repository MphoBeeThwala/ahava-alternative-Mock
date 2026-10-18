/**
 * Backend <-> ML service, for real: the backend talks to a running ML service
 * over HTTP with the shared service key, and the ML service's own state is read
 * back directly to prove the data arrived. Catches contract drift that each
 * service's own suite cannot (a field one side sends and the other rejects).
 *
 * Needs a running ML service, so it is skipped unless ML_E2E_URL is set:
 *
 *   # terminal 1 (apps/ml-service)
 *   ML_SERVICE_REQUIRE_AUTH=true ML_SERVICE_SHARED_SECRET=e2e-secret uvicorn main:app --port 8000
 *   # terminal 2 (apps/backend)
 *   ML_E2E_URL=http://127.0.0.1:8000 ML_E2E_SECRET=e2e-secret pnpm test:integration crossService
 *
 * CI starts the ML service in the integration job and sets both variables.
 */
import request from "supertest";

const ML_URL = (process.env.ML_E2E_URL || "").replace(/\/+$/, "");
const SECRET = process.env.ML_E2E_SECRET || "";
const run = ML_URL ? describe : describe.skip;

if (ML_URL) {
  // The backend reads these when its routes load, so they go in before it is imported.
  process.env.ML_SERVICE_URL = ML_URL;
  process.env.ML_SERVICE_SHARED_SECRET = SECRET;
  process.env.ML_SERVICE_ALLOW_LOCALHOST = "true";
}

const STRONG_PASSWORD = "Str0ng!Passw0rd";
let app: typeof import("../index").app;

beforeAll(async () => {
  if (ML_URL) ({ app } = await import("../index"));
});

async function ml(method: string, path: string, body?: unknown) {
  const res = await fetch(`${ML_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-ahava-service-key": SECRET },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

async function patient(label: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/register").send({
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    password: STRONG_PASSWORD, firstName: label, lastName: "Patient", role: "PATIENT",
  });
  expect(res.status).toBe(201);
  return { agent, userId: res.body.user.id as string };
}

const wearable = {
  heartRateResting: 66, hrvRmssd: 48, oxygenSaturation: 98, skinTempOffset: 0.1, respiratoryRate: 15,
  source: "wearable",
};

run("backend <-> ML service (live)", () => {
  it("the ML service is reachable with the shared key and refuses without it", async () => {
    expect((await ml("GET", "/readiness-score/e2e-probe")).status).toBe(200);
    const anon = await fetch(`${ML_URL}/readiness-score/e2e-probe`);
    expect(anon.status).toBe(401);
  });

  it("a wearable submission through the backend reaches the ML baseline", async () => {
    const p = await patient("e2e-wearable");
    const before = await ml("GET", `/early-warning/baseline/${p.userId}`);
    const res = await p.agent.post("/api/v1/patient/biometrics").send(wearable);
    expect(res.status).toBe(200);
    const after = await ml("GET", `/early-warning/baseline/${p.userId}`);
    expect(after.status).toBe(200);
    expect(after.json).not.toEqual(before.json);
  });

  it("a measured blood pressure is sent to the ML service and a crisis reading is flagged", async () => {
    const p = await patient("e2e-bp");
    await p.agent.post("/api/v1/patient/biometrics").send(wearable);
    const res = await p.agent.post("/api/v1/patient/biometrics").send({
      bloodPressure: { systolic: 195, diastolic: 125 }, source: "manual",
    });
    expect(res.status).toBe(200);
    expect(res.body.alertLevel).toBe("RED");

    const summary = await ml("GET", `/early-warning/summary/${p.userId}`);
    expect(summary.status).toBe(200);
    expect(summary.json.bp_assessment).toMatchObject({ readings_7d: 1, latest_systolic: 195, level: "RED" });
  });

  it("a transposed blood pressure is rejected by the backend and never reaches the ML service", async () => {
    const p = await patient("e2e-bp-bad");
    const res = await p.agent.post("/api/v1/patient/biometrics").send({ bloodPressure: { systolic: 100, diastolic: 125 }, source: "manual" });
    expect(res.status).toBe(400);
    expect((await ml("GET", `/early-warning/summary/${p.userId}`)).status).toBe(404);
  });

  it("GET /patient/early-warning returns the ML service's summary for the patient's own data", async () => {
    const p = await patient("e2e-summary");
    await p.agent.post("/api/v1/patient/biometrics").send(wearable);
    const res = await p.agent.get("/api/v1/patient/early-warning");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const direct = await ml("GET", `/early-warning/summary/${p.userId}`);
    expect(direct.status).toBe(200);
  });

  it("the readiness score the backend shows comes from the ML service", async () => {
    const p = await patient("e2e-readiness");
    await p.agent.post("/api/v1/patient/biometrics").send(wearable);
    const res = await p.agent.get("/api/v1/patient/biometrics/history");
    expect(res.status).toBe(200);
    const direct = await ml("GET", `/readiness-score/${p.userId}`);
    expect(res.body.readinessScore ?? res.body.data?.readinessScore).toBe(direct.json.score);
  });
});
