/**
 * The research pipeline against a real database: consent in, sweep captures,
 * nothing identifying is stored, withdrawal deletes, outcomes need an active
 * care relationship, and the admin view reports counts only.
 */
import request from "supertest";
import { app } from "../../index";
import prisma from "../../lib/prisma";
import { grantTestAccess, verifyClinician } from "../../testSetup/clinicians";
import { subjectKeyFor } from "./pseudonym";
import { captureTriageOutcome } from "./researchCapture";
import { runResearchSweep } from "./researchSweep";

const KEY = "integration-research-key-0123456789abcdef";
const STRONG_PASSWORD = "Str0ng!Passw0rd";
const email = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;

async function register(role: "PATIENT" | "DOCTOR" | "ADMIN", label: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/register").send({
    email: email(label), password: STRONG_PASSWORD, firstName: label, lastName: role, role,
  });
  expect(res.status).toBe(201);
  const userId = res.body.user.id as string;
  if (role === "DOCTOR") await verifyClinician(userId, "DOCTOR");
  if (role === "PATIENT") {
    await prisma.user.update({ where: { id: userId }, data: { dateOfBirth: new Date("1978-04-02"), gender: "male", riskProfile: { smoker: true } } });
  }
  return { agent, userId, email: res.body.user.email as string };
}

const reading = (userId: string, createdAt: Date, hr = 64) =>
  prisma.biometricReading.create({ data: { userId, source: "wearable", heartRateResting: hr, hrvRmssd: 41, oxygenSaturation: 97, createdAt } });

const giveResearchConsent = (agent: ReturnType<typeof request.agent>) => agent.post("/api/v1/consent").send({ consentType: "RESEARCH_DATA", version: "1.0" });
const snapshotsOf = (userId: string) => prisma.researchSnapshot.findMany({ where: { subjectKey: subjectKeyFor(userId, KEY)! } });
const outcomesOf = (userId: string) => prisma.researchOutcome.findMany({ where: { subjectKey: subjectKeyFor(userId, KEY)! } });

beforeAll(() => {
  process.env.RESEARCH_PSEUDONYM_KEY = KEY;
  delete process.env.RESEARCH_CAPTURE_ENABLED;
  delete process.env.ML_SERVICE_URL; // shadow scoring off: nothing to call
});
beforeEach(async () => {
  await prisma.researchCursor.deleteMany({});
});

describe("consent", () => {
  it("accepts RESEARCH_DATA on the current wording and refuses any other version", async () => {
    const { agent } = await register("PATIENT", "rc-consent");
    expect((await agent.post("/api/v1/consent").send({ consentType: "RESEARCH_DATA", version: "0.9" })).status).toBe(400);
    expect((await giveResearchConsent(agent)).status).toBe(201);
  });

  it("is separate: BIOMETRIC_MONITORING and DATA_SHARING consent do not enrol anyone in research", async () => {
    const { agent, userId } = await register("PATIENT", "rc-separate");
    await agent.post("/api/v1/consent").send({ consentType: "BIOMETRIC_MONITORING" });
    await agent.post("/api/v1/consent").send({ consentType: "DATA_SHARING" });
    await reading(userId, new Date());
    await runResearchSweep();
    expect(await snapshotsOf(userId)).toHaveLength(0);
  });
});

describe("sweep capture", () => {
  it("captures post-consent readings only, with a pseudonym and no identity, and is idempotent", async () => {
    const { agent, userId, email: mail } = await register("PATIENT", "rc-sweep");
    const before = await reading(userId, new Date(Date.now() - 3 * 86_400_000));
    await giveResearchConsent(agent);
    const after = await reading(userId, new Date(Date.now() + 1000));

    const first = await runResearchSweep(new Date(Date.now() + 5000));
    expect(first.written).toBeGreaterThanOrEqual(1);
    const rows = await snapshotsOf(userId);
    expect(rows).toHaveLength(1); // the pre-consent reading is never pulled in
    expect(rows[0]).toMatchObject({ ageBand: expect.stringMatching(/^4\d-4\d$/), sex: "male", smoker: true, hrResting: 64, source: "wearable" });

    const dump = JSON.stringify(rows);
    for (const secret of [userId, mail, before.id, after.id]) expect(dump).not.toContain(secret);

    await prisma.researchCursor.deleteMany({}); // force a full re-read
    await runResearchSweep(new Date(Date.now() + 6000));
    expect(await snapshotsOf(userId)).toHaveLength(1);
  });

  it("never captures staff, minors or patients without consent", async () => {
    const noConsent = await register("PATIENT", "rc-none");
    await reading(noConsent.userId, new Date(Date.now() + 1000));
    const minor = await register("PATIENT", "rc-minor");
    await prisma.user.update({ where: { id: minor.userId }, data: { dateOfBirth: new Date(Date.now() - 10 * 365 * 86_400_000) } });
    await giveResearchConsent(minor.agent);
    await reading(minor.userId, new Date(Date.now() + 1000));
    await runResearchSweep(new Date(Date.now() + 5000));
    expect(await snapshotsOf(noConsent.userId)).toHaveLength(0);
    expect(await snapshotsOf(minor.userId)).toHaveLength(0);
  });

  it("does nothing at all without a pseudonym key", async () => {
    const { agent, userId } = await register("PATIENT", "rc-nokey");
    await giveResearchConsent(agent);
    await reading(userId, new Date(Date.now() + 1000));
    const saved = process.env.RESEARCH_PSEUDONYM_KEY;
    delete process.env.RESEARCH_PSEUDONYM_KEY;
    try {
      expect(await runResearchSweep(new Date(Date.now() + 5000))).toEqual({ considered: 0, written: 0, scored: 0 });
    } finally {
      process.env.RESEARCH_PSEUDONYM_KEY = saved;
    }
  });
});

describe("withdrawal", () => {
  it("deletes snapshots, predictions and outcomes, tells the truth about it, and re-consent starts fresh", async () => {
    const { agent, userId } = await register("PATIENT", "rc-withdraw");
    await giveResearchConsent(agent);
    await reading(userId, new Date(Date.now() + 1000));
    await runResearchSweep(new Date(Date.now() + 5000));
    const [snap] = await snapshotsOf(userId);
    await prisma.researchPrediction.create({ data: { snapshotId: snap.id, modelName: "m", modelVersion: "v", target: "t", probability: 0.2 } });
    await captureTriageOutcome({ id: "case-w", patientId: userId, aiTriageLevel: 3, finalTriageLevel: 2, route: "RELEASED" });
    expect(await outcomesOf(userId)).toHaveLength(1);

    const res = await agent.delete("/api/v1/consent/RESEARCH_DATA");
    expect(res.status).toBe(200);
    expect(res.body.researchDataDeleted).toBe(true);
    expect(await snapshotsOf(userId)).toHaveLength(0);
    expect(await outcomesOf(userId)).toHaveLength(0);
    expect(await prisma.researchPrediction.count({ where: { snapshotId: snap.id } })).toBe(0);

    // Re-consenting is a new, prospective agreement: yesterday's readings stay out.
    await reading(userId, new Date(Date.now() - 86_400_000));
    await giveResearchConsent(agent);
    await runResearchSweep(new Date(Date.now() + 8000));
    expect(await snapshotsOf(userId)).toHaveLength(0);
  });

  it("stops capture immediately on withdrawal", async () => {
    const { agent, userId } = await register("PATIENT", "rc-stop");
    await giveResearchConsent(agent);
    await agent.delete("/api/v1/consent/RESEARCH_DATA");
    await reading(userId, new Date(Date.now() + 1000));
    await runResearchSweep(new Date(Date.now() + 5000));
    expect(await snapshotsOf(userId)).toHaveLength(0);
  });
});

describe("clinician outcomes", () => {
  const body = (patientId: string, over = {}) => ({ patientId, outcomeType: "HYPERTENSION_DIAGNOSED", outcomeDay: "2026-09-01", icd10: "I10", basis: "CLINICAL", ...over });

  it("is for verified doctors only", async () => {
    const patient = await register("PATIENT", "rc-out-p0");
    expect((await patient.agent.post("/api/v1/research/outcomes").send(body(patient.userId))).status).toBe(403);
    expect((await request(app).post("/api/v1/research/outcomes").send(body(patient.userId))).status).toBe(401);
  });

  it("needs an active care grant for that patient, and audits the refusal", async () => {
    const patient = await register("PATIENT", "rc-out-p1");
    const doctor = await register("DOCTOR", "rc-out-d1");
    const res = await doctor.agent.post("/api/v1/research/outcomes").send(body(patient.userId));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NO_CARE_ACCESS");
    expect(await prisma.auditLog.count({ where: { userId: doctor.userId, action: "ACCESS_DENIED", resource: "ResearchOutcome" } })).toBeGreaterThan(0);
  });

  it("records a structured outcome for a consented patient, dedupes repeats, and audits without the clinical content", async () => {
    const patient = await register("PATIENT", "rc-out-p2");
    const doctor = await register("DOCTOR", "rc-out-d2");
    await giveResearchConsent(patient.agent);
    await grantTestAccess(doctor.userId, patient.userId, "TRIAGE_CASE");

    const res = await doctor.agent.post("/api/v1/research/outcomes").send(body(patient.userId));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, captured: true });
    await doctor.agent.post("/api/v1/research/outcomes").send(body(patient.userId));

    const rows = await outcomesOf(patient.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcomeType: "HYPERTENSION_DIAGNOSED", icd10: "I10", source: "CLINICIAN_ENTRY", recordedByRole: "DOCTOR" });
    expect(JSON.stringify(rows)).not.toContain(patient.userId);

    const audit = await prisma.auditLog.findFirst({ where: { userId: doctor.userId, resource: "ResearchOutcome", action: "CREATE" } });
    expect(JSON.stringify(audit?.metadata)).not.toContain("I10");
  });

  it("stores nothing for a patient who has not opted in, and says so without revealing more", async () => {
    const patient = await register("PATIENT", "rc-out-p3");
    const doctor = await register("DOCTOR", "rc-out-d3");
    await grantTestAccess(doctor.userId, patient.userId, "TRIAGE_CASE");
    const res = await doctor.agent.post("/api/v1/research/outcomes").send(body(patient.userId));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, captured: false, reason: "no_consent" });
    expect(await outcomesOf(patient.userId)).toHaveLength(0);
  });

  it("rejects invalid input and automatic-only outcome types, storing nothing", async () => {
    const patient = await register("PATIENT", "rc-out-p4");
    const doctor = await register("DOCTOR", "rc-out-d4");
    await giveResearchConsent(patient.agent);
    await grantTestAccess(doctor.userId, patient.userId, "TRIAGE_CASE");
    for (const bad of [{ outcomeType: "TRIAGE_REVIEWED" }, { outcomeDay: "soon" }, { icd10: "heart attack" }, { outcomeDay: "2999-01-01" }]) {
      expect((await doctor.agent.post("/api/v1/research/outcomes").send(body(patient.userId, bad))).status).toBe(400);
    }
    expect(await outcomesOf(patient.userId)).toHaveLength(0);
  });
});

describe("triage outcomes", () => {
  it("records AI vs doctor levels only, plus an emergency referral marker, for consented patients", async () => {
    const { agent, userId } = await register("PATIENT", "rc-triage");
    await giveResearchConsent(agent);
    expect(await captureTriageOutcome({ id: "case-1", patientId: userId, aiTriageLevel: 4, finalTriageLevel: 2, route: "REFERRAL", emergencyReferral: true })).toBe("captured");
    const rows = await outcomesOf(userId);
    expect(rows.map((r) => r.outcomeType).sort()).toEqual(["EMERGENCY_REFERRAL", "TRIAGE_REVIEWED"]);
    expect(rows.find((r) => r.outcomeType === "TRIAGE_REVIEWED")!.details).toEqual({ aiLevel: 4, finalLevel: 2, overridden: true, route: "REFERRAL" });
    // A doctor correcting the final level replaces the record, never duplicates it.
    await captureTriageOutcome({ id: "case-1", patientId: userId, aiTriageLevel: 4, finalTriageLevel: 3, route: "REFERRAL" });
    expect((await outcomesOf(userId)).filter((r) => r.outcomeType === "TRIAGE_REVIEWED")).toHaveLength(1);
  });
});

describe("admin status", () => {
  it("is admin-only and returns aggregate counts, never rows or keys", async () => {
    const patient = await register("PATIENT", "rc-admin-p");
    expect((await patient.agent.get("/api/v1/admin/research/status")).status).toBe(403);

    const admin = await register("ADMIN", "rc-admin");
    const res = await admin.agent.get("/api/v1/admin/research/status");
    expect(res.status).toBe(200);
    expect(res.body.research).toMatchObject({
      captureEnabled: true, consentVersion: "1.0",
      consentedPatients: expect.any(Number), snapshots: expect.any(Number), subjectsWithSnapshots: expect.any(Number),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/subjectKey|[0-9a-f]{64}/);
  });
});
