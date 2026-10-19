/**
 * Phone health-store sync (Health Connect / Apple Health), against a real
 * database. The ML service is stubbed so the exact payload it receives can be
 * inspected: the point of these tests is that nothing the watch did not
 * measure is ever invented.
 */
import request from "supertest";
import axios from "axios";
import { app } from "../index";
import prisma from "../lib/prisma";

const STRONG_PASSWORD = "Str0ng!Passw0rd";
const URL = "/api/v1/biometrics/health-connect";

async function patient(label: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/register").send({
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    password: STRONG_PASSWORD, firstName: label, lastName: "Patient", role: "PATIENT",
  });
  expect(res.status).toBe(201);
  return { agent, userId: res.body.user.id as string };
}

const latest = (userId: string) => prisma.biometricReading.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });

let post: jest.SpyInstance;
let get: jest.SpyInstance;

beforeEach(() => {
  post = jest.spyOn(axios, "post").mockImplementation(async (url: string) => ({
    data: String(url).includes("/ingest/bp") ? { alert_level: "GREEN", anomalies: [] } : { alert_level: "GREEN", anomalies: [] },
  }));
  get = jest.spyOn(axios, "get").mockResolvedValue({ data: { score: 88, baseline_status: "STABLE" } });
});
afterEach(() => jest.restoreAllMocks());

const ingestCalls = () => post.mock.calls.filter(([u]) => /\/ingest\?/.test(String(u)));

describe("health-connect: access and validation", () => {
  it("needs a signed-in user", async () => {
    expect((await request(app).post(URL).send({ steps: 100 })).status).toBe(401);
  });

  it("rejects an empty sync, unknown fields and impossible values", async () => {
    const p = await patient("hc-validate");
    expect((await p.agent.post(URL).send({})).status).toBe(400);
    expect((await p.agent.post(URL).send({ platform: "android", deviceModel: "Pixel Watch" })).status).toBe(400);
    expect((await p.agent.post(URL).send({ steps: 10, mystery: 1 })).status).toBe(400);
    expect((await p.agent.post(URL).send({ oxygenSaturation: 140 })).status).toBe(400);
    expect((await p.agent.post(URL).send({ platform: "windows", steps: 10 })).status).toBe(400);
    expect((await p.agent.post(URL).send({ bloodPressure: { systolic: 100, diastolic: 125 } })).status).toBe(400);
    expect(await prisma.biometricReading.count({ where: { userId: p.userId } })).toBe(0);
  });
});

describe("health-connect: only measured values are stored and sent", () => {
  it("stores a steps + workout-heart-rate sync without inventing SpO2, respiratory rate or resting HR", async () => {
    const p = await patient("hc-partial");
    const res = await p.agent.post(URL).send({ steps: 8200, activeCalories: 310, heartRateSamples: [90, 100, 110], deviceModel: "Galaxy Watch" });
    expect(res.status).toBe(200);

    const row = await latest(p.userId);
    expect(row.stepCount).toBe(8200);
    expect(row.heartRate).toBe(100); // exercise average
    expect(row.heartRateResting).toBeNull();
    expect(row.oxygenSaturation).toBeNull();
    expect(row.respiratoryRate).toBeNull();
    expect(row.hrvRmssd).toBeNull();
    expect(row.skinTempOffset).toBeNull();
    expect(row.source).toBe("wearable");
    expect(row.deviceType).toBe("Galaxy Watch");
    expect(ingestCalls()).toHaveLength(0); // an incomplete set never reaches the ML baseline
  });

  it("does not treat an exercise heart rate as a resting abnormality", async () => {
    const p = await patient("hc-exercise");
    const res = await p.agent.post(URL).send({ heartRate: 165 });
    expect(res.status).toBe(200);
    expect(res.body.alertLevel).toBe("GREEN");
    expect((await latest(p.userId)).heartRateResting).toBeNull();
  });

  it("sends a complete wearable set to the ML service with the real values", async () => {
    const p = await patient("hc-complete");
    const res = await p.agent.post(URL).send({
      heartRateResting: 58, hrvRmssd: 52, oxygenSaturation: 97, respiratoryRate: 14, sleepDurationHours: 7.5, steps: 5000,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, readinessScore: 88 });
    expect(ingestCalls()).toHaveLength(1);
    expect(ingestCalls()[0][1]).toMatchObject({
      heart_rate_resting: 58, hrv_rmssd: 52, spo2: 97, respiratory_rate: 14, sleep_duration_hours: 7.5, step_count: 5000,
    });
  });

  it("keeps Apple's SDNN out of the RMSSD baseline", async () => {
    const p = await patient("hc-sdnn");
    const res = await p.agent.post(URL).send({
      platform: "ios", heartRateResting: 60, hrvSdnn: 45, oxygenSaturation: 98, respiratoryRate: 15,
    });
    expect(res.status).toBe(200);
    expect((await latest(p.userId)).hrvRmssd).toBeNull();
    expect(ingestCalls()).toHaveLength(0); // no RMSSD, so the set is incomplete
    expect((await latest(p.userId)).deviceType).toBe("apple_health");
  });

  it("checks a partial set against the absolute thresholds and raises an alert for a dangerous SpO2", async () => {
    const p = await patient("hc-low-spo2");
    const res = await p.agent.post(URL).send({ oxygenSaturation: 84 });
    expect(res.status).toBe(200);
    expect(res.body.alertLevel).not.toBe("GREEN");
    expect(await prisma.healthAlert.count({ where: { userId: p.userId } })).toBe(1);
  });
});

describe("health-connect: blood pressure, devices and retries", () => {
  it("sends a measured blood pressure to the ML BP endpoint", async () => {
    const p = await patient("hc-bp");
    post.mockImplementation(async (url: string) => ({
      data: String(url).includes("/ingest/bp") ? { alert_level: "RED", anomalies: ["bp_crisis"] } : { alert_level: "GREEN", anomalies: [] },
    }));
    const res = await p.agent.post(URL).send({ bloodPressure: { systolic: 195, diastolic: 125 } });
    expect(res.status).toBe(200);
    expect(res.body.alertLevel).toBe("RED");
    const bpCall = post.mock.calls.find(([u]) => /\/ingest\/bp\?/.test(String(u)))!;
    expect(bpCall[1]).toMatchObject({ systolic: 195, diastolic: 125 });
    expect((await latest(p.userId)).bloodPressureSystolic).toBe(195);
  });

  it("records the device once in the connected-devices list", async () => {
    const p = await patient("hc-devices");
    await p.agent.post(URL).send({ steps: 100, deviceModel: "Pixel Watch" });
    await p.agent.post(URL).send({ steps: 200, deviceModel: "Pixel Watch" });
    await p.agent.post(URL).send({ steps: 300, deviceModel: "Fitbit Charge" });
    const user: any = await prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
    expect(user.connectedDevices).toEqual(["Pixel Watch", "Fitbit Charge"]);
  });

  it("accepts an Idempotency-Key so the app can retry safely (de-duplication itself needs Redis and is covered in idempotency.test.ts)", async () => {
    const p = await patient("hc-idem");
    const res = await p.agent.post(URL).set("Idempotency-Key", `sync-${Date.now()}-abcdef`).send({ steps: 1234 });
    expect(res.status).toBe(200);
  });

  it("still saves the reading when the ML service is down, using the rule-based check", async () => {
    const p = await patient("hc-ml-down");
    post.mockRejectedValue(new Error("connect ECONNREFUSED"));
    get.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const res = await p.agent.post(URL).send({ heartRateResting: 58, hrvRmssd: 52, oxygenSaturation: 97, respiratoryRate: 14 });
    expect(res.status).toBe(200);
    expect(await prisma.biometricReading.count({ where: { userId: p.userId } })).toBe(1);
  });
});
