# Confidence calibration

Implemented in `apps/backend/src/services/clinical/calibration.ts`. Keep this
file and the constants in that module in step.

## Two numbers, not one

| | Question | Source |
|---|---|---|
| **Triage confidence** | How sure are we about *how urgent* this is? | Model's own figure, clamped to 0-1. The SATS level is separately floored by the deterministic rules in `triageSafety.ts`. |
| **Diagnostic confidence** | How sure are we about *what it is*? | Model's own figure for the leading diagnosis, **then capped by code**. |

A patient can be clearly critically ill (high triage confidence) with the cause
unproven (moderate diagnostic confidence). Reporting one number hid that.

## Diagnostic confidence caps

Caps only ever lower a value. They are applied in this order and the smallest
wins; every cap that bites is written to `appliedCaps` so a doctor can see why.

| Rule | Cap |
|---|---|
| No microbiological or tissue confirmation of the leading diagnosis | **0.70** |
| Exactly 2 alternative diagnoses still plausible (probability >= 0.15) | 0.55 |
| 3 or more alternatives still plausible | 0.45 |
| No reference evidence was retrievable (existing behaviour) | 0.50 |
| Confirmed (culture, PCR/antigen, smear, histology) | 0.95 (never "certain") |

**Confirmation is checked, not trusted.** The model reports a
`confirmationStatus`. If it claims `microbiologically_confirmed` or
`tissue_confirmed` but the case text contains no stated positive result
(`caseHasConfirmatoryEvidence`), the claim is discarded and the diagnosis is
treated as unconfirmed. The check can only downgrade; it never grants
confirmation. Negative or pending results ("GeneXpert negative", "biopsy
requested") never count.

## Bands

Doctors are shown a band alongside the number. Until there are real outcomes to
calibrate against, the number is a label, not a probability.

| Value | Band |
|---|---|
| < 0.40 | low |
| 0.40 - 0.59 | moderate |
| 0.60 - 0.79 | probable |
| >= 0.80 | high (only reachable with confirmation) |

## What this does not do

* It does not make the model more accurate. It stops a clinically-unconfirmed
  diagnosis from looking certain.
* The thresholds (0.15, 0.55, 0.45, 0.70) are a first, defensible setting. They
  have not been tuned against outcomes. Stage 2 of the rollout plan requires a
  calibration check against real outcomes before any patient-facing use.
* The cap rules are clinical policy and need clinician sign-off
  (`docs/CLINICAL_SIGNOFF_CHECKLIST.md`).
