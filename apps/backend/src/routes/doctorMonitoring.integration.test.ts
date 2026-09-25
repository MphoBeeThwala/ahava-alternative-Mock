/**
 * docs/ENGINEERING_PLAN.md #30/#32: GET /doctor/monitoring had no test
 * coverage at all — the route itself didn't exist until #30. Readings are
 * seeded directly via prisma (not through the real ML pipeline, which
 * isn't running in this test environment and wouldn't reliably produce a
 * specific alertLevel on demand) — same pattern this file's sibling
 * (visits.integration.test.ts) already uses for Visit/Booking setup that's
 * simpler to seed directly than drive through the full flow.
 */
import request from "supertest";
import { app } from "../index";
import prisma from "../lib/prisma";

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

const STRONG_PASSWORD = "Str0ng!Passw0rd";

async function registerRole(role: "PATIENT" | "NURSE" | "DOCTOR", label: string) {
  const agent = request.agent(app);
  const email = uniqueEmail(label);
  const res = await agent.post("/api/v1/auth/register").send({
    email,
    password: STRONG_PASSWORD,
    firstName: label,
    lastName: role,
    role,
  });
  expect(res.status).toBe(201);
  return { agent, email, userId: res.body.user.id as string };
}

async function grantBiometricConsent(userId: string) {
  await prisma.patientConsent.create({
    data: { userId, consentType: "BIOMETRIC_MONITORING", version: "1.0" },
  });
}

async function seedReading(userId: string, data: Partial<{
  alertLevel: string; bpPromptCheck: boolean; cvdRiskCategory: string;
  createdAt: Date; heartRateResting: number;
}>) {
  return prisma.biometricReading.create({
    data: {
      userId,
      source: "manual",
      heartRateResting: data.heartRateResting ?? 70,
      alertLevel: data.alertLevel ?? "GREEN",
      bpPromptCheck: data.bpPromptCheck ?? false,
      cvdRiskCategory: data.cvdRiskCategory ?? null,
      createdAt: data.createdAt ?? new Date(),
    },
  });
}

describe("doctor monitoring: role and auth gates", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/doctor/monitoring");
    expect(res.status).toBe(401);
  });

  it("denies a patient", async () => {
    const patient = await registerRole("PATIENT", "mon-patient-role");
    const res = await patient.agent.get("/api/v1/doctor/monitoring");
    expect(res.status).toBe(403);
  });

  it("denies a nurse", async () => {
    const nurse = await registerRole("NURSE", "mon-nurse-role");
    const res = await nurse.agent.get("/api/v1/doctor/monitoring");
    expect(res.status).toBe(403);
  });

  it("allows a doctor, returning an empty list with no consented flagged patients", async () => {
    const doctor = await registerRole("DOCTOR", "mon-doctor-empty");
    const res = await doctor.agent.get("/api/v1/doctor/monitoring");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.patients)).toBe(true);
  });
});

describe("doctor monitoring: consent gating and severity filtering", () => {
  it("never surfaces a flagged patient who has not given BIOMETRIC_MONITORING consent", async () => {
    const patient = await registerRole("PATIENT", "mon-noconsent");
    await seedReading(patient.userId, { alertLevel: "RED" });
    const doctor = await registerRole("DOCTOR", "mon-doctor-noconsent");

    const res = await doctor.agent.get("/api/v1/doctor/monitoring");
    expect(res.status).toBe(200);
    expect(res.body.patients.map((p: any) => p.userId)).not.toContain(patient.userId);
  });

  it("surfaces a consented patient with a RED latest reading", async () => {
    const patient = await registerRole("PATIENT", "mon-red");
    await grantBiometricConsent(patient.userId);
    await seedReading(patient.userId, { alertLevel: "RED" });
    const doctor = await registerRole("DOCTOR", "mon-doctor-red");

    const res = await doctor.agent.get("/api/v1/doctor/monitoring");
    expect(res.status).toBe(200);
    const found = res.body.patients.find((p: any) => p.userId === patient.userId);
    expect(found).toBeDefined();
    expect(found.alertLevel).toBe("RED");
  });

  it("does not surface a consented patient whose latest reading is GREEN, even if an older reading was RED", async () => {
    const patient = await registerRole("PATIENT", "mon-recovered");
    await grantBiometricConsent(patient.userId);
    await seedReading(patient.userId, { alertLevel: "RED", createdAt: new Date(Date.now() - 60_000) });
    await seedReading(patient.userId, { alertLevel: "GREEN", createdAt: new Date() });
    const doctor = await registerRole("DOCTOR", "mon-doctor-recovered");

    const res = await doctor.agent.get("/api/v1/doctor/monitoring");
    expect(res.status).toBe(200);
    expect(res.body.patients.map((p: any) => p.userId)).not.toContain(patient.userId);
  });

  it("does not surface a consented patient with an unflagged GREEN reading", async () => {
    const patient = await registerRole("PATIENT", "mon-green");
    await grantBiometricConsent(patient.userId);
    await seedReading(patient.userId, { alertLevel: "GREEN" });
    const doctor = await registerRole("DOCTOR", "mon-doctor-green");

    const res = await doctor.agent.get("/api/v1/doctor/monitoring");
    expect(res.status).toBe(200);
    expect(res.body.patients.map((p: any) => p.userId)).not.toContain(patient.userId);
  });
});
