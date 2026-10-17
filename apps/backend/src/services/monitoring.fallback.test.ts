/**
 * fallbackAnalysis is the safety net when the ML service cannot be used. Pinning
 * its absolute limits, including the branches that were once unreachable
 * (a broad check placed before the stricter one) and the BP crisis range.
 */
jest.mock("../lib/prisma", () => ({ __esModule: true, default: {} }));

import { fallbackAnalysis } from "./monitoring";

describe("fallbackAnalysis", () => {
  it("flags a crisis-range blood pressure RED", () => {
    const r = fallbackAnalysis({ bloodPressure: { systolic: 201, diastolic: 122 } });
    expect(r.alertLevel).toBe("RED");
    expect(r.anomalies[0]).toMatch(/^bp_crisis_range/);
  });

  it("diastolic alone at 120 is crisis range", () => {
    expect(fallbackAnalysis({ bloodPressure: { systolic: 150, diastolic: 120 } }).alertLevel).toBe("RED");
  });

  it("elevated but not crisis BP is YELLOW", () => {
    expect(fallbackAnalysis({ bloodPressure: { systolic: 150, diastolic: 95 } }).alertLevel).toBe("YELLOW");
  });

  it("normal BP is GREEN", () => {
    expect(fallbackAnalysis({ bloodPressure: { systolic: 118, diastolic: 76 } }).alertLevel).toBe("GREEN");
  });

  it("SpO2 at or below 91 is RED (was unreachable behind the <95 check)", () => {
    expect(fallbackAnalysis({ oxygenSaturation: 91 }).alertLevel).toBe("RED");
    expect(fallbackAnalysis({ oxygenSaturation: 85 }).alertLevel).toBe("RED");
  });

  it("SpO2 92-94 is YELLOW", () => {
    expect(fallbackAnalysis({ oxygenSaturation: 93 }).alertLevel).toBe("YELLOW");
  });

  it("heart rate at 130+ is RED, 101-129 is YELLOW (RED was unreachable)", () => {
    expect(fallbackAnalysis({ heartRate: 135 }).alertLevel).toBe("RED");
    expect(fallbackAnalysis({ heartRateResting: 110 }).alertLevel).toBe("YELLOW");
  });

  it("a critical value is never downgraded by a later milder one", () => {
    const r = fallbackAnalysis({ heartRate: 140, oxygenSaturation: 94, respiratoryRate: 22 });
    expect(r.alertLevel).toBe("RED");
  });

  it("nothing provided is GREEN with full score", () => {
    const r = fallbackAnalysis({});
    expect(r.alertLevel).toBe("GREEN");
    expect(r.readinessScore).toBe(100);
  });
});
