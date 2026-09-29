/**
 * Nurse dispatch over the real WebSocket server against a real database:
 * go online, receive a nearby booking, accept it. None of this had any test
 * coverage (websocket.test.ts only covers the auth-cache pub/sub helpers),
 * which is how the accept race and the second-tab disconnect bug went
 * unnoticed. index.ts deliberately doesn't start the WebSocket server under
 * NODE_ENV=test, so this file starts its own on an ephemeral port.
 */
import http from "http";
import { AddressInfo } from "net";
import request from "supertest";
import WebSocket, { WebSocketServer } from "ws";
import { app } from "../index";
import prisma from "../lib/prisma";
import { encryptData, encryptPatientLocation } from "../utils/encryption";
import { createWebSocketTicket } from "./authSession";
import { initializeWebSocket, notifyNearbyNurses } from "./websocket";

type Msg = { type?: string; data?: any; error?: string };

let server: http.Server;
let wss: WebSocketServer;
let wsUrl: string;
const openSockets: WebSocket[] = [];

beforeAll(async () => {
  server = http.createServer();
  wss = new WebSocketServer({ server });
  initializeWebSocket(wss);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  wsUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  openSockets.splice(0).forEach((s) => s.close());
});

afterAll(async () => {
  wss.clients.forEach((c) => c.terminate());
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A connected, authenticated socket that records everything it receives. */
async function connect(userId: string, role: string) {
  const ws = new WebSocket(wsUrl);
  openSockets.push(ws);
  const inbox: Msg[] = [];
  const waiters: Array<{ match: (m: Msg) => boolean; resolve: (m: Msg) => void }> = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString()) as Msg;
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (w.match(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const next = (match: (m: Msg) => boolean, timeoutMs = 3000) =>
    new Promise<Msg>((resolve, reject) => {
      const already = inbox.find(match);
      if (already) {
        inbox.splice(inbox.indexOf(already), 1);
        return resolve(already);
      }
      const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
      waiters.push({ match, resolve: (m) => { clearTimeout(timer); inbox.splice(inbox.indexOf(m), 1); resolve(m); } });
    });
  const nextType = (type: string, timeoutMs?: number) => next((m) => m.type === type, timeoutMs);
  const send = (msg: object) => ws.send(JSON.stringify(msg));

  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  send({ type: "AUTH", data: { ticket: createWebSocketTicket(userId, role) } });
  await nextType("AUTHENTICATED");
  return { ws, inbox, next, nextType, send };
}

async function register(role: "PATIENT" | "NURSE", label: string) {
  const res = await request(app).post("/api/v1/auth/register").send({
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    password: "Str0ng!Passw0rd",
    firstName: label,
    lastName: role,
    role,
  });
  expect(res.status).toBe(201);
  return res.body.user.id as string;
}

async function goOnline(userId: string, lat: number, lng: number) {
  const client = await connect(userId, "NURSE");
  client.send({ type: "NURSE_GO_ONLINE", data: { lat, lng } });
  await client.nextType("NURSE_ONLINE_SUCCESS");
  return client;
}

async function createBooking(
  patientId: string,
  { at = CAPE_TOWN, ...overrides }: { at?: { lat: number; lng: number } } & Record<string, unknown> = {},
) {
  return prisma.booking.create({
    data: {
      patientId,
      encryptedPatientLocation: encryptPatientLocation(at.lat, at.lng),
      encryptedAddress: encryptData("12 Test Road"),
      scheduledDate: new Date(Date.now() + 2 * 3600_000),
      paymentMethod: "CARD",
      amountInCents: 45000,
      ...overrides,
    },
  });
}

const CAPE_TOWN = { lat: -33.9249, lng: 18.4241 };
const DURBAN = { lat: -29.8587, lng: 31.0218 };

describe("nurse dispatch over WebSocket", () => {
  it("offers a new booking to online nurses within the radius, not ones far away", async () => {
    const patientId = await register("PATIENT", "ws-offer-patient");
    const near = await goOnline(await register("NURSE", "ws-near"), CAPE_TOWN.lat + 0.01, CAPE_TOWN.lng);
    const far = await goOnline(await register("NURSE", "ws-far"), DURBAN.lat, DURBAN.lng);
    const booking = await createBooking(patientId);

    await notifyNearbyNurses(CAPE_TOWN.lat, CAPE_TOWN.lng, 10, { ...booking, estimatedDuration: 60 }, "Test Patient");

    const offer = await near.next((m) => m.type === "NEW_BOOKING_AVAILABLE" && m.data.bookingId === booking.id);
    expect(offer.data.distanceKm).toBeLessThan(10);
    await new Promise((r) => setTimeout(r, 100));
    expect(far.inbox.some((m) => m.data?.bookingId === booking.id)).toBe(false);
  });

  it("rejects going online without a valid location", async () => {
    const nurse = await connect(await register("NURSE", "ws-no-location"), "NURSE");
    nurse.send({ type: "NURSE_GO_ONLINE", data: { lat: "abc" } });
    const res = await nurse.nextType("NURSE_ONLINE_FAILED");
    expect(res.error).toMatch(/location/i);
  });

  it("gives a booking to exactly one of two nurses who accept at the same moment", async () => {
    const patientId = await register("PATIENT", "ws-race-patient");
    const a = await goOnline(await register("NURSE", "ws-race-a"), CAPE_TOWN.lat, CAPE_TOWN.lng);
    const b = await goOnline(await register("NURSE", "ws-race-b"), CAPE_TOWN.lat, CAPE_TOWN.lng);
    const booking = await createBooking(patientId);

    a.send({ type: "ACCEPT_BOOKING", data: { bookingId: booking.id } });
    b.send({ type: "ACCEPT_BOOKING", data: { bookingId: booking.id } });
    const isResult = (m: Msg) => m.type === "ACCEPT_BOOKING_SUCCESS" || m.type === "ACCEPT_BOOKING_FAILED";
    const results = await Promise.all([a.next(isResult), b.next(isResult)]);

    expect(results.map((r) => r.type).sort()).toEqual(["ACCEPT_BOOKING_FAILED", "ACCEPT_BOOKING_SUCCESS"]);
    expect(results.find((r) => r.type === "ACCEPT_BOOKING_FAILED")!.error).toMatch(/already taken/i);
    expect(await prisma.visit.count({ where: { bookingId: booking.id } })).toBe(1);
  });

  it("refuses a booking the patient has cancelled", async () => {
    const patientId = await register("PATIENT", "ws-cancelled-patient");
    const nurse = await goOnline(await register("NURSE", "ws-cancelled-nurse"), CAPE_TOWN.lat, CAPE_TOWN.lng);
    const booking = await createBooking(patientId, { paymentStatus: "REFUNDED" });

    nurse.send({ type: "ACCEPT_BOOKING", data: { bookingId: booking.id } });

    expect((await nurse.nextType("ACCEPT_BOOKING_FAILED")).error).toMatch(/no longer available/i);
    expect(await prisma.visit.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it("refuses an accept from a nurse who never went online", async () => {
    const patientId = await register("PATIENT", "ws-offline-patient");
    const nurse = await connect(await register("NURSE", "ws-offline-nurse"), "NURSE");
    const booking = await createBooking(patientId);

    nurse.send({ type: "ACCEPT_BOOKING", data: { bookingId: booking.id } });

    expect((await nurse.nextType("ACCEPT_BOOKING_FAILED")).error).toMatch(/go online/i);
  });

  it("keeps a nurse dispatchable when an older tab's socket closes after a newer one connected", async () => {
    const patientId = await register("PATIENT", "ws-tabs-patient");
    const nurseId = await register("NURSE", "ws-tabs-nurse");
    const oldTab = await goOnline(nurseId, CAPE_TOWN.lat, CAPE_TOWN.lng);
    const newTab = await goOnline(nurseId, CAPE_TOWN.lat, CAPE_TOWN.lng);

    await new Promise<void>((resolve) => { oldTab.ws.once("close", () => resolve()); oldTab.ws.close(); });
    await new Promise((r) => setTimeout(r, 100)); // let the server run its close handler
    const booking = await createBooking(patientId);
    await notifyNearbyNurses(CAPE_TOWN.lat, CAPE_TOWN.lng, 10, { ...booking, estimatedDuration: 60 }, "Test Patient");

    await newTab.next((m) => m.type === "NEW_BOOKING_AVAILABLE" && m.data.bookingId === booking.id);
  });

  it("does not let a nurse change the status of a visit that isn't theirs", async () => {
    const patientId = await register("PATIENT", "ws-status-patient");
    const assignedId = await register("NURSE", "ws-status-assigned");
    const intruder = await connect(await register("NURSE", "ws-status-intruder"), "NURSE");
    const booking = await createBooking(patientId, { nurseId: assignedId });
    const visit = await prisma.visit.create({
      data: { bookingId: booking.id, nurseId: assignedId, status: "SCHEDULED", scheduledStart: booking.scheduledDate },
    });

    intruder.send({ type: "VISIT_STATUS_UPDATE", data: { visitId: visit.id, status: "COMPLETED" } });

    await intruder.next((m) => typeof m.error === "string");
    expect((await prisma.visit.findUnique({ where: { id: visit.id } }))!.status).toBe("SCHEDULED");
  });

  it("offers open bookings to a nurse who comes online after they were created, skipping ones they passed on", async () => {
    const patientId = await register("PATIENT", "ws-reoffer-patient");
    const nurseId = await register("NURSE", "ws-reoffer-nurse");
    // A spot of its own, so open bookings left by other tests (or earlier
    // runs against the same database) can't crowd these out of the re-offer cap.
    const here = { lat: -20 - Math.random() * 10, lng: 20 + Math.random() * 10 };
    const waiting = await createBooking(patientId, { at: here });
    const passed = await createBooking(patientId, { at: here });
    const farAway = await createBooking(patientId, { at: { lat: here.lat + 1, lng: here.lng } });
    const cancelled = await createBooking(patientId, { at: here, paymentStatus: "REFUNDED" });

    const first = await goOnline(nurseId, here.lat, here.lng);
    await first.next((m) => m.type === "NEW_BOOKING_AVAILABLE" && m.data.bookingId === waiting.id);
    await first.next((m) => m.type === "NEW_BOOKING_AVAILABLE" && m.data.bookingId === passed.id);
    first.send({ type: "DECLINE_BOOKING", data: { bookingId: passed.id } });
    await first.nextType("DECLINE_BOOKING_SUCCESS");
    const offeredFirst = first.inbox.map((m) => m.data?.bookingId);
    expect(offeredFirst).not.toContain(farAway.id);
    expect(offeredFirst).not.toContain(cancelled.id);

    // Reconnect (e.g. page reload): the booking still waiting comes back, the passed one doesn't.
    first.ws.close();
    const again = await goOnline(nurseId, here.lat, here.lng);
    await again.next((m) => m.type === "NEW_BOOKING_AVAILABLE" && m.data.bookingId === waiting.id);
    await new Promise((r) => setTimeout(r, 150));
    expect(again.inbox.some((m) => m.data?.bookingId === passed.id)).toBe(false);
  });

  describe("availability after a dropped connection", () => {
    const original = process.env.NURSE_OFFLINE_GRACE_MS;
    afterEach(() => {
      if (original === undefined) delete process.env.NURSE_OFFLINE_GRACE_MS;
      else process.env.NURSE_OFFLINE_GRACE_MS = original;
    });

    it("marks the nurse unavailable once the grace period passes without a reconnect", async () => {
      process.env.NURSE_OFFLINE_GRACE_MS = "100";
      const nurseId = await register("NURSE", "ws-stale-nurse");
      const nurse = await goOnline(nurseId, CAPE_TOWN.lat, CAPE_TOWN.lng);
      expect((await prisma.user.findUnique({ where: { id: nurseId } }))!.isAvailable).toBe(true);

      nurse.ws.close();
      await new Promise((r) => setTimeout(r, 500));

      expect((await prisma.user.findUnique({ where: { id: nurseId } }))!.isAvailable).toBe(false);
    });

    it("leaves the nurse available when they reconnect within the grace period", async () => {
      process.env.NURSE_OFFLINE_GRACE_MS = "400";
      const nurseId = await register("NURSE", "ws-reconnect-nurse");
      const first = await goOnline(nurseId, CAPE_TOWN.lat, CAPE_TOWN.lng);

      await new Promise<void>((resolve) => { first.ws.once("close", () => resolve()); first.ws.close(); });
      await new Promise((r) => setTimeout(r, 50));
      await goOnline(nurseId, CAPE_TOWN.lat, CAPE_TOWN.lng);
      await new Promise((r) => setTimeout(r, 700));

      expect((await prisma.user.findUnique({ where: { id: nurseId } }))!.isAvailable).toBe(true);
    });
  });
});
