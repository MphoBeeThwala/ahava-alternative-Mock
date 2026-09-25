/**
 * A focused slice of patient.ts (1000+ lines, no prior test coverage at
 * all): biometrics submission (the entry point that feeds the early-warning
 * monitoring pipeline), its auth/validation gates, and baseline-info's
 * day-counting logic. Every route under /api/v1/patient scopes to
 * req.user!.id directly rather than a URL param, so the cross-user
 * authorization risk that matters elsewhere (bookings, visits, messages)
 * doesn't apply here — what's worth pinning is auth-required and
 * input-validation behavior, plus that a submission is actually persisted.
 * The ML service is not running in this test environment, so these also
 * exercise its documented fallback path (README/OPERATIONS.md: "backend
 * has fallback").
 */
import request from "supertest";
import { app } from "../index";
import prisma from "../lib/prisma";

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

const STRONG_PASSWORD = "Str0ng!Passw0rd";

async function registerPatient(label: string) {
  const agent = request.agent(app);
  const email = uniqueEmail(label);
  const res = await agent.post("/api/v1/auth/register").send({
    email,
    password: STRONG_PASSWORD,
    firstName: label,
    lastName: "Patient",
    role: "PATIENT",
  });
  expect(res.status).toBe(201);
  return { agent, email, userId: res.body.user.id as string };
}

describe("patient: biometrics submission", () => {
  it("accepts a valid manual biometrics submission and persists it", async () => {
    const { agent, userId } = await registerPatient("biometrics-submit");

    const res = await agent.post("/api/v1/patient/biometrics").send({
      heartRate: 72,
      bloodPressure: { systolic: 118, diastolic: 76 },
      oxygenSaturation: 98,
      temperature: 36.8,
      source: "manual",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.biometricReadingId).toBeDefined();
    expect(["GREEN", "YELLOW", "RED"]).toContain(res.body.alertLevel);

    const persisted = await prisma.biometricReading.findFirst({ where: { userId } });
    expect(persisted).not.toBeNull();
    expect(persisted!.heartRate).toBe(72);
  });

  it("rejects an unauthenticated submission", async () => {
    const res = await request(app).post("/api/v1/patient/biometrics").send({ heartRate: 72 });
    expect(res.status).toBe(401);
  });

  it("rejects an out-of-range vital instead of silently clamping it", async () => {
    const { agent } = await registerPatient("biometrics-out-of-range");

    const res = await agent.post("/api/v1/patient/biometrics").send({
      heartRate: 400, // schema caps at 220
    });

    expect(res.status).toBe(400);
  });

  it("rejects a blood pressure reading missing diastolic", async () => {
    const { agent } = await registerPatient("biometrics-bp-incomplete");

    const res = await agent.post("/api/v1/patient/biometrics").send({
      bloodPressure: { systolic: 120 },
    });

    expect(res.status).toBe(400);
  });

  it("rejects an invalid source value", async () => {
    const { agent } = await registerPatient("biometrics-bad-source");

    const res = await agent.post("/api/v1/patient/biometrics").send({
      heartRate: 70,
      source: "not-a-real-source",
    });

    expect(res.status).toBe(400);
  });
});

describe("patient: biometrics history", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/patient/biometrics/history");
    expect(res.status).toBe(401);
  });

  it("returns a submitted reading in the caller's own history, most recent first", async () => {
    const { agent } = await registerPatient("biometrics-history");
    await agent.post("/api/v1/patient/biometrics").send({ heartRate: 65, source: "manual" });
    await agent.post("/api/v1/patient/biometrics").send({ heartRate: 90, source: "manual" });

    const res = await agent.get("/api/v1/patient/biometrics/history");

    expect(res.status).toBe(200);
    expect(res.body.data.history.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.history[0].heartRate).toBe(90);
  });

  it("never returns another patient's biometric history", async () => {
    const alice = await registerPatient("biometrics-history-alice");
    const bob = await registerPatient("biometrics-history-bob");
    await alice.agent.post("/api/v1/patient/biometrics").send({ heartRate: 61, source: "manual" });

    const bobHistory = await bob.agent.get("/api/v1/patient/biometrics/history");

    expect(bobHistory.status).toBe(200);
    expect(bobHistory.body.data.history).toHaveLength(0);
  });
});

describe("patient: baseline-info", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/patient/baseline-info");
    expect(res.status).toBe(401);
  });

  it("reports 0 days established for a patient with no biometric readings", async () => {
    const { agent } = await registerPatient("baseline-none");

    const res = await agent.get("/api/v1/patient/baseline-info");

    expect(res.status).toBe(200);
    expect(res.body.daysEstablished).toBe(0);
    expect(res.body.isComplete).toBe(false);
  });

  it("counts at least 1 day established once a reading exists", async () => {
    const { agent } = await registerPatient("baseline-one-reading");
    await agent.post("/api/v1/patient/biometrics").send({ heartRate: 70, source: "manual" });

    const res = await agent.get("/api/v1/patient/baseline-info");

    expect(res.status).toBe(200);
    expect(res.body.daysEstablished).toBeGreaterThanOrEqual(1);
    expect(res.body.daysRequired).toBe(14);
  });
});

describe("patient: alerts and monitoring summary require authentication", () => {
  it("GET /alerts rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/patient/alerts");
    expect(res.status).toBe(401);
  });

  it("GET /alerts returns 200 for an authenticated patient with no alerts yet", async () => {
    const { agent } = await registerPatient("alerts-empty");
    const res = await agent.get("/api/v1/patient/alerts");
    expect(res.status).toBe(200);
  });

  it("GET /monitoring/summary rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/patient/monitoring/summary");
    expect(res.status).toBe(401);
  });
});

/**
 * docs/ENGINEERING_PLAN.md #29/#32: GET /early-warning had zero coverage
 * before this. With the ML service not running in this environment (same
 * as every other test in this file), this exercises the exact fallback
 * shape §29 rewrote to match the real ml-service response one-for-one —
 * the bug that section found was a frontend page reading fields the real
 * payload never had, because the fallback used a different, older shape.
 * These tests pin the fallback's actual JSON contract for real, against a
 * real database, not just by reading the route source.
 */
describe("patient: early-warning summary and its retrospective-snapshot persistence", () => {
  it("404s with no biometric data yet", async () => {
    const { agent } = await registerPatient("ew-no-data");
    const res = await agent.get("/api/v1/patient/early-warning");
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/patient/early-warning");
    expect(res.status).toBe(401);
  });

  it("returns the fallback shape matching the real ml-service contract, and persists the inert snapshot fields", async () => {
    const { agent, userId } = await registerPatient("ew-fallback-shape");
    await agent.post("/api/v1/patient/biometrics").send({
      heartRate: 70,
      bloodPressure: { systolic: 118, diastolic: 76 },
      oxygenSaturation: 98,
      temperature: 36.8,
      source: "manual",
    });

    const res = await agent.get("/api/v1/patient/early-warning");
    expect(res.status).toBe(200);
    const data = res.body.data;

    // cvd_risk / bp_risk / framingham_lab_risk must all be present with
    // the same field names the real ml-service EarlyWarningSummary uses
    // (apps/ml-service/models.py) — this is exactly the shape mismatch
    // §29 found and fixed; a regression here would silently reintroduce it.
    expect(data.cvd_risk).toMatchObject({
      instrument: "WHO_2019_NON_LAB_SOUTHERN_SUB_SAHARAN_AFRICA",
      computable: false,
      risk_category: null,
    });
    expect(data.framingham_lab_risk).toMatchObject({
      instrument: "FRAMINGHAM_LAB_2008_SA_NDOH_APPENDIX_VII",
      computable: false,
      ten_year_risk_pct: null,
      risk_bound: null,
    });
    expect(data.bp_risk).toMatchObject({
      prompt_bp_check: false,
      signed_off: false,
    });
    expect(typeof data.bp_risk.disclaimer).toBe("string");
    expect(data.bp_risk.disclaimer.length).toBeGreaterThan(0);

    // Retrospective-validation snapshot (#29/#32) actually persisted onto
    // the reading the analysis was computed from, not just returned.
    const persisted = await prisma.biometricReading.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    expect(persisted).not.toBeNull();
    expect(persisted!.bpPromptCheck).toBe(false);
    expect(persisted!.cvdRiskCategory).toBeNull();
    expect(persisted!.framinghamRiskPct).toBeNull();
    expect(persisted!.framinghamRiskBound).toBeNull();
  });
});
