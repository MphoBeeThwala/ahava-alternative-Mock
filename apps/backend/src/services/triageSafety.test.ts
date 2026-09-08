/**
 * Clinical safety net.
 *
 * assessDeterministicRisk is the floor under the AI: whatever the model
 * concludes, a case cannot be triaged less urgently than this function says.
 * These tests pin the thresholds so a refactor cannot quietly relax them.
 */
import { assessDeterministicRisk } from "./triageSafety";

describe("assessDeterministicRisk", () => {
  describe("red-flag symptoms", () => {
    it.each([
      ["unconscious", "patient is unconscious on the floor"],
      ["seizure", "she had a seizure this morning"],
      ["stroke", "I think he is having a stroke"],
      ["not breathing", "the baby is not breathing"],
      ["anaphylaxis", "anaphylaxis after a bee sting"],
      ["suicidal", "I have been feeling suicidal"],
    ])("escalates %s to level 1", (_label: string, narrative: string) => {
      const result = assessDeterministicRisk(narrative);

      expect(result.minTriageLevel).toBe(1);
      expect(result.hardFlags.length).toBeGreaterThan(0);
    });

    it.each([
      ["chest pain", "crushing chest pain for an hour"],
      ["shortness of breath", "shortness of breath when walking"],
      ["severe abdominal pain", "severe abdominal pain since last night"],
    ])("escalates %s to at least level 2", (_label: string, narrative: string) => {
      const result = assessDeterministicRisk(narrative);

      expect(result.minTriageLevel).toBeLessThanOrEqual(2);
    });

    it("does not escalate an ordinary complaint", () => {
      const result = assessDeterministicRisk("mild sore throat for two days");

      expect(result.minTriageLevel).toBeGreaterThan(2);
      expect(result.hardFlags).toHaveLength(0);
    });

    // AH-24 (fixed): the red-flag patterns were anchored with \b and were
    // singular, so "seizures", "collapsing" and similar inflections were
    // never escalated. Pinning the fix so a future refactor can't regress it.
    it.each([
      ["plural seizures", "he is having seizures"],
      ["collapsing (present progressive)", "she is collapsing in the kitchen"],
      ["plural overdoses", "found two empty bottles, suspect overdoses"],
      ["plural strokes", "grandmother has had several strokes"],
    ])("escalates %s to level 1", (_label: string, narrative: string) => {
      const result = assessDeterministicRisk(narrative);

      expect(result.minTriageLevel).toBe(1);
      expect(result.hardFlags.length).toBeGreaterThan(0);
    });

    it("matches the DKA acronym despite input being lower-cased", () => {
      // Regression: the pattern shipped as /\bDKA\b/ against text that is
      // always lower-cased first, so it could never match anything.
      const result = assessDeterministicRisk("brought in with suspected dka, no other symptoms reported");

      expect(result.minTriageLevel).toBeLessThanOrEqual(2);
    });

    it("matches American-spelled diarrhea alongside the British spelling", () => {
      const result = assessDeterministicRisk("chronic diarrhea for three weeks");

      expect(result.minTriageLevel).toBeLessThanOrEqual(2);
    });
  });

  describe("oxygen saturation", () => {
    it("treats SpO2 below 85 as critical", () => {
      const result = assessDeterministicRisk("feeling tired", { oxygenSaturation: 84 });

      expect(result.minTriageLevel).toBe(1);
      expect(result.hardFlags).toContain("CRITICAL_HYPOXEMIA");
    });

    it("treats SpO2 below 90 as severe", () => {
      const result = assessDeterministicRisk("feeling tired", { oxygenSaturation: 88 });

      expect(result.minTriageLevel).toBe(1);
      expect(result.hardFlags).toContain("SEVERE_HYPOXEMIA");
    });

    it("flags SpO2 below 94 for urgent review", () => {
      const result = assessDeterministicRisk("feeling tired", { oxygenSaturation: 92 });

      expect(result.minTriageLevel).toBe(2);
      expect(result.cautionFlags).toContain("LOW_SPO2");
    });

    it("leaves a normal SpO2 alone", () => {
      const result = assessDeterministicRisk("feeling tired", { oxygenSaturation: 98 });

      expect(result.hardFlags).toHaveLength(0);
      expect(result.cautionFlags).not.toContain("LOW_SPO2");
    });
  });

  describe("respiratory rate", () => {
    it("treats tachypnoea at or above 30 as critical", () => {
      const result = assessDeterministicRisk("feeling tired", { respiratoryRate: 30 });

      expect(result.minTriageLevel).toBe(1);
      expect(result.hardFlags).toContain("CRITICAL_RESPIRATORY_RATE");
    });

    it("treats bradypnoea at or below 8 as critical", () => {
      const result = assessDeterministicRisk("feeling tired", { respiratoryRate: 8 });

      expect(result.minTriageLevel).toBe(1);
      expect(result.hardFlags).toContain("CRITICAL_BRADYPNEA");
    });

    it("flags 25 for urgent review", () => {
      const result = assessDeterministicRisk("feeling tired", { respiratoryRate: 25 });

      expect(result.minTriageLevel).toBe(2);
    });
  });

  describe("heart rate", () => {
    it("treats 140 and above as critical", () => {
      const result = assessDeterministicRisk("feeling tired", { heartRateResting: 145 });

      expect(result.minTriageLevel).toBe(1);
      expect(result.hardFlags).toContain("CRITICAL_HEART_RATE");
    });

    it("treats 35 and below as critical", () => {
      const result = assessDeterministicRisk("feeling tired", { heartRateResting: 34 });

      expect(result.minTriageLevel).toBe(1);
      expect(result.hardFlags).toContain("CRITICAL_HEART_RATE");
    });

    it("leaves a resting rate of 72 alone", () => {
      const result = assessDeterministicRisk("feeling tired", { heartRateResting: 72 });

      expect(result.hardFlags).toHaveLength(0);
    });
  });

  describe("temperature", () => {
    it("treats 41 degrees and above as critical", () => {
      const result = assessDeterministicRisk("feeling tired", { temperature: 41.2 });

      expect(result.minTriageLevel).toBe(1);
      expect(result.hardFlags).toContain("CRITICAL_HYPERPYREXIA");
    });

    it("flags 39.5 as high fever", () => {
      const result = assessDeterministicRisk("feeling tired", { temperature: 39.6 });

      expect(result.minTriageLevel).toBeLessThanOrEqual(2);
    });
  });

  describe("missing data", () => {
    it("does not escalate when no vitals are supplied", () => {
      const result = assessDeterministicRisk("mild headache");

      expect(result.minTriageLevel).toBeGreaterThan(2);
    });

    it("ignores null and undefined readings rather than treating them as zero", () => {
      const result = assessDeterministicRisk("mild headache", {
        oxygenSaturation: null,
        heartRateResting: null,
        respiratoryRate: undefined,
        temperature: null,
      });

      expect(result.hardFlags).toHaveLength(0);
      expect(result.minTriageLevel).toBeGreaterThan(2);
    });

    it("takes the most urgent of several abnormal readings", () => {
      const result = assessDeterministicRisk("feeling tired", {
        oxygenSaturation: 92, // level 2 on its own
        respiratoryRate: 32, // level 1 on its own
      });

      expect(result.minTriageLevel).toBe(1);
    });
  });
});
