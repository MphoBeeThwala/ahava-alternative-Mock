/**
 * Endpoints that no other integration suite called: each gets at least its
 * authorization gate and its main success or validation path, against a real
 * database. Nothing here reaches an external service (Rook, Terra, PayFast and
 * Google Maps are unconfigured in the test environment, which is itself the
 * path under test for their "not configured" responses).
 */
import request from "supertest";
import { app } from "../index";
import prisma from "../lib/prisma";
import { grantTestAccess, verifyClinician } from "../testSetup/clinicians";

const STRONG_PASSWORD = "Str0ng!Passw0rd";
const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;

async function register(role: "PATIENT" | "NURSE" | "DOCTOR" | "ADMIN", label: string) {
  const agent = request.agent(app);
  const email = uniqueEmail(label);
  const res = await agent.post("/api/v1/auth/register").send({ email, password: STRONG_PASSWORD, firstName: label, lastName: role, role });
  expect(res.status).toBe(201);
  if (role === "DOCTOR" || role === "NURSE") await verifyClinician(res.body.user.id, role);
  return { agent, email, userId: res.body.user.id as string };
}

async function seedTriageCase(patientId: string, extra: Record<string, unknown> = {}) {
  return prisma.triageCase.create({
    data: {
      patientId,
      symptoms: "Persistent cough for a week",
      aiTriageLevel: 3,
      aiRecommendedAction: "SEE_DOCTOR",
      aiReasoning: "Needs review",
      aiPossibleConditions: ["Bronchitis"],
      status: "PENDING_REVIEW",
      ...extra,
    },
  });
}

async function seedVisit(patientId: string, nurseId: string, amountInCents = 50000) {
  const { encryptData } = await import("../utils/encryption");
  const booking = await prisma.booking.create({
    data: { patientId, nurseId, encryptedAddress: encryptData("1 Test Lane"), scheduledDate: new Date(Date.now() + 3600_000), paymentMethod: "CARD", paymentStatus: "PENDING", amountInCents },
  });
  return prisma.visit.create({ data: { bookingId: booking.id, nurseId, status: "SCHEDULED", scheduledStart: booking.scheduledDate } });
}

describe("auth: resend-verification and manual-verify", () => {
  it("resend-verification validates the email and never reveals whether an account exists", async () => {
    const bad = await request(app).post("/api/v1/auth/resend-verification").send({ email: "not-an-email" });
    expect(bad.status).toBe(400);

    const unknown = await request(app).post("/api/v1/auth/resend-verification").send({ email: uniqueEmail("nobody") });
    expect(unknown.status).toBe(200);
    expect(unknown.body.success).toBe(true);

    const patient = await register("PATIENT", "resend");
    await prisma.user.update({ where: { id: patient.userId }, data: { isVerified: false } });
    const known = await request(app).post("/api/v1/auth/resend-verification").send({ email: patient.email });
    expect(known.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: patient.userId } });
    expect(row.emailVerificationToken).toBeTruthy();
  });

  it("manual-verify needs a session and verifies the caller outside production", async () => {
    expect((await request(app).post("/api/v1/auth/manual-verify")).status).toBe(401);
    const patient = await register("PATIENT", "manual-verify");
    await prisma.user.update({ where: { id: patient.userId }, data: { isVerified: false } });
    const res = await patient.agent.post("/api/v1/auth/manual-verify");
    expect(res.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: patient.userId } })).isVerified).toBe(true);
  });
});

describe("patient: risk-profile, anomaly-timeline, demo stream", () => {
  it("risk-profile requires auth, rejects bad values, and merges accepted ones", async () => {
    expect((await request(app).patch("/api/v1/patient/risk-profile").send({ smoker: true })).status).toBe(401);
    const patient = await register("PATIENT", "risk");
    const bad = await patient.agent.patch("/api/v1/patient/risk-profile").send({ activityLevel: "EXTREME" });
    expect(bad.status).toBe(400);

    const first = await patient.agent.patch("/api/v1/patient/risk-profile").send({ smoker: true, activityLevel: "LOW" });
    expect(first.status).toBe(200);
    const second = await patient.agent.patch("/api/v1/patient/risk-profile").send({ hypertension: true });
    expect(second.status).toBe(200);
    const stored = (await prisma.user.findUniqueOrThrow({ where: { id: patient.userId } })).riskProfile as Record<string, unknown>;
    expect(stored).toMatchObject({ smoker: true, activityLevel: "LOW", hypertension: true });
  });

  it("anomaly-timeline needs auth, lists one worst-level entry per day, and honours the limit", async () => {
    expect((await request(app).get("/api/v1/patient/anomaly-timeline")).status).toBe(401);
    const patient = await register("PATIENT", "timeline");
    const empty = await patient.agent.get("/api/v1/patient/anomaly-timeline");
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    const day = (n: number, h: number) => new Date(Date.now() - n * 86400_000 - h * 3600_000);
    const base = { userId: patient.userId, heartRate: 80, oxygenSaturation: 97, temperature: 36.6, respiratoryRate: 16 };
    await prisma.biometricReading.createMany({
      data: [
        { ...base, alertLevel: "YELLOW", anomalies: ["a"], createdAt: day(1, 1) },
        { ...base, alertLevel: "RED", anomalies: ["b"], createdAt: day(1, 2) },
        { ...base, alertLevel: "GREEN", anomalies: [], createdAt: day(1, 3) },
        { ...base, alertLevel: "YELLOW", anomalies: ["c"], createdAt: day(3, 0) },
      ],
    });
    const res = await patient.agent.get("/api/v1/patient/anomaly-timeline");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].alertLevel).toBe("RED");
    expect(res.body[0]).toHaveProperty("spo2", 97);

    const limited = await patient.agent.get("/api/v1/patient/anomaly-timeline?limit=1");
    expect(limited.body).toHaveLength(1);
  });

  it("demo/start-stream needs auth and starts a stream for the caller outside production", async () => {
    expect((await request(app).post("/api/v1/patient/demo/start-stream")).status).toBe(401);
    const patient = await register("PATIENT", "demo");
    const res = await patient.agent.post("/api/v1/patient/demo/start-stream?durationSeconds=1&intervalSeconds=1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("payments (versioned and legacy paths)", () => {
  it.each(["/api/v1/payments", "/api/payments"])("%s: create, status and refund enforce auth and ownership", async (base) => {
    expect((await request(app).post(`${base}/create`).send({ visitId: "x" })).status).toBe(401);
    expect((await request(app).get(`${base}/anything/status`)).status).toBe(401);
    expect((await request(app).post(`${base}/anything/refund`)).status).toBe(401);

    const patient = await register("PATIENT", "pay-patient");
    const nurse = await register("NURSE", "pay-nurse");
    const stranger = await register("PATIENT", "pay-stranger");
    const admin = await register("ADMIN", "pay-admin");
    const visit = await seedVisit(patient.userId, nurse.userId);

    expect((await patient.agent.post(`${base}/create`).send({})).status).toBe(400);
    expect((await patient.agent.post(`${base}/create`).send({ visitId: "missing" })).status).toBe(404);
    expect((await stranger.agent.post(`${base}/create`).send({ visitId: visit.id })).status).toBe(403);

    const free = await seedVisit(patient.userId, nurse.userId, 0);
    expect((await patient.agent.post(`${base}/create`).send({ visitId: free.id })).status).toBe(409);

    // Status: owner and clinician see it, a stranger does not; unknown id is 404.
    const payment = await prisma.payment.create({ data: { visitId: visit.id, amountInCents: 50000, status: "COMPLETED", payfastReference: `ref-${Date.now()}-${Math.random()}` } });
    const owner = await patient.agent.get(`${base}/${payment.id}/status`);
    expect(owner.status).toBe(200);
    expect(owner.body.payment.status).toBe("COMPLETED");
    expect((await nurse.agent.get(`${base}/${payment.id}/status`)).status).toBe(200);
    expect((await stranger.agent.get(`${base}/${payment.id}/status`)).status).toBe(403);
    expect((await patient.agent.get(`${base}/nope/status`)).status).toBe(404);

    // Refund: admin only, completed payments only, and only once.
    expect((await patient.agent.post(`${base}/${payment.id}/refund`)).status).toBe(403);
    expect((await admin.agent.post(`${base}/nope/refund`)).status).toBe(404);
    const refunded = await admin.agent.post(`${base}/${payment.id}/refund`);
    expect(refunded.status).toBe(200);
    expect(refunded.body.payment.status).toBe("REFUNDED");
    expect((await admin.agent.post(`${base}/${payment.id}/refund`)).status).toBe(400);
  });

  it("create rejects a second checkout for a visit that is already paid", async () => {
    const patient = await register("PATIENT", "pay-dup-patient");
    const nurse = await register("NURSE", "pay-dup-nurse");
    const visit = await seedVisit(patient.userId, nurse.userId);
    await prisma.payment.create({ data: { visitId: visit.id, amountInCents: 50000, status: "COMPLETED", payfastReference: `dup-${Date.now()}-${Math.random()}` } });
    const res = await patient.agent.post("/api/v1/payments/create").send({ visitId: visit.id });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already been paid/);
  });
});

describe("places", () => {
  it("config is reported, and autocomplete/details are patient-only with validated input", async () => {
    const config = await request(app).get("/api/v1/places/config");
    expect([200, 401]).toContain(config.status);

    expect((await request(app).get("/api/v1/places/autocomplete?input=1+Long+Street&sessionToken=abcdefgh12")).status).toBe(401);
    const patient = await register("PATIENT", "places-patient");
    const nurse = await register("NURSE", "places-nurse");

    expect((await nurse.agent.get("/api/v1/places/autocomplete?input=1+Long+Street&sessionToken=abcdefgh12")).status).toBe(403);
    expect((await patient.agent.get("/api/v1/places/autocomplete?input=ab&sessionToken=abcdefgh12")).status).toBe(400);
    expect((await patient.agent.get("/api/v1/places/autocomplete?input=1+Long+Street&sessionToken=!")).status).toBe(400);
    expect((await patient.agent.get("/api/v1/places/details?placeId=x&sessionToken=abcdefgh12")).status).toBe(400);
    expect((await patient.agent.get("/api/v1/places/details?placeId=ChIJabcdefghij&sessionToken=bad")).status).toBe(400);

    // Maps are not configured here: the client is told to keep the manual field.
    const ac = await patient.agent.get("/api/v1/places/autocomplete?input=1+Long+Street&sessionToken=abcdefgh12");
    expect(ac.status).toBe(200);
    expect(ac.body).toMatchObject({ success: true, available: false, suggestions: [] });
    const det = await patient.agent.get("/api/v1/places/details?placeId=ChIJabcdefghij&sessionToken=abcdefgh12");
    expect(det.status).toBe(200);
    expect(det.body.available).toBe(false);

    const cfg = await patient.agent.get("/api/v1/places/config");
    expect(cfg.status).toBe(200);
    expect(cfg.body.enabled).toBe(false);
  });
});

describe("research: outcome-types", () => {
  it("is for verified doctors only", async () => {
    expect((await request(app).get("/api/v1/research/outcome-types")).status).toBe(401);
    const patient = await register("PATIENT", "research-patient");
    expect((await patient.agent.get("/api/v1/research/outcome-types")).status).toBe(403);
    const doctor = await register("DOCTOR", "research-doctor");
    const res = await doctor.agent.get("/api/v1/research/outcome-types");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.outcomeTypes)).toBe(true);
    expect(res.body.outcomeTypes.length).toBeGreaterThan(0);
  });
});

describe("wearable connections (Rook and Terra)", () => {
  it.each(["rook", "terra"])("%s: status and disconnect need auth and act on the caller only", async (vendor) => {
    const base = `/api/v1/${vendor}`;
    expect((await request(app).get(`${base}/status`)).status).toBe(401);
    expect((await request(app).post(`${base}/connect`)).status).toBe(401);
    expect((await request(app).post(`${base}/disconnect`)).status).toBe(401);

    const patient = await register("PATIENT", `${vendor}-patient`);
    const status = await patient.agent.get(`${base}/status`);
    expect(status.status).toBe(200);
    expect(status.body.connected).toBe(false);

    // Not configured in tests: a clear 503, never a crash or a call out.
    const connect = await patient.agent.post(`${base}/connect`).send({});
    expect(connect.status).toBe(503);
  });

  it("rook: a stored connection is reported, then cleared by disconnect", async () => {
    const patient = await register("PATIENT", "rook-linked");
    await prisma.user.update({ where: { id: patient.userId }, data: { rookUserId: "rook-test-user" } as any });
    const linked = await patient.agent.get("/api/v1/rook/status");
    expect(linked.body).toMatchObject({ connected: true, rookUserId: "rook-test-user" });
    expect((await patient.agent.post("/api/v1/rook/disconnect")).status).toBe(200);
    expect((await patient.agent.get("/api/v1/rook/status")).body.connected).toBe(false);
  });

  it("terra: disconnect without a connection is a 400", async () => {
    const patient = await register("PATIENT", "terra-unlinked");
    const res = await patient.agent.post("/api/v1/terra/disconnect");
    expect(res.status).toBe(400);
  });
});

describe("triage-cases (patient and doctor views)", () => {
  it("lists a patient's own cases and gets one, hiding the clinical plan and other patients' cases", async () => {
    expect((await request(app).get("/api/v1/triage-cases")).status).toBe(401);
    const patient = await register("PATIENT", "tc-patient");
    const other = await register("PATIENT", "tc-other");
    const tc = await seedTriageCase(patient.userId, { aiStructuredPlan: { tiers: ["secret"] } });

    const list = await patient.agent.get("/api/v1/triage-cases");
    expect(list.status).toBe(200);
    const listed = list.body.cases.find((c: any) => c.id === tc.id);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty("aiStructuredPlan");

    const one = await patient.agent.get(`/api/v1/triage-cases/${tc.id}`);
    expect(one.status).toBe(200);
    expect(one.body.triageCase.id).toBe(tc.id);
    expect(one.body.triageCase).not.toHaveProperty("aiStructuredPlan");

    expect((await other.agent.get(`/api/v1/triage-cases/${tc.id}`)).status).toBe(403);
    expect((await patient.agent.get("/api/v1/triage-cases/does-not-exist")).status).toBe(404);

    const nurse = await register("NURSE", "tc-nurse");
    expect((await nurse.agent.get("/api/v1/triage-cases")).status).toBe(403);
  });

  it("lets the claiming doctor read the case and submit a review, with validation", async () => {
    const patient = await register("PATIENT", "rv-patient");
    const doctor = await register("DOCTOR", "rv-doctor");
    const otherDoctor = await register("DOCTOR", "rv-other-doctor");
    const tc = await seedTriageCase(patient.userId);

    // Unclaimed: reviewing is refused with a pointer to claim first.
    const early = await doctor.agent.patch(`/api/v1/triage-cases/${tc.id}/review`).send({ doctorNotes: "n", doctorDiagnosis: "d" });
    expect(early.status).toBe(409);
    expect((await doctor.agent.patch("/api/v1/triage-cases/missing/review").send({})).status).toBe(404);
    expect((await patient.agent.patch(`/api/v1/triage-cases/${tc.id}/review`).send({})).status).toBe(403);

    expect((await doctor.agent.post(`/api/v1/triage-review/${tc.id}/claim`).send({})).status).toBe(200);
    expect((await otherDoctor.agent.patch(`/api/v1/triage-cases/${tc.id}/review`).send({ doctorNotes: "n", doctorDiagnosis: "d" })).status).toBe(403);

    expect((await doctor.agent.patch(`/api/v1/triage-cases/${tc.id}/review`).send({ doctorNotes: "  ", doctorDiagnosis: "d" })).status).toBe(400);
    const mine = await doctor.agent.get("/api/v1/triage-cases");
    expect(mine.body.cases.map((c: any) => c.id)).toContain(tc.id);
    expect((await doctor.agent.get(`/api/v1/triage-cases/${tc.id}`)).status).toBe(200);

    const reviewed = await doctor.agent.patch(`/api/v1/triage-cases/${tc.id}/review`).send({ doctorNotes: "Chest clear", doctorDiagnosis: "Viral bronchitis", finalTriageLevel: 3 });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.triageCase.status).toBe("REVIEWED");
    expect(reviewed.body.triageCase.finalDiagnosis).toBe("Viral bronchitis");
  });
});

describe("triage-review: pending, follow-up, attachments and PDFs", () => {
  it("pending lists unclaimed cases for verified doctors only", async () => {
    const patient = await register("PATIENT", "pend-patient");
    const doctor = await register("DOCTOR", "pend-doctor");
    const tc = await seedTriageCase(patient.userId);
    expect((await patient.agent.get("/api/v1/triage-review/pending")).status).toBe(403);
    const res = await doctor.agent.get("/api/v1/triage-review/pending");
    expect(res.status).toBe(200);
    expect(res.body.cases.map((c: any) => c.id)).toContain(tc.id);
    await doctor.agent.post(`/api/v1/triage-review/${tc.id}/claim`).send({});
    const after = await doctor.agent.get("/api/v1/triage-review/pending");
    expect(after.body.cases.map((c: any) => c.id)).not.toContain(tc.id);
  });

  it("request-follow-up then follow-up-response round-trips between doctor and patient", async () => {
    const patient = await register("PATIENT", "fu-patient");
    const stranger = await register("PATIENT", "fu-stranger");
    const doctor = await register("DOCTOR", "fu-doctor");
    const tc = await seedTriageCase(patient.userId);
    const base = `/api/v1/triage-review/${tc.id}/request-follow-up`;

    expect((await doctor.agent.post(base).send({ message: "How long?" })).status).toBe(409); // not claimed
    await doctor.agent.post(`/api/v1/triage-review/${tc.id}/claim`).send({});
    expect((await doctor.agent.post(base).send({})).status).toBe(400);
    expect((await doctor.agent.post(base).send({ requestType: "BOGUS", message: "x" })).status).toBe(400);
    expect((await patient.agent.post(base).send({ message: "x" })).status).toBe(403);

    const asked = await doctor.agent.post(base).send({ requestType: "MORE_INFO", message: "How long has this lasted?", questions: ["Any fever?"] });
    expect(asked.status).toBe(200);
    expect((await prisma.triageCase.findUniqueOrThrow({ where: { id: tc.id } })).status).toBe("AWAITING_PATIENT_RESPONSE");

    const reply = `/api/v1/triage/${tc.id}/follow-up-response`;
    expect((await request(app).post(reply).send({ responseText: "x" })).status).toBe(401);
    expect((await doctor.agent.post(reply).send({ responseText: "x" })).status).toBe(403);
    expect((await patient.agent.post(reply).send({})).status).toBe(400);
    expect((await stranger.agent.post(reply).send({ responseText: "x" })).status).toBe(404);

    const answered = await patient.agent.post(reply).send({ responseText: "About a week, no fever." });
    expect(answered.status).toBe(200);
    expect((await prisma.triageCase.findUniqueOrThrow({ where: { id: tc.id } })).status).not.toBe("AWAITING_PATIENT_RESPONSE");
    // No longer waiting on the patient, so a second reply is refused.
    expect((await patient.agent.post(reply).send({ responseText: "again" })).status).toBe(400);
  });

  it("attachments: unknown case and unknown attachment are 404, outsiders are refused", async () => {
    const patient = await register("PATIENT", "att-patient");
    const stranger = await register("PATIENT", "att-stranger");
    const tc = await seedTriageCase(patient.userId);
    expect((await request(app).get(`/api/v1/triage-review/${tc.id}/attachments/a1`)).status).toBe(401);
    expect((await patient.agent.get("/api/v1/triage-review/missing/attachments/a1")).status).toBe(404);
    expect((await stranger.agent.get(`/api/v1/triage-review/${tc.id}/attachments/a1`)).status).toBe(403);
    expect((await patient.agent.get(`/api/v1/triage-review/${tc.id}/attachments/a1`)).status).toBe(404);
  });

  it("prescription and referral PDFs are served to the patient and the treating doctor only", async () => {
    const patient = await register("PATIENT", "pdf-patient");
    const stranger = await register("PATIENT", "pdf-stranger");
    const doctor = await register("DOCTOR", "pdf-doctor");
    const tc = await seedTriageCase(patient.userId, { doctorId: doctor.userId });
    await grantTestAccess(doctor.userId, patient.userId, "TRIAGE_CASE", tc.id);

    for (const kind of ["prescription", "referral"]) {
      expect((await patient.agent.get(`/api/v1/triage-review/${tc.id}/${kind}/pdf`)).status).toBe(404);
    }

    await prisma.prescription.create({
      data: {
        triageCaseId: tc.id, patientId: patient.userId, doctorId: doctor.userId,
        medications: [{ name: "Amoxicillin", dosage: "500mg", frequency: "3x daily", duration: "5 days" }],
        diagnosis: "Bronchitis", doctorNameSnapshot: "Dr Test",
      },
    });
    await prisma.referral.create({
      data: {
        triageCaseId: tc.id, patientId: patient.userId, doctorId: doctor.userId,
        referralType: "URGENT", provisionalDiagnosis: "Pneumonia?", clinicalNotes: "Needs chest X-ray",
        recommendedFacility: "HOSPITAL", doctorNameSnapshot: "Dr Test",
      },
    });

    for (const kind of ["prescription", "referral"]) {
      const url = `/api/v1/triage-review/${tc.id}/${kind}/pdf`;
      expect((await request(app).get(url)).status).toBe(401);
      for (const who of [patient, doctor]) {
        const res = await who.agent.get(url).buffer(true).parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/application\/pdf/);
        expect((res.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
      }
      expect((await stranger.agent.get(url)).status).toBe(403);
    }
  });
});

describe("service roots and the webhooks index", () => {
  it("GET / redirects to /health", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/health");
  });

  it("GET /health/ws-redis reports websocket redis state", async () => {
    const res = await request(app).get("/health/ws-redis");
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe("object");
  });

  it("GET /webhooks answers with an empty event list", async () => {
    const res = await request(app).get("/webhooks");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, events: [] });
  });
});
