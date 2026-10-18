/**
 * PayFast checkout creation and the ITN (instant transaction notification)
 * webhook, end to end against a real database. PayFast itself is never called:
 * the two checks that need the network (source-IP DNS lookup and the
 * server-to-server postback) are stubbed, while the signature, amount,
 * idempotency and status handling run for real. This is what lets the code be
 * verified before a PayFast merchant account exists.
 *
 * PayFast posts ITNs as application/x-www-form-urlencoded, so these tests post
 * the same way - the raw body the postback needs must be captured for that
 * content type, not only for JSON.
 */
import crypto from "crypto";
import request from "supertest";
import { app } from "../index";
import prisma from "../lib/prisma";
import { PayFastService } from "../services/payfast";

const STRONG_PASSWORD = "Str0ng!Passw0rd";
const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;

function encode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+").replace(/%[0-9a-f]{2}/g, (m) => m.toUpperCase());
}

/** Fields in posted order, signed the way PayFast signs an ITN (no passphrase configured in tests). */
function signedItn(fields: Record<string, string>): string {
  const sig = crypto
    .createHash("md5")
    .update(Object.entries(fields).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${encode(v)}`).join("&"))
    .digest("hex");
  return Object.entries({ ...fields, signature: sig }).map(([k, v]) => `${k}=${encode(v)}`).join("&");
}

async function register(role: "PATIENT" | "NURSE", label: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/register").send({ email: uniqueEmail(label), password: STRONG_PASSWORD, firstName: label, lastName: role, role });
  expect(res.status).toBe(201);
  return { agent, userId: res.body.user.id as string };
}

async function seedPendingPayment(amountInCents = 50000) {
  const patient = await register("PATIENT", "itn-patient");
  const nurse = await register("NURSE", "itn-nurse");
  const { encryptData } = await import("../utils/encryption");
  const booking = await prisma.booking.create({
    data: { patientId: patient.userId, nurseId: nurse.userId, encryptedAddress: encryptData("1 Test Lane"), scheduledDate: new Date(Date.now() + 3600_000), paymentMethod: "CARD", paymentStatus: "PENDING", amountInCents },
  });
  const visit = await prisma.visit.create({ data: { bookingId: booking.id, nurseId: nurse.userId, status: "SCHEDULED", scheduledStart: booking.scheduledDate } });
  const reference = `AHV-${visit.id}-${crypto.randomUUID()}`;
  const payment = await prisma.payment.create({ data: { visitId: visit.id, amountInCents, status: "PENDING", payfastReference: reference } });
  return { patient, nurse, visit, payment, reference };
}

function itnFields(reference: string, over: Record<string, string> = {}): Record<string, string> {
  return { m_payment_id: reference, pf_payment_id: `pf-${Date.now()}`, payment_status: "COMPLETE", item_name: "Nurse Visit", amount_gross: "500.00", custom_str1: reference, ...over };
}

function postItn(body: string) {
  return request(app).post("/api/v1/payments/webhook").type("form").send(body);
}

let sourceOk: jest.SpyInstance;
let postbackOk: jest.SpyInstance;

beforeEach(() => {
  sourceOk = jest.spyOn(PayFastService.prototype, "isValidSourceIp").mockResolvedValue(true);
  postbackOk = jest.spyOn(PayFastService.prototype, "validateWithPayFast").mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

const statusOf = async (id: string) => (await prisma.payment.findUniqueOrThrow({ where: { id } })).status;

describe("PayFast checkout (create)", () => {
  it("creates a PENDING payment from the booking amount with a unique signed reference", async () => {
    const { patient, visit } = await seedPendingPayment(75000);
    await prisma.payment.deleteMany({ where: { visitId: visit.id } });
    const spy = jest.spyOn(PayFastService.prototype, "createPayment").mockImplementation(async (amount, _item, reference) => ({
      url: "https://sandbox.payfast.co.za/eng/process",
      data: { amount: (amount / 100).toFixed(2), m_payment_id: reference, signature: "sig" } as any,
    }));

    const res = await patient.agent.post("/api/v1/payments/create").send({ visitId: visit.id, amount: 1 });
    expect(res.status).toBe(200);
    expect(spy.mock.calls[0][0]).toBe(75000); // the body's "amount" is ignored
    expect(res.body.payment.status).toBe("PENDING");
    expect(res.body.payment.payfastReference).toMatch(new RegExp(`^AHV-${visit.id}-`));
  });

  it("answers 500 rather than leaking details when PayFast is not configured", async () => {
    const { patient, visit } = await seedPendingPayment();
    await prisma.payment.deleteMany({ where: { visitId: visit.id } });
    const res = await patient.agent.post("/api/v1/payments/create").send({ visitId: visit.id });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/MERCHANT/i);
  });
});

describe("PayFast ITN webhook", () => {
  it("completes the payment for a genuine, correctly signed, form-encoded notification", async () => {
    const { payment, reference } = await seedPendingPayment();
    const res = await postItn(signedItn(itnFields(reference)));
    expect(res.status).toBe(200);
    expect(await statusOf(payment.id)).toBe("COMPLETED");
    // The postback was given PayFast's exact bytes.
    expect(postbackOk.mock.calls[0][0]).toContain(`m_payment_id=${encodeURIComponent(reference)}`);
  });

  it("is idempotent: a repeated notification changes nothing and still answers 200", async () => {
    const { payment, reference } = await seedPendingPayment();
    const body = signedItn(itnFields(reference));
    expect((await postItn(body)).status).toBe(200);
    expect((await postItn(body)).status).toBe(200);
    expect(await statusOf(payment.id)).toBe("COMPLETED");
  });

  it("rejects a bad signature without touching the payment", async () => {
    const { payment, reference } = await seedPendingPayment();
    const tampered = signedItn(itnFields(reference)).replace("amount_gross=500.00", "amount_gross=1.00");
    const res = await postItn(tampered);
    expect(res.status).toBe(400);
    expect(await statusOf(payment.id)).toBe("PENDING");
  });

  it("rejects a notification with no signature", async () => {
    const { payment, reference } = await seedPendingPayment();
    const body = Object.entries(itnFields(reference)).map(([k, v]) => `${k}=${encode(v)}`).join("&");
    expect((await postItn(body)).status).toBe(400);
    expect(await statusOf(payment.id)).toBe("PENDING");
  });

  it("rejects a notification from a source that is not PayFast", async () => {
    sourceOk.mockResolvedValue(false);
    const { payment, reference } = await seedPendingPayment();
    expect((await postItn(signedItn(itnFields(reference)))).status).toBe(403);
    expect(await statusOf(payment.id)).toBe("PENDING");
  });

  it("asks PayFast to retry (500) when the source addresses cannot be resolved", async () => {
    sourceOk.mockRejectedValue(new Error("dns down"));
    const { payment, reference } = await seedPendingPayment();
    expect((await postItn(signedItn(itnFields(reference)))).status).toBe(500);
    expect(await statusOf(payment.id)).toBe("PENDING");
  });

  it("rejects a notification PayFast does not confirm on postback", async () => {
    postbackOk.mockResolvedValue(false);
    const { payment, reference } = await seedPendingPayment();
    expect((await postItn(signedItn(itnFields(reference)))).status).toBe(400);
    expect(await statusOf(payment.id)).toBe("PENDING");
  });

  it("does not complete a payment when the amount paid differs from the amount owed", async () => {
    const { payment, reference } = await seedPendingPayment(50000);
    const res = await postItn(signedItn(itnFields(reference, { amount_gross: "5.00" })));
    expect(res.status).toBe(200); // acknowledged so PayFast stops retrying
    expect(await statusOf(payment.id)).toBe("PENDING");
  });

  it.each([["FAILED", "FAILED"], ["CANCELLED", "FAILED"]])("records a %s notification as %s, never as paid", async (gateway, expected) => {
    const { payment, reference } = await seedPendingPayment();
    expect((await postItn(signedItn(itnFields(reference, { payment_status: gateway })))).status).toBe(200);
    expect(await statusOf(payment.id)).toBe(expected);
  });

  it("acknowledges but ignores an unrecognised status", async () => {
    const { payment, reference } = await seedPendingPayment();
    expect((await postItn(signedItn(itnFields(reference, { payment_status: "PENDING" })))).status).toBe(200);
    expect(await statusOf(payment.id)).toBe("PENDING");
  });

  it("acknowledges a genuine notification for an unknown reference without creating anything", async () => {
    const before = await prisma.payment.count();
    expect((await postItn(signedItn(itnFields("AHV-unknown-ref")))).status).toBe(200);
    expect(await prisma.payment.count()).toBe(before);
  });

  it("also works on the legacy unversioned path PayFast's dashboard may still point at", async () => {
    const { payment, reference } = await seedPendingPayment();
    const res = await request(app).post("/api/payments/webhook").type("form").send(signedItn(itnFields(reference)));
    expect(res.status).toBe(200);
    expect(await statusOf(payment.id)).toBe("COMPLETED");
  });
});
