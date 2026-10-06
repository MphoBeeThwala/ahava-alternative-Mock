"""
Outcome vocabulary and prediction targets.

OUTCOME_TYPES is a contract with the backend (apps/backend/src/services/
research/researchOutcomes.ts); a test on each side pins the two together.
"""
from dataclasses import dataclass
from typing import Optional, Tuple

OUTCOME_TYPES = (
    "HYPERTENSION_DIAGNOSED",
    "DIABETES_DIAGNOSED",
    "CVD_EVENT",
    "ARRHYTHMIA_DIAGNOSED",
    "HOSPITAL_ADMISSION",
    "EMERGENCY_REFERRAL",
    "DEATH",
    "ALERT_CONFIRMED",
    "ALERT_DISMISSED",
    "TRIAGE_REVIEWED",
)


@dataclass(frozen=True)
class Target:
    """What a model is asked to predict.

    A row (one snapshot) is labelled 1 if any of `outcome_types` is recorded
    for that subject in (snapshot day, snapshot day + horizon_days]. Targets
    for a *new diagnosis* also exclude rows where the condition is already
    known (`exclude_if_known`), so a model cannot score well just by reading
    the diagnosis off the input.
    """
    name: str
    outcome_types: Tuple[str, ...]
    horizon_days: int
    description: str
    exclude_if_known: Optional[str] = None  # a feature name; rows where it is 1 are excluded


TARGETS = {
    t.name: t
    for t in (
        Target(
            name="adverse_event_90d",
            outcome_types=("CVD_EVENT", "HOSPITAL_ADMISSION", "EMERGENCY_REFERRAL", "DEATH"),
            horizon_days=90,
            description="Cardiovascular event, hospital admission, emergency referral or death within 90 days",
        ),
        Target(
            name="hypertension_180d",
            outcome_types=("HYPERTENSION_DIAGNOSED",),
            horizon_days=180,
            description="New clinician-confirmed hypertension within 180 days",
            exclude_if_known="hypertension_known",
        ),
        Target(
            name="diabetes_365d",
            outcome_types=("DIABETES_DIAGNOSED",),
            horizon_days=365,
            description="New clinician-confirmed diabetes within 365 days",
            exclude_if_known="diabetes",
        ),
    )
}

# Outcomes the system writes itself, not a clinician's confirmed diagnosis.
AUTOMATIC_TYPES = ("EMERGENCY_REFERRAL", "TRIAGE_REVIEWED")


def get_target(name: str) -> Target:
    try:
        return TARGETS[name]
    except KeyError:
        raise ValueError(f"unknown target {name!r}; known: {', '.join(sorted(TARGETS))}") from None
