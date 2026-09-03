import { TriageCaseStatus } from "@prisma/client";
import {
  getReviewedStatusError,
  OVERRIDE_REASON_REQUIRED_ERROR,
  resolveTriageOverride,
} from "./triageReviewValidation";

describe("triageReviewValidation", () => {
  it("requires an override reason when the final level changes", () => {
    const result = resolveTriageOverride({
      aiTriageLevel: 3,
      finalTriageLevel: 2,
      overrideReason: "   ",
    });

    expect(result.chosenLevel).toBe(2);
    expect(result.error).toBe(OVERRIDE_REASON_REQUIRED_ERROR);
  });

  it("accepts a trimmed override reason when the final level changes", () => {
    const result = resolveTriageOverride({
      aiTriageLevel: 3,
      finalTriageLevel: 2,
      overrideReason: " Concern for airway compromise ",
    });

    expect(result.error).toBeNull();
    expect(result.normalizedOverrideReason).toBe("Concern for airway compromise");
  });

  it("defaults to the AI level when no valid final level is supplied", () => {
    const result = resolveTriageOverride({
      aiTriageLevel: 4,
      finalTriageLevel: null,
      overrideReason: null,
    });

    expect(result.chosenLevel).toBe(4);
    expect(result.error).toBeNull();
  });

  it("requires reviewed status before terminal actions", () => {
    expect(getReviewedStatusError(TriageCaseStatus.ASSIGNED, "issuing a prescription")).toBe(
      "Case must be reviewed before issuing a prescription",
    );
    expect(getReviewedStatusError(TriageCaseStatus.REVIEWED, "release")).toBeNull();
  });
});
