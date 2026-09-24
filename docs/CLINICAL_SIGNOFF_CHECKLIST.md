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
without a code-level gate blocking them pending signature. Four items
(paediatric TEWS, AH-45.5a, the WHO 2019 chart, and the Framingham
lab-based chart) have an actual enforced env-var gate, fail-safe by
default. Everything else is live in production today, running on the
engineering team's best-sourced judgment, not yet a named clinician's.

**Signed so far**: rows 6, 7 and 10 — Dr. Neo Monareng (HPCSA MP1325247),
2026-09-24. Signing is the clinical attestation; it does not by itself
flip the corresponding env var in any running environment — that's a
separate deployment step, not yet done anywhere as of this record. See
`ENGINEERING_PLAN.md` §31. **Row 11 is new since that sign-off session and
is not yet reviewed** — it did not exist when Dr. Monareng signed rows
6/7/10, so that signature does not cover it.

| # | Item | Location | What needs signing | Enforcement today |
|---|------|----------|---------------------|--------------------|
| 1 | Adult TEWS chart (SATS-aligned vitals scoring) | `apps/backend/src/services/triageThresholds/tews.ts` | The transcribed threshold table itself | None — live |
| 2 | "No discriminator" green-score split (total ≤ 0 → level 5, else 4) | `tews.ts:185-206` | The specific cut point; the spec gives no number for this split | None — live |
| 3 | Age/height band selection rule (worst-of when both apply) | `tews.ts:180-190` | Whether "worst of the two bands" is the correct rule | None — live |
| 4 | Paediatric TEWS charts (younger-child, older-child bands) | `apps/backend/src/services/triageThresholds/paediatricTews.json`, gated in `triageSafety.ts:13` | The transcribed paediatric threshold tables | **`PAEDIATRIC_TEWS_SIGNED_OFF` env var** — defaults unset/false, fails safe to a capped conservative floor (`ENGINEERING_PLAN.md` §12, "Correction accepted and acted on immediately") |
| 5 | Emergency-signs override | referenced in `ENGINEERING_PLAN.md:1073` | The override's own trigger conditions | None — live |
| 6 | WHO 2019 non-lab CVD chart — instrument choice | `apps/ml-service/engine.py`, `_who2019_non_lab_risk_category` | Confirming this instrument (vs. Framingham/QRISK3, rejected in AH-45) is the right regional choice | **SIGNED** — Dr. Neo Monareng, HPCSA MP1325247, 2026-09-24, as part of the row 7 review below (row 7's own scope already included instrument choice; no separate gate exists here, see row 7). |
| 7 | WHO 2019 chart — actual cell values | `apps/ml-service/who_2019_chart_data.py`, `who_2019_chart_lookup.py`, used by `_who2019_non_lab_risk_category` in `engine.py` | ~~Review the transcription (`docs/references/chart-crops/left_man.png`, `right_woman.png` against `who_2019_chart_data.py`) and the WHO 2019 instrument choice, then flip the gate~~ **Done.** | **SIGNED** — Dr. Neo Monareng, HPCSA MP1325247, 2026-09-24. `WHO_2019_CHART_SIGNED_OFF` still defaults unset/false in every environment as of this record — signing is the clinical attestation, flipping the env var in a real environment (local `.env`, Railway, etc.) is a separate deployment action, not yet done — see `ENGINEERING_PLAN.md` §31. |
| 8 | SpO2 indeterminate band (94–96%, NEWS2-based) | `engine.py` `__init__`, `SPO2_INDETERMINATE`; mirrored in `triageSafety.ts` (§11) | The band boundaries and the "escalates only alongside RR deviation" rule | None — live |
| 9 | AH-50 σ floors + persistence rule | `engine.py` `__init__` — `HR_SIGMA_FLOOR`, `RR_SIGMA_FLOOR(_OVER_60)`, `PERSISTENCE_REQUIRED`/`PERSISTENCE_WINDOW`, `HRV_SWC_MULTIPLIER`, `HRV_MIN_CV` | The specific numeric floors (sourced to Quer et al. 2020, Natarajan et al. 2021, per code comments) | None — live |
| 10 | AH-45.5a — BP-check change-detection flag | `apps/ml-service/models.py` (`BpRiskAssessment`), `engine.py` (`_bp_risk_trend`); decision recorded `ENGINEERING_PLAN.md` §25 | ~~Three narrower conditions (not a threshold): (a) AH-50 deviation flags are a reasonable trigger for recommending a cuff reading, (b) flags display as non-diagnostic and cannot alter `cvd_risk.risk_category`, (c) flags cannot suppress/downgrade an AH-43/44 absolute-floor escalation.~~ **Done.** | **SIGNED** — Dr. Neo Monareng, HPCSA MP1325247, 2026-09-24. `BP_CHECK_PROMPT_SIGNED_OFF` still defaults unset/false in every environment as of this record — signing is the clinical attestation, flipping the env var in a real environment is a separate deployment action, not yet done — see `ENGINEERING_PLAN.md` §31. |
| 11 | Framingham lab-based (cholesterol) 10-year CVD score — instrument choice, transcription, and the discordance-vs-WHO-chart band-gap threshold | `apps/ml-service/framingham_lab_data.py`, `framingham_lab_lookup.py`, used by `_framingham_lab_risk` in `engine.py`; decision recorded `ENGINEERING_PLAN.md` §32 | Three things: (a) confirm this is the correct second instrument to run alongside the WHO 2019 chart, (b) review the transcription (plain numeric points table, SA NDoH Appendix VII pages 3-5 — not a colour image like row 7) against `framingham_lab_data.py`, (c) confirm the >=2-band gap used to set `cvd_risk.discordance_flag` (`engine.py`, `_framingham_discordance_band`) is a reasonable threshold — that number is an engineering judgment call, not itself sourced from the primary document. | **`FRAMINGHAM_LAB_CHART_SIGNED_OFF` env var** — defaults unset/false, fails safe to `computable: false` with reason `FRAMINGHAM_LAB_CHART_AWAITING_CLINICIAN_SIGNOFF`. **Not yet signed** — built 2026-09-24, after Dr. Monareng's sign-off session on rows 6/7/10, so that signature doesn't cover it. |

## What actually needs a named clinician

Per `ENGINEERING_PLAN.md` §12's own framing for item #1/#4: a named
HPCSA-registered clinician, ideally a specialist physician for the
CVD/BP-adjacent items (#6–#11), attesting with HPCSA number and date. For
paediatric TEWS (#4) specifically, standard practice would favour a
paediatrician or paediatric emergency clinician given the higher stakes of
an unreviewed chart already gated in code.

Items #6/#7 (WHO chart) additionally need someone to actually transcribe
the chart image into data — that's a data-entry/verification task a
clinician would need to review, not something a signature alone resolves.
Item #11 (Framingham) needs the same transcription review in kind, but not
in difficulty — its source is a plain numeric points table already read as
clean PDF text, not a colour image requiring pixel classification (see
`ENGINEERING_PLAN.md` §32 for why that made it a meaningfully easier, more
reliable transcription than row 7's).

## What this document does not do

It does not supply the missing evidence or signatures itself — it only
makes the existing gap enumerable and findable in one place, so "where did
your thresholds come from" has one real answer instead of a citation to
files that don't exist. Update the "Enforcement today" column if any item
gets a code-level gate added (matching #4's pattern), and update the table
row directly once an item is actually signed (name, HPCSA number, date,
table version — per §12's own stated bar).
