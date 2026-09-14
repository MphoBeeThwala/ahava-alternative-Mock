/**
 * Found via real manual testing, 2026-09-14, not by inspection: a doctor
 * testing the app submitted "I'm having a panic attack ... No chest pain, no
 * dizziness" and the case came back as a SATS-1 cardiopulmonary emergency.
 *
 * deriveFallbackOpinion (the heuristic used both when both AI providers fail
 * and whenever the model's own answer looks too generic) matched its
 * emergency branch on the literal substring "chest pain" with zero negation
 * awareness — it can't tell "No chest pain" from "chest pain". Fixed by
 * reusing triageSafety.ts's existing negation mask before this heuristic's
 * own keyword matching runs.
 *
 * This runs analyzeSymptoms for real, unmocked — this test environment has
 * no ANTHROPIC_API_KEY/GEMINI_API_KEY configured, so it reliably exercises
 * conservativeFallback's "no AI provider configured" path (the same
 * fail-safe behavior confirmed in the original clinical scenario report),
 * and the evidence providers (who-icd11 etc.) genuinely attempt and fail a
 * live network call before evidence gathering gives up — hence the longer
 * timeout below.
 */
import { analyzeSymptoms } from "./aiTriage";

describe("analyzeSymptoms — fallback heuristic negation handling", () => {
  it("does not read a denied symptom as an affirmed emergency red flag", async () => {
    const result = await analyzeSymptoms({
      symptoms:
        "I'm having a panic attack, my heart is racing and I feel like I can't catch my breath, " +
        "but I've had these before and they usually pass in 20 minutes. No chest pain, no dizziness.",
    });

    expect(result.triageLevel).toBeGreaterThan(1);
    expect(result.reasoning).not.toContain(
      "Red-flag cardiopulmonary or neurological symptoms were detected",
    );
    expect(result.possibleConditions).not.toContain("Acute cardiopulmonary emergency");
  }, 20000);

  it("still catches the same red flag when it's genuinely affirmed, not denied", async () => {
    const result = await analyzeSymptoms({
      symptoms: "Sudden crushing chest pain radiating to my left arm, started 20 minutes ago.",
    });

    expect(result.triageLevel).toBe(1);
    expect(result.possibleConditions).toContain("Acute cardiopulmonary emergency");
  }, 20000);
});
