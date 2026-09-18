/**
 * Visit lifecycle and nurse-assignment authorization, against a real
 * database. There is no REST endpoint for a nurse accepting a booking
 * (that happens over the WebSocket connection — see services/websocket.ts,
 * covered separately by websocket.test.ts) — so a Visit row is seeded
 * directly via prisma here, exactly as the WS accept handler would leave
 * it, and the REST surface (visits.ts, nurse.ts) is exercised from there.
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

async function seedBookingAndVisit(patientId: string, nurseId: string, address = "1 Test Lane") {
  const { encryptData } = await import("../utils/encryption");
  const booking = await prisma.booking.create({
    data: {
      patientId,
      nurseId,
      encryptedAddress: encryptData(address),
      scheduledDate: new Date(Date.now() + 3600_000),
      paymentMethod: "CARD",
      paymentStatus: "COMPLETED",
      amountInCents: 50000,
    },
  });
  const visit = await prisma.visit.create({
    data: {
      bookingId: booking.id,
      nurseId,
      status: "SCHEDULED",
      scheduledStart: booking.scheduledDate,
    },
  });
  return { booking, visit };
}

describe("visits: list and get authorization", () => {
  it("shows the visit to the patient, the assigned nurse, but not an unrelated patient", async () => {
    const patient = await registerRole("PATIENT", "visit-patient");
    const nurse = await registerRole("NURSE", "visit-nurse");
    const stranger = await registerRole("PATIENT", "visit-stranger");
    const { visit } = await seedBookingAndVisit(patient.userId, nurse.userId);

    const patientList = await patient.agent.get("/api/v1/visits");
    expect(patientList.status).toBe(200);
    expect(patientList.body.visits.map((v: any) => v.id)).toContain(visit.id);

    const nurseList = await nurse.agent.get("/api/v1/visits");
    expect(nurseList.status).toBe(200);
    expect(nurseList.body.visits.map((v: any) => v.id)).toContain(visit.id);

    const strangerList = await stranger.agent.get("/api/v1/visits");
    expect(strangerList.status).toBe(200);
    expect(strangerList.body.visits.map((v: any) => v.id)).not.toContain(visit.id);
  });

  it("decrypts the booking address on the visit detail view", async () => {
    const patient = await registerRole("PATIENT", "visit-detail-patient");
    const nurse = await registerRole("NURSE", "visit-detail-nurse");
    const { visit } = await seedBookingAndVisit(patient.userId, nurse.userId, "9 Kloof Street");

    const res = await patient.agent.get(`/api/v1/visits/${visit.id}`);

    expect(res.status).toBe(200);
    expect(res.body.visit.booking.address).toBe("9 Kloof Street");
    expect(res.body.visit.booking.encryptedAddress).toBeUndefined();
  });

  it("denies an unrelated nurse from reading someone else's visit", async () => {
    const patient = await registerRole("PATIENT", "visit-get-patient");
    const assignedNurse = await registerRole("NURSE", "visit-get-assigned-nurse");
    const otherNurse = await registerRole("NURSE", "visit-get-other-nurse");
    const { visit } = await seedBookingAndVisit(patient.userId, assignedNurse.userId);

    const res = await otherNurse.agent.get(`/api/v1/visits/${visit.id}`);

    expect(res.status).toBe(403);
  });

  it("returns 404 for a visit id that doesn't exist", async () => {
    const patient = await registerRole("PATIENT", "visit-get-missing");
    const res = await patient.agent.get("/api/v1/visits/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("visits: status updates (nurse only, assigned nurse only)", () => {
  it("lets the assigned nurse update visit status", async () => {
    const patient = await registerRole("PATIENT", "visit-status-patient");
    const nurse = await registerRole("NURSE", "visit-status-nurse");
    const { visit } = await seedBookingAndVisit(patient.userId, nurse.userId);

    const res = await nurse.agent.patch(`/api/v1/visits/${visit.id}/status`).send({ status: "EN_ROUTE" });

    expect(res.status).toBe(200);
    expect(res.body.visit.status).toBe("EN_ROUTE");

    const persisted = await prisma.visit.findUnique({ where: { id: visit.id } });
    expect(persisted!.status).toBe("EN_ROUTE");
  });

  it("denies a different nurse from updating a visit they are not assigned to", async () => {
    const patient = await registerRole("PATIENT", "visit-status-patient2");
    const assignedNurse = await registerRole("NURSE", "visit-status-assigned2");
    const otherNurse = await registerRole("NURSE", "visit-status-other2");
    const { visit } = await seedBookingAndVisit(patient.userId, assignedNurse.userId);

    const res = await otherNurse.agent.patch(`/api/v1/visits/${visit.id}/status`).send({ status: "ARRIVED" });

    expect(res.status).toBe(403);
    const persisted = await prisma.visit.findUnique({ where: { id: visit.id } });
    expect(persisted!.status).toBe("SCHEDULED");
  });

  it("denies a patient from updating visit status (nurse-only route)", async () => {
    const patient = await registerRole("PATIENT", "visit-status-patient3");
    const nurse = await registerRole("NURSE", "visit-status-nurse3");
    const { visit } = await seedBookingAndVisit(patient.userId, nurse.userId);

    const res = await patient.agent.patch(`/api/v1/visits/${visit.id}/status`).send({ status: "ARRIVED" });

    expect(res.status).toBe(403);
  });
});

describe("nurse: profile, availability, own visits", () => {
  it("returns the nurse's own profile with SANC fields, not another user's", async () => {
    const nurse = await registerRole("NURSE", "nurse-profile");

    const res = await nurse.agent.get("/api/v1/nurse/profile");

    expect(res.status).toBe(200);
    expect(res.body.nurse.id).toBe(nurse.userId);
    expect(res.body.nurse).toHaveProperty("sancVerificationStatus");
  });

  it("denies a patient from reading the nurse profile route", async () => {
    const patient = await registerRole("PATIENT", "nurse-profile-patient");

    const res = await patient.agent.get("/api/v1/nurse/profile");

    expect(res.status).toBe(403);
  });

  it("updates nurse availability and location", async () => {
    const nurse = await registerRole("NURSE", "nurse-availability");

    const res = await nurse.agent
      .patch("/api/v1/nurse/availability")
      .send({ isAvailable: true, lat: -33.9, lng: 18.4 });

    expect(res.status).toBe(200);
    expect(res.body.nurse.isAvailable).toBe(true);
    expect(res.body.nurse.lastKnownLat).toBeCloseTo(-33.9);
  });

  it("lists only the requesting nurse's own visits, with decrypted address", async () => {
    const patient = await registerRole("PATIENT", "nurse-visits-patient");
    const nurse = await registerRole("NURSE", "nurse-visits-nurse");
    const otherNurse = await registerRole("NURSE", "nurse-visits-other");
    const { visit } = await seedBookingAndVisit(patient.userId, nurse.userId, "55 Long Street");

    const res = await nurse.agent.get("/api/v1/nurse/visits");
    expect(res.status).toBe(200);
    const found = res.body.visits.find((v: any) => v.id === visit.id);
    expect(found).toBeDefined();
    expect(found.booking.address).toBe("55 Long Street");

    const otherRes = await otherNurse.agent.get("/api/v1/nurse/visits");
    expect(otherRes.body.visits.map((v: any) => v.id)).not.toContain(visit.id);
  });
});
