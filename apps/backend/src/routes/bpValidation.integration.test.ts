/**
 * docs/ENGINEERING_PLAN.md #32: GET /admin/bp-flag-validation. Readings
 * seeded directly via prisma (see doctorMonitoring.integration.test.ts for
 * why — same rationale).
 *
 * This endpoint aggregates globally across every patient in the database,
 * by design (it's a population-level QA report). This suite shares one
 * database with every other integration test file in the same run —
 * including visits.integration.test.ts's own calibration-reading tests —
 * so assertions here check for THIS test's specific pair inside `pairs`,
 * never exact totals like "sampleSize === 1", which would be flaky
 * depending on what else ran first in the same database.
 */
import request from "supertest";
import { app } from "../index";
import prisma from "../lib/prisma";

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

const STRONG_PASSWORD = "Str0ng!Passw0rd";
const ADMIN_SECRET = "test-admin-registration-secret-bpval";

beforeAll(() => {
  process.env.ADMIN_REGISTRATION_SECRET = ADMIN_SECRET;
});

async function registerAdmin(label: string) {
  const agent = request.agent(app);
  const email = uniqueEmail(label);
  const res = await agent.post("/api/v1/auth/register").send({
    email, password: STRONG_PASSWORD, firstName: label, lastName: "Admin",
    role: "ADMIN", adminSecret: ADMIN_SECRET,
  });
  expect(res.status).toBe(201);
  return { agent, email, userId: res.body.user.id as string };
}

async function registerRole(role: "PATIENT" | "DOCTOR", label: string) {
  const agent = request.agent(app);
  const email = uniqueEmail(label);
  const res = await agent.post("/api/v1/auth/register").send({
    email, password: STRONG_PASSWORD, firstName: label, lastName: role, role,
  });
  expect(res.status).toBe(201);
  return { agent, email, userId: res.body.user.id as string };
}

async function seedFlaggedReading(userId: string, bpPromptCheck: boolean, createdAt: Date) {
  return prisma.biometricReading.create({
    data: { userId, source: "manual", heartRateResting: 70, bpPromptCheck, createdAt },
  });
}

async function seedCalibrationReading(userId: string, systolic: number, diastolic: number, createdAt: Date) {
  return prisma.biometricReading.create({
    data: {
      userId, source: "manual", deviceType: "nurse_calibration",
      bloodPressureSystolic: systolic, bloodPressureDiastolic: diastolic, createdAt,
    },
  });
}

describe("bp-flag-validation: role and auth gates", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/admin/bp-flag-validation");
    expect(res.status).toBe(401);
  });

  it("denies a non-admin", async () => {
    const patient = await registerRole("PATIENT", "bpval-patient-role");
    const res = await patient.agent.get("/api/v1/admin/bp-flag-validation");
    expect(res.status).toBe(403);
  });

  it("denies a doctor (this is admin-only QA data, not a clinical view)", async () => {
    const doctor = await registerRole("DOCTOR", "bpval-doctor-role");
    const res = await doctor.agent.get("/api/v1/admin/bp-flag-validation");
    expect(res.status).toBe(403);
  });
});

describe("bp-flag-validation: pairing and confusion matrix", () => {
  it("returns a well-formed report shape regardless of how much data exists", async () => {
    const admin = await registerAdmin("bpval-admin-shape");
    const res = await admin.agent.get("/api/v1/admin/bp-flag-validation");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.sampleSize).toBe("number");
  });

  it("classifies a flagged reading followed by an elevated cuff reading as a true positive", async () => {
    const patient = await registerRole("PATIENT", "bpval-tp");
    const flaggedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days before
    await seedFlaggedReading(patient.userId, true, flaggedAt);
    const calibration = await seedCalibrationReading(patient.userId, 148, 94, new Date()); // elevated: >=140/90

    const admin = await registerAdmin("bpval-admin-tp");
    const res = await admin.agent.get("/api/v1/admin/bp-flag-validation");

    expect(res.status).toBe(200);
    const pair = res.body.pairs.find((p: any) => p.calibrationReadingId === calibration.id);
    expect(pair).toBeDefined();
    expect(pair.elevated).toBe(true);
    expect(pair.promptBpCheck).toBe(true);
  });

  it("classifies a flagged reading followed by a normal cuff reading as a false positive", async () => {
    const patient = await registerRole("PATIENT", "bpval-fp");
    const flaggedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await seedFlaggedReading(patient.userId, true, flaggedAt);
    const calibration = await seedCalibrationReading(patient.userId, 118, 76, new Date()); // normal

    const admin = await registerAdmin("bpval-admin-fp");
    const res = await admin.agent.get("/api/v1/admin/bp-flag-validation");

    expect(res.status).toBe(200);
    const pair = res.body.pairs.find((p: any) => p.calibrationReadingId === calibration.id);
    expect(pair).toBeDefined();
    expect(pair.elevated).toBe(false);
    expect(pair.promptBpCheck).toBe(true);
  });

  it("excludes a calibration reading with no bp_risk-bearing reading inside the pairing window", async () => {
    const patient = await registerRole("PATIENT", "bpval-unpaired");
    // Flagged reading far outside the 7-day pairing window.
    await seedFlaggedReading(patient.userId, true, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    const calibration = await seedCalibrationReading(patient.userId, 148, 94, new Date());

    const admin = await registerAdmin("bpval-admin-unpaired");
    const res = await admin.agent.get("/api/v1/admin/bp-flag-validation");

    expect(res.status).toBe(200);
    const pair = res.body.pairs.find((p: any) => p.calibrationReadingId === calibration.id);
    expect(pair).toBeUndefined();
  });
});
