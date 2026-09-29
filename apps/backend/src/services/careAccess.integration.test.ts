/**
 * The clinical access model (services/careAccess.ts, ENGINEERING_PLAN §38)
 * against a real database: verified credentials, per-patient time-bound
 * grants, minimum-necessary queues, admin separation of duties,
 * admin-granted and break-glass access, and the patient's access log.
 */
import request from "supertest";
import { app } from "../index";
import prisma from "../lib/prisma";
import { encryptData, isEncryptedPayload } from "../utils/encryption";
import { grantTestAccess, verifyClinician } from "../testSetup/clinicians";

const STRONG_PASSWORD = "Str0ng!Passw0rd";
const ADMIN_SECRET = "test-admin-registration-secret-care-access";

beforeAll(() => {
  process.env.ADMIN_REGISTRATION_SECRET = ADMIN_SECRET;
});

type Role = "PATIENT" | "NURSE" | "DOCTOR" | "ADMIN";

async function register(role: Role, label: string, { verified = true } = {}) {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/register").send({
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    password: STRONG_PASSWORD,
    firstName: label,
    lastName: "Tester",
    role,
    ...(role === "ADMIN" ? { adminSecret: ADMIN_SECRET } : {}),
  });
  expect(res.status).toBe(201);
  const userId = res.body.user.id as string;
  if (verified && (role === "NURSE" || role === "DOCTOR")) await verifyClinician(userId, role);
  return { agent, userId };
}

async function seedVisit(patientId: string, nurseId: string, { status = "SCHEDULED", grant = true } = {}) {
  const booking = await prisma.booking.create({
    data: {
      patientId,
      nurseId,
      encryptedAddress: encryptData("7 Private Road"),
      scheduledDate: new Date(Date.now() + 3600_000),
      paymentMethod: "CARD",
      paymentStatus: "COMPLETED",
      amountInCents: 50000,
    },
  });
  const visit = await prisma.visit.create({
    data: { bookingId: booking.id, nurseId, status: status as any, scheduledStart: booking.scheduledDate, nurseReport: "Patient stable." },
  });
  if (grant) await grantTestAccess(nurseId, patientId, "VISIT_ASSIGNMENT", visit.id);
  return { booking, visit };
}

async function seedTriageCase(patientId: string) {
  return prisma.triageCase.create({
    data: {
      patientId,
      symptoms: "Crushing chest pain radiating to left arm",
      aiTriageLevel: 2,
      aiRecommendedAction: "EMERGENCY",
      aiReasoning: "Possible ACS",
      aiPossibleConditions: ["ACS"],
      status: "PENDING_REVIEW",
    },
  });
}

describe("verified credentials", () => {
  it("keeps an unverified nurse from going online or reading visits", async () => {
    const nurse = await register("NURSE", "unverified-nurse", { verified: false });

    const online = await nurse.agent.patch("/api/v1/nurse/availability").send({ isAvailable: true, lat: -33.9, lng: 18.4 });
    const visits = await nurse.agent.get("/api/v1/nurse/visits");

    expect(online.status).toBe(403);
    expect(online.body.code).toBe("CREDENTIAL_UNVERIFIED");
    expect(visits.status).toBe(403);
  });

  it("keeps an unverified doctor out of the triage queue but lets them submit an HPCSA number", async () => {
    const doctor = await register("DOCTOR", "unverified-doctor", { verified: false });

    const queue = await doctor.agent.get("/api/v1/triage-review?status=ALL");
    const profile = await doctor.agent.get("/api/v1/triage-review/profile/hpcsa");

    expect(queue.status).toBe(403);
    expect(queue.body.code).toBe("CREDENTIAL_UNVERIFIED");
    expect(profile.status).toBe(200);
  });
});

describe("per-patient, time-bound access", () => {
  it("hides a patient's details from their nurse once access has expired, and audits the attempt", async () => {
    const patient = await register("PATIENT", "expiry-patient");
    const nurse = await register("NURSE", "expiry-nurse");
    const { visit } = await seedVisit(patient.userId, nurse.userId);
    const before = await nurse.agent.get(`/api/v1/visits/${visit.id}`);
    expect(before.status).toBe(200);
    expect(before.body.visit.booking.address).toBe("7 Private Road");

    await prisma.patientAccessGrant.updateMany({ where: { clinicianId: nurse.userId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const detail = await nurse.agent.get(`/api/v1/visits/${visit.id}`);
    expect(detail.status).toBe(403);
    expect(detail.body.code).toBe("NO_CARE_ACCESS");
    const list = await nurse.agent.get("/api/v1/nurse/visits");
    const row = list.body.visits.find((v: any) => v.id === visit.id);
    expect(row.restricted).toBe("ACCESS_EXPIRED");
    expect(row.booking).not.toHaveProperty("address");
    expect(row).not.toHaveProperty("nurseReport");
    const denied = await prisma.auditLog.findFirst({ where: { userId: nurse.userId, action: "ACCESS_DENIED", resourceId: visit.id } });
    expect(denied).not.toBeNull();
  });

  it("winds the nurse's access down to the documentation window when the visit completes", async () => {
    const patient = await register("PATIENT", "window-patient");
    const nurse = await register("NURSE", "window-nurse");
    const { visit } = await seedVisit(patient.userId, nurse.userId, { status: "IN_PROGRESS" });
    await prisma.patientAccessGrant.updateMany({ where: { sourceId: visit.id }, data: { expiresAt: new Date(Date.now() + 10 * 24 * 3600_000) } });

    const res = await nurse.agent.patch(`/api/v1/visits/${visit.id}/status`).send({ status: "COMPLETED" });

    expect(res.status).toBe(200);
    const grant = await prisma.patientAccessGrant.findFirstOrThrow({ where: { sourceId: visit.id, clinicianId: nurse.userId } });
    expect(grant.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 3600_000 + 5000);
  });

  it("does not let a nurse with access to one patient read another patient's visit", async () => {
    const patientA = await register("PATIENT", "scope-a");
    const patientB = await register("PATIENT", "scope-b");
    const nurse = await register("NURSE", "scope-nurse");
    await seedVisit(patientA.userId, nurse.userId);
    const { visit: visitB } = await seedVisit(patientB.userId, nurse.userId, { grant: false });

    const res = await nurse.agent.get(`/api/v1/visits/${visitB.id}`);

    expect(res.status).toBe(403);
  });
});

describe("minimum necessary until claimed", () => {
  it("shows an unclaimed triage case with acuity only, and the full case after claiming", async () => {
    const patient = await register("PATIENT", "triage-patient");
    const doctor = await register("DOCTOR", "triage-doctor");
    const tc = await seedTriageCase(patient.userId);

    const queue = await doctor.agent.get("/api/v1/triage-review?status=ALL");
    const listed = queue.body.cases.find((c: any) => c.id === tc.id);
    expect(listed.restricted).toBe("NOT_CLAIMED");
    expect(listed.aiTriageLevel).toBe(2);
    expect(listed).not.toHaveProperty("symptoms");
    expect(listed).not.toHaveProperty("patient");

    const claim = await doctor.agent.post(`/api/v1/triage-review/${tc.id}/claim`).send({});
    expect(claim.status).toBe(200);
    expect(claim.body.triageCase.symptoms).toContain("chest pain");
    const grant = await prisma.patientAccessGrant.findFirst({ where: { clinicianId: doctor.userId, patientId: patient.userId, reason: "TRIAGE_CASE" } });
    expect(grant).not.toBeNull();
  });

  it("refuses to act on an unclaimed case, and a second doctor can't take a claimed one", async () => {
    const patient = await register("PATIENT", "triage-patient2");
    const first = await register("DOCTOR", "triage-first");
    const second = await register("DOCTOR", "triage-second");
    const tc = await seedTriageCase(patient.userId);

    const early = await first.agent.post(`/api/v1/triage-review/${tc.id}/review`).send({ doctorNotes: "n", doctorDiagnosis: "d", finalTriageLevel: 2 });
    expect(early.status).toBe(409);

    await first.agent.post(`/api/v1/triage-review/${tc.id}/claim`).send({});
    const steal = await second.agent.post(`/api/v1/triage-review/${tc.id}/claim`).send({});
    expect(steal.status).toBe(400); // "Case is not available for claim"
    const act = await second.agent.post(`/api/v1/triage-review/${tc.id}/review`).send({ doctorNotes: "n", doctorDiagnosis: "d", finalTriageLevel: 2 });
    expect(act.status).toBe(403);
    expect(await prisma.patientAccessGrant.count({ where: { clinicianId: second.userId } })).toBe(0);
  });

  it("closes the doctor's access to the post-case window when the case is released", async () => {
    const patient = await register("PATIENT", "triage-release-patient");
    const doctor = await register("DOCTOR", "triage-release-doctor");
    const tc = await seedTriageCase(patient.userId);
    await doctor.agent.post(`/api/v1/triage-review/${tc.id}/claim`).send({});
    const review = await doctor.agent.post(`/api/v1/triage-review/${tc.id}/review`).send({ doctorNotes: "Seen", doctorDiagnosis: "Angina", finalTriageLevel: 2 });
    expect(review.status).toBe(200);

    const release = await doctor.agent.post(`/api/v1/triage-review/${tc.id}/release`).send({});

    expect(release.status).toBe(200);
    const grant = await prisma.patientAccessGrant.findFirstOrThrow({ where: { sourceId: tc.id, clinicianId: doctor.userId } });
    expect(grant.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 72 * 3600_000 + 5000);
  });

  it("shows an unclaimed visit review without the nurse's report, and the report after claiming", async () => {
    const patient = await register("PATIENT", "review-min-patient");
    const nurse = await register("NURSE", "review-min-nurse");
    const doctor = await register("DOCTOR", "review-min-doctor");
    const { visit } = await seedVisit(patient.userId, nurse.userId, { status: "COMPLETED" });

    const queue = await doctor.agent.get("/api/v1/visits?status=PENDING_REVIEW");
    const row = queue.body.visits.find((v: any) => v.id === visit.id);
    expect(row.restricted).toBe("NOT_CLAIMED");
    expect(row).not.toHaveProperty("nurseReport");

    const claim = await doctor.agent.post(`/api/v1/visits/${visit.id}/claim-review`).send({});
    expect(claim.status).toBe(200);
    expect(claim.body.visit.nurseReport).toBe("Patient stable.");
  });
});

describe("admins administer access but don't read clinical content", () => {
  it("gives admins the operational view of visits and bookings, not addresses or reports", async () => {
    const admin = await register("ADMIN", "sod-admin");
    const patient = await register("PATIENT", "sod-patient");
    const nurse = await register("NURSE", "sod-nurse");
    const { visit, booking } = await seedVisit(patient.userId, nurse.userId);

    const detail = await admin.agent.get(`/api/v1/visits/${visit.id}`);
    const bookingRes = await admin.agent.get(`/api/v1/bookings/${booking.id}`);
    const messages = await admin.agent.get(`/api/v1/messages/visit/${visit.id}`);

    expect(detail.status).toBe(200);
    expect(detail.body.visit.restricted).toBe("ADMIN_VIEW");
    expect(detail.body.visit).not.toHaveProperty("nurseReport");
    expect(detail.body.visit.booking).not.toHaveProperty("address");
    expect(bookingRes.body.booking.restricted).toBe("ADMIN_VIEW");
    expect(bookingRes.body.booking).not.toHaveProperty("address");
    expect(messages.status).toBe(403);
  });

  it("lets an admin grant a verified clinician time-bound access to one patient, and revoke it", async () => {
    const admin = await register("ADMIN", "grant-admin");
    const patient = await register("PATIENT", "grant-patient");
    const doctor = await register("DOCTOR", "grant-doctor");
    const unverified = await register("NURSE", "grant-unverified", { verified: false });

    const refused = await admin.agent.post("/api/v1/access-grants").send({ clinicianId: unverified.userId, patientId: patient.userId, hours: 24, justification: "Covering for colleague" });
    expect(refused.status).toBe(400);
    const selfGrant = await admin.agent.post("/api/v1/access-grants").send({ clinicianId: admin.userId, patientId: patient.userId, hours: 24, justification: "Just looking" });
    expect(selfGrant.status).toBe(400);

    const granted = await admin.agent.post("/api/v1/access-grants").send({ clinicianId: doctor.userId, patientId: patient.userId, hours: 24, justification: "Second opinion requested by Dr X" });
    expect(granted.status).toBe(201);
    const stored = await prisma.patientAccessGrant.findUniqueOrThrow({ where: { id: granted.body.grant.id } });
    expect(stored.reason).toBe("ADMIN_GRANT");
    expect(stored.grantedById).toBe(admin.userId);
    expect(isEncryptedPayload(stored.justification!)).toBe(true);
    const listed = await admin.agent.get(`/api/v1/access-grants?view=active&patientId=${patient.userId}`);
    expect(listed.body.grants[0].justification).toBe("Second opinion requested by Dr X");

    const revoke = await admin.agent.post(`/api/v1/access-grants/${granted.body.grant.id}/revoke`).send({ reason: "No longer needed" });
    expect(revoke.status).toBe(200);
    const mine = await doctor.agent.get("/api/v1/access-grants/mine");
    expect(mine.body.grants.map((g: any) => g.patient.id)).not.toContain(patient.userId);
  });

  it("stops non-admins from granting access", async () => {
    const doctor = await register("DOCTOR", "grant-non-admin");
    const patient = await register("PATIENT", "grant-non-admin-patient");
    const res = await doctor.agent.post("/api/v1/access-grants").send({ clinicianId: doctor.userId, patientId: patient.userId, hours: 24, justification: "Giving myself access" });
    expect(res.status).toBe(403);
  });
});

describe("break-glass and the patient's access log", () => {
  it("gives a short, justified emergency grant that an admin reviews and the patient can see", async () => {
    const admin = await register("ADMIN", "bg-admin");
    const patient = await register("PATIENT", "bg-patient");
    const doctor = await register("DOCTOR", "bg-doctor");

    const tooShort = await doctor.agent.post("/api/v1/access-grants/break-glass").send({ patientId: patient.userId, justification: "urgent" });
    expect(tooShort.status).toBe(400);

    const res = await doctor.agent.post("/api/v1/access-grants/break-glass").send({ patientId: patient.userId, justification: "Patient collapsed at clinic, treating doctor unreachable" });
    expect(res.status).toBe(201);
    expect(new Date(res.body.grant.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 4 * 3600_000 + 5000);

    const pending = await admin.agent.get("/api/v1/access-grants?view=break-glass-review");
    const entry = pending.body.grants.find((g: any) => g.id === res.body.grant.id);
    expect(entry.justification).toContain("collapsed");
    const reviewed = await admin.agent.post(`/api/v1/access-grants/${res.body.grant.id}/review`).send({ note: "Appropriate use" });
    expect(reviewed.status).toBe(200);

    const log = await patient.agent.get("/api/v1/access-grants/my-record");
    expect(log.status).toBe(200);
    const seen = log.body.access.find((a: any) => a.id === res.body.grant.id);
    expect(seen.reason).toBe("BREAK_GLASS");
    expect(seen.clinician.registration.body).toBe("HPCSA");
    expect(seen).not.toHaveProperty("justification");
  });

  it("shows a patient only their own access log", async () => {
    const patientA = await register("PATIENT", "log-a");
    const patientB = await register("PATIENT", "log-b");
    const nurse = await register("NURSE", "log-nurse");
    await seedVisit(patientB.userId, nurse.userId);

    const res = await patientA.agent.get("/api/v1/access-grants/my-record");

    expect(res.status).toBe(200);
    expect(res.body.access).toEqual([]);
  });
});

describe("patient record", () => {
  it("opens a patient's record only while the clinician holds access, with notes decrypted", async () => {
    const admin = await register("ADMIN", "record-admin");
    const patient = await register("PATIENT", "record-patient");
    const doctor = await register("DOCTOR", "record-doctor");
    await seedTriageCase(patient.userId);

    const before = await doctor.agent.get(`/api/v1/patient-records/${patient.userId}`);
    expect(before.status).toBe(403);

    await admin.agent.post("/api/v1/access-grants").send({ clinicianId: doctor.userId, patientId: patient.userId, hours: 2, justification: "Referral consult requested" });
    const res = await doctor.agent.get(`/api/v1/patient-records/${patient.userId}`);
    expect(res.status).toBe(200);
    expect(res.body.access.reason).toBe("ADMIN_GRANT");
    expect(res.body.triageCases[0].symptoms).toContain("chest pain");
    expect(res.body.patient).not.toHaveProperty("encryptedAddress");
    const audit = await prisma.auditLog.findFirst({ where: { userId: doctor.userId, action: "READ", resource: "PatientRecord", resourceId: patient.userId } });
    expect(audit).not.toBeNull();

    const adminRead = await admin.agent.get(`/api/v1/patient-records/${patient.userId}`);
    expect(adminRead.status).toBe(403);
  });
});

describe("messages", () => {
  it("only lets a message go to someone on the visit", async () => {
    const patient = await register("PATIENT", "msg-scope-patient");
    const stranger = await register("PATIENT", "msg-scope-stranger");
    const nurse = await register("NURSE", "msg-scope-nurse");
    const { visit } = await seedVisit(patient.userId, nurse.userId);

    const toStranger = await nurse.agent.post("/api/v1/messages").send({ visitId: visit.id, recipientId: stranger.userId, content: "hello" });
    const toPatient = await nurse.agent.post("/api/v1/messages").send({ visitId: visit.id, recipientId: patient.userId, content: "On my way" });

    expect(toStranger.status).toBe(400);
    expect(toPatient.status).toBe(201);
  });
});
