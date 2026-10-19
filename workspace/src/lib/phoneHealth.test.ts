import { describe, expect, it } from "vitest";
import { buildSyncPayload, type HealthSampleLike } from "./phoneHealth";

const NOW = new Date("2026-10-19T08:00:00Z");
const s = (value: number, over: Partial<HealthSampleLike> = {}): HealthSampleLike => ({
  value, startDate: "2026-10-19T06:00:00Z", endDate: "2026-10-19T06:05:00Z", ...over,
});
const build = (platform: "android" | "ios", samples: Parameters<typeof buildSyncPayload>[0]["samples"]) =>
  buildSyncPayload({ platform, samples, now: NOW });

describe("buildSyncPayload", () => {
  it("returns null when the phone reported nothing, instead of an empty or invented reading", () => {
    expect(build("android", {})).toBeNull();
    expect(build("android", { heartRate: [], sleep: [], steps: [] })).toBeNull();
  });

  it("includes only the fields the device reported", () => {
    const p = build("android", { steps: [s(1000), s(500)] })!;
    expect(p.steps).toBe(1500);
    for (const k of ["heartRate", "heartRateResting", "hrvRmssd", "hrvSdnn", "oxygenSaturation", "respiratoryRate", "sleepDurationHours", "temperature", "bloodPressure"]) {
      expect(p).not.toHaveProperty(k);
    }
  });

  it("keeps plain heart rate separate from resting heart rate", () => {
    const p = build("android", {
      heartRate: [s(80), s(120), s(100)],
      restingHeartRate: [s(58, { endDate: "2026-10-19T05:00:00Z" }), s(61, { endDate: "2026-10-19T07:00:00Z" })],
    })!;
    expect(p.heartRate).toBe(100);
    expect(p.heartRateResting).toBe(61); // the most recent resting value
  });

  it("sends HRV as RMSSD on Android and SDNN on iPhone, never mixed", () => {
    expect(build("android", { heartRateVariability: [s(40), s(50)] })).toMatchObject({ hrvRmssd: 45 });
    const ios = build("ios", { heartRateVariability: [s(40), s(50)] })!;
    expect(ios.hrvSdnn).toBe(45);
    expect(ios).not.toHaveProperty("hrvRmssd");
  });

  it("normalises blood oxygen fractions to a percentage and averages the readings", () => {
    expect(build("android", { oxygenSaturation: [s(97), s(95)] })!.oxygenSaturation).toBe(96);
    expect(build("ios", { oxygenSaturation: [s(0.97)] })!.oxygenSaturation).toBe(97);
  });

  it("converts Fahrenheit body temperature to Celsius", () => {
    expect(build("ios", { bodyTemperature: [s(98.6, { unit: "fahrenheit" })] })!.temperature).toBeCloseTo(37, 1);
    expect(build("android", { bodyTemperature: [s(36.8, { unit: "celsius" })] })!.temperature).toBe(36.8);
  });

  it("counts only asleep stages toward sleep, in hours", () => {
    const p = build("ios", {
      sleep: [
        s(420, { sleepState: "asleep" }), s(60, { sleepState: "inBed" }), s(30, { sleepState: "awake" }),
        s(90, { sleepState: "rem" }),
      ],
    })!;
    expect(p.sleepDurationHours).toBe(8.5); // (420 + 90) / 60
  });

  it("uses the latest blood pressure and refuses a transposed pair", () => {
    const p = build("android", {
      bloodPressure: [
        s(0, { systolic: 150, diastolic: 95, endDate: "2026-10-19T01:00:00Z" }),
        s(0, { systolic: 122, diastolic: 78, endDate: "2026-10-19T07:00:00Z" }),
      ],
    })!;
    expect(p.bloodPressure).toEqual({ systolic: 122, diastolic: 78 });
    expect(build("android", { bloodPressure: [s(0, { systolic: 80, diastolic: 120 })] })).toBeNull();
  });

  it("ignores non-numeric values and stamps the sync time and platform", () => {
    const p = build("android", { steps: [s(Number.NaN), s(200)], heartRate: [s(Number.NaN)] })!;
    expect(p.steps).toBe(200);
    expect(p).not.toHaveProperty("heartRate");
    expect(p.syncedAt).toBe(NOW.toISOString());
    expect(p.platform).toBe("android");
  });
});
