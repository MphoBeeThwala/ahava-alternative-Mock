/**
 * The ways data reaches the research tables beyond the sweep: opting in at
 * sign-up, diagnosis codes entered on referrals and prescriptions, the
 * patient's own "what have you shared" view, and the admin's per-clinician
 * counts. Real database, real routes.
 */
import request from "supertest";
import { app } from "../../index";
import prisma from "../../lib/prisma";
import { grantTestAccess, verifyClinician } from "../../testSetup/clinicians";
import { subjectKeyFor } from "./pseudonym";

const KEY = "integration-research-key-0123456789abcdef";
const STRONG_PASSWORD = "Str0ng!Passw0rd";
const email = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;

async function register(role: "PATIENT" | "DOCTOR" | "ADMIN", label: string, extra: Record<string, unknown> = {}) {
  const agent = request.agent(app);
  const addr = email(label);
  const res = await agent.post("/api/v1/auth/register").send({
    email: addr, password: STRONG_PASSWORD, firstName: label, lastName: role, role, ...extra,
  });
  return { agent, res, userId: res.body?.user?.id as string, addr };
}

async function patient(label: string, extra: Record<string, unknown> = {}) {
  const r = await register("PATIENT", label, extra);
  expect(r.res.status).toBe(201);
  await prisma.user.update({ where: { id: r.userId }, data: { dateOfBirth: new Date("1975-06-01"), gender: "female" } });
  return r;
}
async function doctor(label: string) {
  const r = await register("DOCTOR", label);
  expect(r.res.status).toBe(201);
  await verifyClinician(r.userId, "DOCTOR");
  return r;
}

const consentRows = (userId: string) =>
  prisma.patientConsent.findMany({ where: { userId, consentType: "RESEARCH_DATA" } });
const outcomesOf = (userId: string) => prisma.researchOutcome.findMany({ where: { subjectKey: subjectKeyFor(userId, KEY)! } });

async function reviewedCase(patientId: string, doctorId: string) {
  const tc = await prisma.triageCase.create({
    data: {
      patientId, doctorId, symptoms: "Headache and dizziness", aiTriageLevel: 3, finalTriageLevel: 3,
      aiRecommendedAction: "Review", aiReasoning: "x", aiPossibleConditions: ["x"], status: "REVIEWED",
    },
  });
  await grantTestAccess(doctorId, patientId, "TRIAGE_CASE", tc.id);
  return tc;
}
const referral = (icd10?: string) => ({
  referralType: "URGENT", provisionalDiagnosis: "Hypertensive urgency", clinicalNotes: "BP 190/110", recommendedFacility: "HOSPITAL", ...(icd10 !== undefined ? { icd10 } : {}),
});

beforeAll(() => {
  process.env.RESEARCH_PSEUDONYM_KEY = KEY;
  delete process.env.RESEARCH_CAPTURE_ENABLED;
  delete process.env.ML_SERVICE_URL;
});

describe("opt-in at sign-up", () => {
  it("records the research consent with the account when ticked", async () => {
    const before = Date.now();
    const { res, userId } = await register("PATIENT", "su-yes", { researchConsent: true });
    expect(res.status).toBe(201);
    const rows = await consentRows(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: "1.0", withdrawn: false });
    expect(rows[0].givenAt.getTime()).toBeGreaterThanOrEqual(before - 1000); // starts now: prospective only
    expect(await prisma.auditLog.count({ where: { userId, resource: "Consent", action: "CREATE" } })).toBeGreaterThan(0);
  });

  it("records nothing when unticked, absent or false: the default is no", async () => {
    for (const extra of [{}, { researchConsent: false }]) {
      const { res, userId } = await register("PATIENT", "su-no", extra);
      expect(res.status).toBe(201);
      expect(await consentRows(userId)).toHaveLength(0);
    }
  });

  it("staff cannot be enrolled this way, and a refused sign-up leaves no consent behind", async () => {
    const r = await register("DOCTOR", "su-staff", { researchConsent: true });
    expect(r.res.status).toBe(400);
    expect(await prisma.user.count({ where: { email: r.addr } })).toBe(0); // refused outright: no account, so no consent either
  });

  it("a sign-up opt-in is later withdrawable like any other", async () => {
    const { agent, userId } = await register("PATIENT", "su-withdraw", { researchConsent: true });
    const res = await agent.delete("/api/v1/consent/RESEARCH_DATA");
    expect(res.status).toBe(200);
    expect((await consentRows(userId))[0].withdrawn).toBe(true);
  });
});

describe("diagnosis codes on referrals and prescriptions", () => {
  it("stores the code on the referral and silently records a weak-label outcome for an opted-in patient", async () => {
    const p = await patient("dx-p1", { researchConsent: true });
    const d = await doctor("dx-d1");
    const tc = await reviewedCase(p.userId, d.userId);

    const res = await d.agent.post(`/api/v1/triage-review/${tc.id}/emergency-referral`).send(referral("i10"));
    expect(res.status).toBe(200);
    expect((await prisma.referral.findUnique({ where: { triageCaseId: tc.id } }))?.icd10).toBe("I10");

    await new Promise((r) => setTimeout(r, 300)); // capture is fire-and-forget
    const rows = await outcomesOf(p.userId);
    const types = rows.map((r) => r.outcomeType).sort();
    expect(types).toEqual(["HYPERTENSION_DIAGNOSED", "TRIAGE_REVIEWED"]);
    const dx = rows.find((r) => r.outcomeType === "HYPERTENSION_DIAGNOSED")!;
    expect(dx).toMatchObject({ icd10: "I10", recordedByRole: "DOCTOR" });
    expect(dx.details).toEqual({ basis: "REMOTE_TRIAGE", route: "REFERRAL" });
    expect(JSON.stringify(rows)).not.toContain(tc.id);
  });

  it("works on a prescription too, and a corrected code replaces the earlier outcome", async () => {
    const p = await patient("dx-p2", { researchConsent: true });
    // The app refuses to prescribe for a patient whose medical passport lacks allergies and current medications.
    await prisma.user.update({
      where: { id: p.userId },
      data: { riskProfile: { medicalPassport: { allergies: ["None known"], currentMedications: ["None"], chronicConditions: ["None"] } } },
    });
    const d = await doctor("dx-d2");
    const tc = await reviewedCase(p.userId, d.userId);
    const rx = (icd10: string) => ({ diagnosis: "Raised blood pressure", icd10, medications: [{ name: "Amlodipine", dosage: "5mg", frequency: "daily", duration: "30 days" }] });

    const first = await d.agent.post(`/api/v1/triage-review/${tc.id}/prescription`).send(rx("I10"));
    expect(first.body).toEqual(expect.anything());
    if (first.status !== 200) throw new Error("prescription refused: " + JSON.stringify(first.body));
    await new Promise((r) => setTimeout(r, 300));
    expect((await outcomesOf(p.userId)).map((r) => r.outcomeType)).toContain("HYPERTENSION_DIAGNOSED");

    // The doctor corrects the diagnosis to diabetes: the hypertension outcome must go.
    await prisma.triageCase.update({ where: { id: tc.id }, data: { status: "REVIEWED" } });
    expect((await d.agent.post(`/api/v1/triage-review/${tc.id}/prescription`).send(rx("E11.9"))).status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    const types = (await outcomesOf(p.userId)).map((r) => r.outcomeType);
    expect(types).toContain("DIABETES_DIAGNOSED");
    expect(types).not.toContain("HYPERTENSION_DIAGNOSED");
  });

  it("records nothing for a patient who has not opted in, but still saves the code on the clinical record", async () => {
    const p = await patient("dx-p3");
    const d = await doctor("dx-d3");
    const tc = await reviewedCase(p.userId, d.userId);
    expect((await d.agent.post(`/api/v1/triage-review/${tc.id}/emergency-referral`).send(referral("I10"))).status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    expect(await outcomesOf(p.userId)).toHaveLength(0);
    expect((await prisma.referral.findUnique({ where: { triageCaseId: tc.id } }))?.icd10).toBe("I10");
  });

  it("the code is optional, and a malformed one is refused before anything is saved", async () => {
    const p = await patient("dx-p4", { researchConsent: true });
    const d = await doctor("dx-d4");
    const tc = await reviewedCase(p.userId, d.userId);
    const bad = await d.agent.post(`/api/v1/triage-review/${tc.id}/emergency-referral`).send(referral("high blood pressure"));
    expect(bad.status).toBe(400);
    expect(await prisma.referral.count({ where: { triageCaseId: tc.id } })).toBe(0);
    expect((await d.agent.post(`/api/v1/triage-review/${tc.id}/emergency-referral`).send(referral())).status).toBe(200);
  });
});

describe("what the patient can see of their own research data", () => {
  it("returns their readings and outcomes, never identifiers, and only a COUNT of model scores", async () => {
    const p = await patient("my-p1", { researchConsent: true });
    await prisma.biometricReading.create({ data: { userId: p.userId, source: "wearable", heartRateResting: 66, createdAt: new Date(Date.now() + 1000) } });
    const { runResearchSweep } = await import("./researchSweep");
    await runResearchSweep(new Date(Date.now() + 5000));
    const [snap] = await prisma.researchSnapshot.findMany({ where: { subjectKey: subjectKeyFor(p.userId, KEY)! } });
    await prisma.researchPrediction.create({ data: { snapshotId: snap.id, modelName: "m", modelVersion: "v", target: "t", probability: 0.42 } });

    const res = await p.agent.get("/api/v1/research/my-data");
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.taking_part).toBe(true);
    expect(d.readings).toHaveLength(1);
    expect(d.readings[0]).toMatchObject({ hrResting: 66, ageBand: expect.any(String) });
    expect(d.modelScoresComputed).toBe(1);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("0.42"); // a model score is never shown to the patient
    expect(text).not.toMatch(/subjectKey|sourceRef|[0-9a-f]{64}/);
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("is theirs alone: another patient sees nothing of it, and a clinician has no route to it", async () => {
    const a = await patient("my-p2", { researchConsent: true });
    const b = await patient("my-p3");
    await prisma.researchOutcome.create({
      data: { subjectKey: subjectKeyFor(a.userId, KEY)!, sourceRef: `x-${Date.now()}`, outcomeType: "DEATH", outcomeDay: new Date(), source: "CLINICIAN_ENTRY", consentVersion: "1.0" },
    });
    const other = await b.agent.get("/api/v1/research/my-data");
    expect(other.body.data).toMatchObject({ taking_part: false, readings: [], outcomes: [] });
    const d = await doctor("my-d1");
    expect((await d.agent.get("/api/v1/research/my-data")).status).toBe(403);
    expect((await request(app).get("/api/v1/research/my-data")).status).toBe(401);
  });

  it("looking is itself audited", async () => {
    const p = await patient("my-p4", { researchConsent: true });
    await p.agent.get("/api/v1/research/my-data");
    expect(await prisma.auditLog.count({ where: { userId: p.userId, resource: "ResearchData", action: "READ" } })).toBe(1);
  });
});

describe("admin view of who records outcomes", () => {
  it("shows per-clinician counts of recorded outcomes and no research rows", async () => {
    const p = await patient("ad-p1", { researchConsent: true });
    const d = await doctor("ad-d1");
    await grantTestAccess(d.userId, p.userId, "TRIAGE_CASE");
    const post = (day: string) => d.agent.post("/api/v1/research/outcomes").send({ patientId: p.userId, outcomeType: "ALERT_CONFIRMED", outcomeDay: day, alertLevel: "RED" });
    expect((await post("2026-09-01")).body.captured).toBe(true);
    expect((await post("2026-09-02")).body.captured).toBe(true);

    const admin = await register("ADMIN", "ad-admin");
    const res = await admin.agent.get("/api/v1/admin/research/status");
    const mine = res.body.research.outcomesRecordedByClinicianLast90Days.find((c: any) => c.clinicianId === d.userId);
    expect(mine).toMatchObject({ count: 2, name: expect.stringContaining("ad-d1") });
    // Aggregate counts by type are the point of this view; row-level data and keys must never appear.
    expect(JSON.stringify(res.body)).not.toMatch(/subjectKey|sourceRef|[0-9a-f]{64}/);
  });
});
