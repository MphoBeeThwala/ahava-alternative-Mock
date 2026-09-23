# Primary source documents

Source material for clinical thresholds used in this codebase, kept here so a
citation points at an actual file, not just a URL that can change or 404.

## Appendix-VII-Cardiovascular-Risk-Assessment-F2020-4-Version-1.0-1-November-2024.pdf

South African National Department of Health, Appendix VII — Cardiovascular
Risk Assessment (2020-4_Version 1.0, 25 October 2024). Downloaded from
health.gov.za, 2026-09-23. This is the chart `_who2019_non_lab_risk_category`
in `apps/ml-service/engine.py` uses — transcribed and validated (§28), but
still gated behind `WHO_2019_CHART_SIGNED_OFF` pending clinician review —
see `CLINICAL_SIGNOFF_CHECKLIST.md` row 7 and `ENGINEERING_PLAN.md` §27/§28.

Page 2 is the actual chart: a 5×5×7×2×2 colour grid (systolic BP × BMI × age
band × sex × smoking status → one of 4 WHO risk categories), adopted from the
WHO HEARTS technical package (2020), itself based on Kaptoge et al., *Lancet
Glob Health* 2019 (10.1016/S2214-109X(19)30318-3) — Southern Sub-Saharan
Africa non-laboratory-based model.

## WHO-HEARTS-Risk-Based-CVD-Management-2020.pdf

WHO's own HEARTS technical package (Risk-based CVD management module),
downloaded directly from WHO's IRIS repository as a planned cross-check
against the SA document above — same chart, same source, official WHO
copy. Not actually used in the end: the colour-classification method in
§28 turned out not to need it (self-calibrated directly from the SA
chart's own pixels, validated by monotonicity + spot checks instead of a
second source). Kept here in case a clinician reviewing the sign-off wants
an independent copy to compare against.

## chart-crops/

High-resolution (400 DPI) renders of page 2 of the SA NDoH document:

- `page2-2.png` — full page, both sexes, as originally rendered.
- `left_man.png` — Man column only (non-smoker + smoker), full height, all 7
  age bands. Confirmed complete and legible — use this for the sign-off
  visual cross-check.
- `right_woman.png` — Woman column only, same treatment.
- `chart_data_final.json` — the raw 700-cell extracted dataset (colour
  category per sex/smoking/age/SBP/BMI combination) that
  `apps/ml-service/who_2019_chart_data.py` was generated from, kept here so
  the extraction can be independently re-verified without re-running it.

**Status: transcribed and mechanically validated, awaiting clinician
sign-off.** A first attempt at manual cell-by-cell transcription
(2026-09-23) correctly caught itself producing inconsistent results across
repeated passes on the same image and was abandoned rather than shipped —
see `ENGINEERING_PLAN.md` §27. Replaced with programmatic colour
classification against the chart's own self-calibrated palette instead of
human visual reading: 700/700 cells matched with zero ambiguity, zero
monotonicity violations across age/SBP/BMI, 5/5 spot checks against
independently-confirmed cells — see `ENGINEERING_PLAN.md` §28 for the full
method. The data is wired into `engine.py` behind
`WHO_2019_CHART_SIGNED_OFF` (unset/false by default, fails safe) — a named
clinician still needs to review `left_man.png`/`right_woman.png` against
`who_2019_chart_data.py` and the WHO 2019 instrument choice before that
gate is flipped. High confidence in transcription accuracy is not the same
thing as sign-off — don't skip that step because the numbers look clean.
