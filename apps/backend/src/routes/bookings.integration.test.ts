/**
 * Booking creation, listing, per-booking authorization, and cancellation —
 * against a real database (same pattern as auth.integration.test.ts /
 * triage.integration.test.ts). Nurse/doctor assignment onto a booking is
 * exercised in visits.integration.test.ts; this file covers what's
 * reachable through bookings.ts alone: patient-only creation, Joi
 * validation, per-role list scoping, and the patient-owner authorization
 * check on GET/PATCH :id.
 */
import request from "supertest";
import { app } from "../index";

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

function futureDate(daysAhead = 2): string {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
}

function validBookingBody(overrides: Record<string, unknown> = {}) {
  return {
    address: "12 Main Road, Cape Town",
    scheduledDate: futureDate(),
    paymentMethod: "CARD",
    amountInCents: 50000,
    patientLat: -33.9249,
    patientLng: 18.4241,
    ...overrides,
  };
}

describe("bookings: create", () => {
  it("creates a booking for an authenticated patient", async () => {
    const { agent } = await registerRole("PATIENT", "booking-create");

    const res = await agent.post("/api/v1/bookings").send(validBookingBody());

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.booking.paymentStatus).toBe("PENDING");
    expect(typeof res.body.notifiedNurses).toBe("number");
  });

  it("rejects a booking request from a NURSE (patient-only route)", async () => {
    const { agent } = await registerRole("NURSE", "booking-wrong-role");

    const res = await agent.post("/api/v1/bookings").send(validBookingBody());

    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated booking request", async () => {
    const res = await request(app).post("/api/v1/bookings").send(validBookingBody());
    expect(res.status).toBe(401);
  });

  it("rejects a booking with neither address nor encryptedAddress", async () => {
    const { agent } = await registerRole("PATIENT", "booking-no-address");
    const body = validBookingBody();
    delete (body as any).address;

    const res = await agent.post("/api/v1/bookings").send(body);

    expect(res.status).toBe(400);
  });

  it("rejects a scheduledDate in the past", async () => {
    const { agent } = await registerRole("PATIENT", "booking-past-date");

    const res = await agent
      .post("/api/v1/bookings")
      .send(validBookingBody({ scheduledDate: new Date(Date.now() - 86_400_000).toISOString() }));

    expect(res.status).toBe(400);
  });

  it("requires insuranceProvider and insuranceMemberNumber when paymentMethod is INSURANCE", async () => {
    const { agent } = await registerRole("PATIENT", "booking-insurance");

    const res = await agent.post("/api/v1/bookings").send(
      validBookingBody({ paymentMethod: "INSURANCE" })
    );

    expect(res.status).toBe(400);
  });

  it("accepts a valid INSURANCE booking with the required fields", async () => {
    const { agent } = await registerRole("PATIENT", "booking-insurance-ok");

    const res = await agent.post("/api/v1/bookings").send(
      validBookingBody({
        paymentMethod: "INSURANCE",
        insuranceProvider: "Discovery Health",
        insuranceMemberNumber: "DH-12345",
      })
    );

    expect(res.status).toBe(201);
    expect(res.body.booking.insuranceStatus).toBe("PENDING_VERIFICATION");
  });
});

describe("bookings: list scoping", () => {
  it("only returns a patient's own bookings, never another patient's", async () => {
    const alice = await registerRole("PATIENT", "booking-list-alice");
    const bob = await registerRole("PATIENT", "booking-list-bob");

    const aliceBooking = await alice.agent.post("/api/v1/bookings").send(validBookingBody());
    expect(aliceBooking.status).toBe(201);
    await bob.agent.post("/api/v1/bookings").send(validBookingBody());

    const list = await alice.agent.get("/api/v1/bookings");

    expect(list.status).toBe(200);
    const ids: string[] = list.body.bookings.map((b: any) => b.id);
    expect(ids).toContain(aliceBooking.body.booking.id);
    expect(list.body.bookings.every((b: any) => b.patient.id === alice.userId)).toBe(true);
  });

  it("decrypts the address for the list response rather than returning ciphertext", async () => {
    const { agent } = await registerRole("PATIENT", "booking-list-decrypt");
    await agent.post("/api/v1/bookings").send(validBookingBody({ address: "42 Long Street" }));

    const list = await agent.get("/api/v1/bookings");

    expect(list.status).toBe(200);
    expect(list.body.bookings[0].address).toBe("42 Long Street");
    expect(list.body.bookings[0].encryptedAddress).toBeUndefined();
  });
});

describe("bookings: get by id authorization", () => {
  it("lets the owning patient read their own booking", async () => {
    const { agent } = await registerRole("PATIENT", "booking-get-owner");
    const created = await agent.post("/api/v1/bookings").send(validBookingBody());

    const res = await agent.get(`/api/v1/bookings/${created.body.booking.id}`);

    expect(res.status).toBe(200);
    expect(res.body.booking.id).toBe(created.body.booking.id);
  });

  it("denies a different patient from reading someone else's booking", async () => {
    const owner = await registerRole("PATIENT", "booking-get-owner2");
    const stranger = await registerRole("PATIENT", "booking-get-stranger");
    const created = await owner.agent.post("/api/v1/bookings").send(validBookingBody());

    const res = await stranger.agent.get(`/api/v1/bookings/${created.body.booking.id}`);

    expect(res.status).toBe(403);
  });

  it("returns 404 for a booking id that doesn't exist", async () => {
    const { agent } = await registerRole("PATIENT", "booking-get-missing");

    const res = await agent.get("/api/v1/bookings/does-not-exist");

    expect(res.status).toBe(404);
  });
});

describe("bookings: cancel", () => {
  it("lets the owning patient cancel and marks payment REFUNDED", async () => {
    const { agent } = await registerRole("PATIENT", "booking-cancel-owner");
    const created = await agent.post("/api/v1/bookings").send(validBookingBody());

    const res = await agent.patch(`/api/v1/bookings/${created.body.booking.id}/cancel`);
    expect(res.status).toBe(200);

    const fetched = await agent.get(`/api/v1/bookings/${created.body.booking.id}`);
    expect(fetched.body.booking.paymentStatus).toBe("REFUNDED");
  });

  it("denies a different patient from cancelling someone else's booking", async () => {
    const owner = await registerRole("PATIENT", "booking-cancel-owner2");
    const stranger = await registerRole("PATIENT", "booking-cancel-stranger");
    const created = await owner.agent.post("/api/v1/bookings").send(validBookingBody());

    const res = await stranger.agent.patch(`/api/v1/bookings/${created.body.booking.id}/cancel`);

    expect(res.status).toBe(403);
  });

  it("returns 404 when cancelling a booking id that doesn't exist", async () => {
    const { agent } = await registerRole("PATIENT", "booking-cancel-missing");

    const res = await agent.patch("/api/v1/bookings/does-not-exist/cancel");

    expect(res.status).toBe(404);
  });

  // The visit-status "already cancelled/completed" guard in cancel only
  // fires once a Visit exists (booking.visit?.status) — a booking with no
  // Visit yet (the only state reachable through bookings.ts alone, since
  // Visit creation requires the nurse-acceptance flow) has nothing to guard
  // against, so re-cancelling here is a no-op 200, not a 400. That guard's
  // 400 branch is exercised once a Visit exists, in
  // visits.integration.test.ts.
  it("cancelling twice with no visit attached is idempotent, not an error", async () => {
    const { agent } = await registerRole("PATIENT", "booking-cancel-twice");
    const created = await agent.post("/api/v1/bookings").send(validBookingBody());

    const first = await agent.patch(`/api/v1/bookings/${created.body.booking.id}/cancel`);
    const second = await agent.patch(`/api/v1/bookings/${created.body.booking.id}/cancel`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });
});
