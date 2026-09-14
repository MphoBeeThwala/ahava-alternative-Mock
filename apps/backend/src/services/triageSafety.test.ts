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

  // Red-team finding, 2026-09-14: the AH-48 negation mask ran to the next
  // clause PUNCTUATION only. Real phrasing routinely joins a denial to a
  // genuine, affirmed symptom with a bare conjunction and no comma —
  // "denies numbness but has severe headache" — and the old pattern erased
  // the real, affirmed "severe headache" right along with the denied
  // "numbness", silently under-triaging a genuine red flag. Fixed by also
  // stopping the mask at a set of contrast/coordination conjunctions.
  describe("negation mask stops at a conjunction, not just punctuation", () => {
    it.each([
      ["but", "denies numbness but has severe headache"],
      ["and", "denies fever and has crushing chest pain"],
      ["however", "denies suicidal ideation however has severe abdominal pain"],
    ])("preserves the real symptom after a denial joined by \"%s\" with no comma", (_label, narrative) => {
      const result = assessDeterministicRisk(narrative);

      expect(result.minTriageLevel).toBeLessThanOrEqual(2);
    });

    it("still fully masks a same-sentence double denial joined by \"and\"", () => {
      // Each "no"/"denies" is matched independently by the negation regex's
      // global flag, so stopping the first one's mask at "and" doesn't leave
      // the second denied symptom exposed — it gets its own mask.
      const result = assessDeterministicRisk("no fever and no chills");

      expect(result.minTriageLevel).toBeGreaterThan(2);
      expect(result.hardFlags).toHaveLength(0);
      expect(result.cautionFlags).toHaveLength(0);
    });

    it("still preserves a comma-separated affirmed symptom (no regression)", () => {
      const result = assessDeterministicRisk("no chest pain, but severe shortness of breath");

      expect(result.minTriageLevel).toBeLessThanOrEqual(2);
    });
  });

  // AH-47/AH-44: vitals scoring is now the real SATS TEWS composite, not
  // independent adult-only thresholds — see triageThresholds/tews.ts. Every
  // vitals-scoring test below passes an adult age so it exercises the TEWS
  // path deliberately, isolated from the AGE_UNKNOWN behavior covered in its
  // own section further down.
  const ADULT = { ageYears: 35 };

  describe("oxygen saturation (NEWS2 Scale 1, absolute, per AH-50 §50.4)", () => {
    it("treats SpO2 at or below 91 as critical", () => {
      const result = assessDeterministicRisk("feeling tired", { oxygenSaturation: 84 }, ADULT);

      expect(result.minTriageLevel).toBe(1);
      expect(result.hardFlags).toContain("NEWS2_SPO2_CRITICAL");
    });

    it("treats SpO2 92-93 as low", () => {
      const result = assessDeterministicRisk("feeling tired", { oxygenSaturation: 92 }, ADULT);

      expect(result.minTriageLevel).toBe(2);
      expect(result.cautionFlags).toContain("NEWS2_SPO2_LOW");
    });

    it("treats SpO2 94-96 as indeterminate rather than reassuring, not on its own", () => {
      const result = assessDeterministicRisk("feeling tired", { oxygenSaturation: 95 }, ADULT);

      expect(result.cautionFlags).toContain("SPO2_INDETERMINATE_CONSUMER_DEVICE");
      // No respiratory-rate deviation alongside it — doesn't escalate on its own.
      expect(result.minTriageLevel).toBeGreaterThanOrEqual(4);
    });

    it("escalates an indeterminate SpO2 when a respiratory-rate deviation is also present", () => {
      const result = assessDeterministicRisk(
        "feeling tired",
        { oxygenSaturation: 95, respiratoryRate: 24 },
        ADULT
      );

      expect(result.minTriageLevel).toBeLessThanOrEqual(2);
    });

    it("leaves SpO2 at or above 97 alone", () => {
      const result = assessDeterministicRisk("feeling tired", { oxygenSaturation: 98 }, ADULT);

      expect(result.cautionFlags).not.toContain("SPO2_INDETERMINATE_CONSUMER_DEVICE");
      expect(result.cautionFlags).not.toContain("NEWS2_SPO2_LOW");
      expect(result.hardFlags).not.toContain("NEWS2_SPO2_CRITICAL");
    });
  });

  describe("TEWS vitals scoring — adult band", () => {
    it("scores severe tachypnoea (>29) as a discriminator, not an automatic level 1", () => {
      // AH-47: a single TEWS parameter can score at most 2-3 points; RED
      // needs a total of >=7. An isolated abnormal RR alone lands well short
      // of that — the emergency-signs override (level1Patterns), not a raw
      // RR threshold, is what SATS relies on to catch a truly critical
      // single presentation. This is an intentional, sourced behavior
      // change from the old ad-hoc "RR>=30 is automatic critical" heuristic.
      const result = assessDeterministicRisk("feeling tired", { respiratoryRate: 30 }, ADULT);

      expect(result.cautionFlags).toContain("TEWS_RESPIRATORY_RATE_SCORE_+2");
      expect(result.minTriageLevel).toBeGreaterThan(2);
    });

    it("scores severe tachycardia (>129) as a discriminator", () => {
      const result = assessDeterministicRisk("feeling tired", { heartRateResting: 145 }, ADULT);

      expect(result.hardFlags).toContain("TEWS_HEART_RATE_SCORE_+3");
    });

    it("scores severe bradycardia (<41) with the same magnitude as tachycardia, not a cancelling negative", () => {
      // Interpretation flag (see tews.ts's contributionOf): the total sums
      // the magnitude of a physiological parameter's deviation regardless
      // of direction, matching every comparable early-warning score (NEWS2,
      // MEWS) — a literal signed sum would let bradycardia and tachycardia
      // cancel each other out, which cannot be the real algorithm.
      const result = assessDeterministicRisk("feeling tired", { heartRateResting: 34 }, ADULT);

      expect(result.hardFlags).toContain("TEWS_HEART_RATE_SCORE_-3");
      expect(result.minTriageLevel).toBeLessThanOrEqual(3);
    });

    it("does not flag a fully normal, alert, ambulatory adult", () => {
      const result = assessDeterministicRisk(
        "feeling fine",
        {
          heartRateResting: 72,
          respiratoryRate: 16,
          temperature: 36.8,
          avpu: "alert",
          mobility: "normal",
          trauma: false,
        },
        ADULT
      );

      expect(result.hardFlags).toHaveLength(0);
      expect(result.minTriageLevel).toBe(5);
    });

    it("takes the most urgent of several abnormal readings", () => {
      const result = assessDeterministicRisk(
        "feeling tired",
        { oxygenSaturation: 92, respiratoryRate: 32 },
        ADULT
      );

      expect(result.minTriageLevel).toBeLessThanOrEqual(2);
    });

    it("flags missing TEWS parameters rather than assuming them normal", () => {
      const result = assessDeterministicRisk("feeling tired", { respiratoryRate: 30 }, ADULT);

      expect(result.cautionFlags).toContain("TEWS_MISSING_HEART_RATE");
      expect(result.cautionFlags).toContain("TEWS_MISSING_AVPU");
    });
  });

  describe("TEWS vitals scoring — paediatric bands", () => {
    // These tests exercise the paediatric TEWS math itself, which — per the
    // §12 follow-up (docs/ENGINEERING_PLAN.md) — is gated off by default in
    // production pending clinician sign-off. Enable it here so these tests
    // verify the real scoring logic; the gate's own default-off behavior is
    // covered separately in "paediatric TEWS sign-off gate" below.
    const originalEnv = process.env.PAEDIATRIC_TEWS_SIGNED_OFF;
    beforeEach(() => {
      process.env.PAEDIATRIC_TEWS_SIGNED_OFF = "true";
    });
    afterEach(() => {
      if (originalEnv === undefined) delete process.env.PAEDIATRIC_TEWS_SIGNED_OFF;
      else process.env.PAEDIATRIC_TEWS_SIGNED_OFF = originalEnv;
    });

    it("does not flag a well, alert infant", () => {
      const result = assessDeterministicRisk(
        "well baby check",
        {
          heartRateResting: 100,
          respiratoryRate: 30,
          temperature: 36.8,
          avpu: "alert",
          mobility: "normal",
          trauma: false,
        },
        { ageYears: 1 }
      );

      expect(result.hardFlags).toHaveLength(0);
      expect(result.cautionFlags).toHaveLength(0);
      expect(result.minTriageLevel).toBe(5);
    });

    it("escalates a febrile, tachycardic infant responding only to voice", () => {
      const result = assessDeterministicRisk(
        "fever",
        { heartRateResting: 165, respiratoryRate: 55, temperature: 39.0, avpu: "voice" },
        { ageYears: 1 }
      );

      expect(result.minTriageLevel).toBeLessThanOrEqual(2);
      expect(result.cautionFlags).toContain("TEWS_AVPU_SCORE_-1");
    });

    it("§47.4: the emergency-signs override still forces level 1 for stridor even when the TEWS total alone would not", () => {
      const result = assessDeterministicRisk(
        "child has stridor and is struggling to breathe",
        {
          heartRateResting: 100,
          respiratoryRate: 22,
          temperature: 37.0,
          avpu: "alert",
          mobility: "normal",
          trauma: false,
        },
        { ageYears: 5 }
      );

      expect(result.minTriageLevel).toBe(1);
      expect(result.hardFlags).toContain("CRITICAL_SYMPTOM_PATTERN");
    });

    it("§47.2: resolves an age/height band disagreement by using whichever band scores more urgently", () => {
      // 13 years old (adult band by age) but 90cm tall (younger-child band
      // by height) — a plausible small-for-age presentation. Neither band
      // is silently preferred; the more urgent of the two wins.
      const result = assessDeterministicRisk(
        "feeling tired",
        { heartRateResting: 165 }, // critical for younger child (>=160), unremarkable for an adult
        { ageYears: 13, heightCm: 90 }
      );

      expect(
        [...result.hardFlags, ...result.cautionFlags].some((f) => f.startsWith("TEWS_HEART_RATE_SCORE_"))
      ).toBe(true);
    });
  });

  describe("paediatric TEWS sign-off gate (docs/ENGINEERING_PLAN.md §12)", () => {
    const CHILD_VITALS = {
      heartRateResting: 165,
      respiratoryRate: 55,
      temperature: 39.0,
      avpu: "voice" as const,
    };
    afterEach(() => {
      delete process.env.PAEDIATRIC_TEWS_SIGNED_OFF;
    });

    it("defaults OFF: caps at level 2 with a clear flag instead of applying paediatric TEWS", () => {
      delete process.env.PAEDIATRIC_TEWS_SIGNED_OFF;
      const result = assessDeterministicRisk("fever", CHILD_VITALS, { ageYears: 1 });

      expect(result.hardFlags).toContain("PAEDIATRIC_TEWS_PENDING_CLINICIAN_SIGNOFF");
      expect(result.minTriageLevel).toBe(2);
      expect(result.hardFlags.some((f) => f.startsWith("TEWS_"))).toBe(false);
    });

    it("the emergency-signs override still fires regardless of the gate", () => {
      delete process.env.PAEDIATRIC_TEWS_SIGNED_OFF;
      const result = assessDeterministicRisk("child has stridor", CHILD_VITALS, { ageYears: 1 });

      expect(result.minTriageLevel).toBe(1);
      expect(result.hardFlags).toContain("CRITICAL_SYMPTOM_PATTERN");
    });

    it("adult scoring is unaffected by the gate", () => {
      delete process.env.PAEDIATRIC_TEWS_SIGNED_OFF;
      const result = assessDeterministicRisk("feeling tired", { heartRateResting: 145 }, { ageYears: 35 });

      expect(result.hardFlags).toContain("TEWS_HEART_RATE_SCORE_+3");
    });

    it("enabling the flag restores real TEWS scoring for children", () => {
      process.env.PAEDIATRIC_TEWS_SIGNED_OFF = "true";
      const result = assessDeterministicRisk("fever", CHILD_VITALS, { ageYears: 1 });

      expect(result.hardFlags).not.toContain("PAEDIATRIC_TEWS_PENDING_CLINICIAN_SIGNOFF");
      expect(result.hardFlags.some((f) => f.startsWith("TEWS_"))).toBe(true);
    });
  });

  describe("§47.1: age unknown", () => {
    it("caps at level 2 and flags AGE_UNKNOWN rather than silently applying the adult chart", () => {
      const result = assessDeterministicRisk("mild headache", { oxygenSaturation: 98 });

      expect(result.hardFlags).toContain("AGE_UNKNOWN");
      expect(result.minTriageLevel).toBe(2);
    });

    it("treats null/undefined vitals fields the same as AGE_UNKNOWN with no other findings", () => {
      const result = assessDeterministicRisk("mild headache", {
        oxygenSaturation: null,
        heartRateResting: null,
        respiratoryRate: undefined,
        temperature: null,
      });

      expect(result.hardFlags).toContain("AGE_UNKNOWN");
      expect(result.minTriageLevel).toBe(2);
    });

    it("does not apply AGE_UNKNOWN when there are no vitals to score at all", () => {
      const result = assessDeterministicRisk("mild headache");

      expect(result.hardFlags).not.toContain("AGE_UNKNOWN");
      expect(result.minTriageLevel).toBeGreaterThan(2);
    });

    it("still lets a symptom-text override take precedence over the AGE_UNKNOWN floor", () => {
      const result = assessDeterministicRisk("he is having seizures", { oxygenSaturation: 98 });

      expect(result.minTriageLevel).toBe(1);
    });

    it("height alone is sufficient — age is not required if height is known", () => {
      const result = assessDeterministicRisk("feeling tired", { heartRateResting: 90 }, { heightCm: 200 });

      expect(result.hardFlags).not.toContain("AGE_UNKNOWN");
    });
  });

  describe("missing data", () => {
    it("does not escalate when no vitals are supplied", () => {
      const result = assessDeterministicRisk("mild headache");

      expect(result.minTriageLevel).toBeGreaterThan(2);
    });
  });
});
