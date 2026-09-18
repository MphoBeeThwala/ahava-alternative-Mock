/**
 * Messages are scoped to a visit's participants (patient, assigned nurse,
 * assigned doctor, or an admin) — everyone else, including another patient
 * entirely unrelated to the visit, must be denied both read and write.
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

async function seedBookingAndVisit(patientId: string, nurseId: string) {
  const { encryptData } = await import("../utils/encryption");
  const booking = await prisma.booking.create({
    data: {
      patientId,
      nurseId,
      encryptedAddress: encryptData("1 Message Test Lane"),
      scheduledDate: new Date(Date.now() + 3600_000),
      paymentMethod: "CARD",
      paymentStatus: "COMPLETED",
      amountInCents: 50000,
    },
  });
  return prisma.visit.create({
    data: { bookingId: booking.id, nurseId, status: "SCHEDULED", scheduledStart: booking.scheduledDate },
  });
}

describe("messages: authorization scoped to visit participants", () => {
  it("lets the patient send a message to the assigned nurse on their visit", async () => {
    const patient = await registerRole("PATIENT", "msg-patient");
    const nurse = await registerRole("NURSE", "msg-nurse");
    const visit = await seedBookingAndVisit(patient.userId, nurse.userId);

    const res = await patient.agent.post("/api/v1/messages").send({
      visitId: visit.id,
      recipientId: nurse.userId,
      content: "On my way, running 10 minutes late.",
    });

    expect(res.status).toBe(201);
    expect(res.body.message.senderId).toBe(patient.userId);
  });

  it("lets the assigned nurse read the visit's message thread", async () => {
    const patient = await registerRole("PATIENT", "msg-read-patient");
    const nurse = await registerRole("NURSE", "msg-read-nurse");
    const visit = await seedBookingAndVisit(patient.userId, nurse.userId);
    await patient.agent.post("/api/v1/messages").send({
      visitId: visit.id,
      recipientId: nurse.userId,
      content: "Hello nurse",
    });

    const res = await nurse.agent.get(`/api/v1/messages/visit/${visit.id}`);

    expect(res.status).toBe(200);
    expect(res.body.messages.length).toBeGreaterThanOrEqual(1);
    expect(res.body.messages[0].content).toBe("Hello nurse");
  });

  it("denies an unrelated patient from reading another visit's messages", async () => {
    const patient = await registerRole("PATIENT", "msg-deny-patient");
    const nurse = await registerRole("NURSE", "msg-deny-nurse");
    const stranger = await registerRole("PATIENT", "msg-deny-stranger");
    const visit = await seedBookingAndVisit(patient.userId, nurse.userId);

    const res = await stranger.agent.get(`/api/v1/messages/visit/${visit.id}`);

    expect(res.status).toBe(403);
  });

  it("denies an unrelated nurse from posting a message into someone else's visit", async () => {
    const patient = await registerRole("PATIENT", "msg-deny-post-patient");
    const assignedNurse = await registerRole("NURSE", "msg-deny-post-nurse");
    const otherNurse = await registerRole("NURSE", "msg-deny-post-other");
    const visit = await seedBookingAndVisit(patient.userId, assignedNurse.userId);

    const res = await otherNurse.agent.post("/api/v1/messages").send({
      visitId: visit.id,
      recipientId: patient.userId,
      content: "I shouldn't be able to send this",
    });

    expect(res.status).toBe(403);
  });

  it("returns 404 for a message thread on a visit that doesn't exist", async () => {
    const patient = await registerRole("PATIENT", "msg-missing-visit");

    const res = await patient.agent.get("/api/v1/messages/visit/does-not-exist");

    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/messages/visit/anything");
    expect(res.status).toBe(401);
  });
});
