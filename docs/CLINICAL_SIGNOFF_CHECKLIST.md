# Clinical sign-off checklist

**Purpose:** consolidate every item in this codebase currently awaiting a
named clinician's signature. This document exists because a 2026-09-22
evidence memo (recorded in `ENGINEERING_PLAN.md` §25) cited two companion
files — `claude/clinical-thresholds-spec.md` and
`claude/threshold-transcription-status.md` — that do not exist anywhere in
this repository or elsewhere, confirmed with the user. Rather than
reconstruct files to match a citation that turned out not to point at
anything real, this document is built from what's actually true in the
codebase today: every `grep`-able reference to "sign-off" across
`apps/` and `docs/`, cited by file and line. If an item below turns out to
be wrong or incomplete, fix this file directly — it has no other source of
truth to defer to.

**How to read "Enforcement today"**: per the precedent set in
`ENGINEERING_PLAN.md` §12 ("build and land on main now; sign-off is a
parallel track, not a merge gate"), most items here shipped to `main`
without a code-level gate blocking them pending signature. Exactly one
item (paediatric TEWS) has an actual enforced gate. Everything else is
live in production today, running on the engineering team's best-sourced
judgment, not yet a named clinician's.

| # | Item | Location | What needs signing | Enforcement today |
|---|------|----------|---------------------|--------------------|
| 1 | Adult TEWS chart (SATS-aligned vitals scoring) | `apps/backend/src/services/triageThresholds/tews.ts` | The transcribed threshold table itself | None — live |
| 2 | "No discriminator" green-score split (total ≤ 0 → level 5, else 4) | `tews.ts:185-206` | The specific cut point; the spec gives no number for this split | None — live |
| 3 | Age/height band selection rule (worst-of when both apply) | `tews.ts:180-190` | Whether "worst of the two bands" is the correct rule | None — live |
| 4 | Paediatric TEWS charts (younger-child, older-child bands) | `apps/backend/src/services/triageThresholds/paediatricTews.json`, gated in `triageSafety.ts:13` | The transcribed paediatric threshold tables | **`PAEDIATRIC_TEWS_SIGNED_OFF` env var** — defaults unset/false, fails safe to a capped conservative floor (`ENGINEERING_PLAN.md` §12, "Correction accepted and acted on immediately") |
| 5 | Emergency-signs override | referenced in `ENGINEERING_PLAN.md:1073` | The override's own trigger conditions | None — live |
| 6 | WHO 2019 non-lab CVD chart — instrument choice | `apps/ml-service/engine.py`, `_who2019_non_lab_risk_category` | Confirming this instrument (vs. Framingham/QRISK3, rejected in AH-45) is the right regional choice | None — live (though functionally inert, see #7) |
| 7 | WHO 2019 chart — actual cell values | same function | The chart itself is a colour-coded image in the primary source, not yet transcribed to data | **Structurally blocked regardless of sign-off** — `computable: false`, `reasons_not_computable: ["WHO_2019_CHART_NOT_YET_DIGITIZED"]`. This is a missing-data gap, not just a missing-signature gap — sign-off alone doesn't unblock it. |
| 8 | SpO2 indeterminate band (94–96%, NEWS2-based) | `engine.py` `__init__`, `SPO2_INDETERMINATE`; mirrored in `triageSafety.ts` (§11) | The band boundaries and the "escalates only alongside RR deviation" rule | None — live |
| 9 | AH-50 σ floors + persistence rule | `engine.py` `__init__` — `HR_SIGMA_FLOOR`, `RR_SIGMA_FLOOR(_OVER_60)`, `PERSISTENCE_REQUIRED`/`PERSISTENCE_WINDOW`, `HRV_SWC_MULTIPLIER`, `HRV_MIN_CV` | The specific numeric floors (sourced to Quer et al. 2020, Natarajan et al. 2021, per code comments) | None — live |
| 10 | AH-45.5a — BP-check change-detection flag | `apps/ml-service/models.py` (`BpRiskAssessment`), `engine.py` (`_bp_risk_trend`); decision recorded `ENGINEERING_PLAN.md` §25 | Three narrower conditions (not a threshold): (a) AH-50 deviation flags are a reasonable trigger for recommending a cuff reading, (b) flags display as non-diagnostic and cannot alter `cvd_risk.risk_category`, (c) flags cannot suppress/downgrade an AH-43/44 absolute-floor escalation. (b) and (c) are also verified structurally in code — signature confirms the judgment call, not the code path. | **`BP_CHECK_PROMPT_SIGNED_OFF` env var** — defaults unset/false, fails safe: `prompt_bp_check` stays `false` regardless of detected signals until set. Mirrors row 4's pattern. Underlying `hr_deviation`/`hrv_deviation`/`short_sleep`/`contributing_signals` stay populated even while gated, for retrospective validation only — see `ENGINEERING_PLAN.md` §25 follow-up, 2026-09-23. |

## What actually needs a named clinician

Per `ENGINEERING_PLAN.md` §12's own framing for item #1/#4: a named
HPCSA-registered clinician, ideally a specialist physician for the
CVD/BP-adjacent items (#6–#10), attesting with HPCSA number and date. For
paediatric TEWS (#4) specifically, standard practice would favour a
paediatrician or paediatric emergency clinician given the higher stakes of
an unreviewed chart already gated in code.

Items #6/#7 (WHO chart) additionally need someone to actually transcribe
the chart image into data — that's a data-entry/verification task a
clinician would need to review, not something a signature alone resolves.

## What this document does not do

It does not supply the missing evidence or signatures itself — it only
makes the existing gap enumerable and findable in one place, so "where did
your thresholds come from" has one real answer instead of a citation to
files that don't exist. Update the "Enforcement today" column if any item
gets a code-level gate added (matching #4's pattern), and update the table
row directly once an item is actually signed (name, HPCSA number, date,
table version — per §12's own stated bar).
