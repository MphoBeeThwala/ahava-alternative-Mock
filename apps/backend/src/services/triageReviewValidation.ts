import { TriageCaseStatus } from "@prisma/client";

export const OVERRIDE_REASON_REQUIRED_ERROR =
  "Override reason is required when changing the AI triage level";

export function resolveTriageOverride(params: {
  aiTriageLevel: number;
  finalTriageLevel?: number | null;
  overrideReason?: string | null;
}) {
  const chosenLevel =
    Number.isInteger(params.finalTriageLevel) &&
    Number(params.finalTriageLevel) >= 1 &&
    Number(params.finalTriageLevel) <= 5
      ? Number(params.finalTriageLevel)
      : params.aiTriageLevel;

  const normalizedOverrideReason =
    typeof params.overrideReason === "string" ? params.overrideReason.trim() : "";

  return {
    chosenLevel,
    normalizedOverrideReason: normalizedOverrideReason || null,
    error:
      chosenLevel !== params.aiTriageLevel && !normalizedOverrideReason
        ? OVERRIDE_REASON_REQUIRED_ERROR
        : null,
  };
}

export function getReviewedStatusError(
  status: TriageCaseStatus,
  actionLabel: string,
): string | null {
  if (status !== TriageCaseStatus.REVIEWED) {
    return `Case must be reviewed before ${actionLabel}`;
  }
  return null;
}
