# Primary source documents

Source material for clinical thresholds used in this codebase, kept here so a
citation points at an actual file, not just a URL that can change or 404.

## Appendix-VII-Cardiovascular-Risk-Assessment-F2020-4-Version-1.0-1-November-2024.pdf

South African National Department of Health, Appendix VII — Cardiovascular
Risk Assessment (2020-4_Version 1.0, 25 October 2024). Downloaded from
health.gov.za, 2026-09-23. This is the chart `_who2019_non_lab_risk_category`
in `apps/ml-service/engine.py` currently refuses to score
(`WHO_2019_CHART_NOT_YET_DIGITIZED`) — see `CLINICAL_SIGNOFF_CHECKLIST.md`
row 7 and `ENGINEERING_PLAN.md` §27.

Page 2 is the actual chart: a 5×5×7×2×2 colour grid (systolic BP × BMI × age
band × sex × smoking status → one of 4 WHO risk categories), adopted from the
WHO HEARTS technical package (2020), itself based on Kaptoge et al., *Lancet
Glob Health* 2019 (10.1016/S2214-109X(19)30318-3) — Southern Sub-Saharan
Africa non-laboratory-based model.

## WHO-HEARTS-Risk-Based-CVD-Management-2020.pdf

WHO's own HEARTS technical package (Risk-based CVD management module),
downloaded directly from WHO's IRIS repository as a cross-check against the
SA document above — same chart, same source, official WHO copy. Not yet used
for anything (downloaded before poppler-utils was working in this
environment) — worth checking for a cleaner/higher-fidelity render of the
same chart before final transcription.

## chart-crops/

High-resolution (400 DPI) renders of page 2 of the SA NDoH document, split
for legibility:

- `page2-2.png` — full page, both sexes, as originally rendered.
- `left_man.png` — Man column only (non-smoker + smoker), full height, all 7
  age bands. Confirmed complete and legible.
- `right_woman.png` — Woman column only, same treatment. Confirmed complete
  and legible.

**Status: NOT YET TRANSCRIBED.** A first attempt at manual cell-by-cell
transcription (2026-09-23) produced inconsistent results across repeated
passes on the same image — see `ENGINEERING_PLAN.md` §27 for the full
account. Do not trust any transcription of this chart that isn't
independently re-derivable from these two images, and do not skip the
monotonicity check (risk must be non-decreasing with age, BMI, and SBP, for
fixed sex/smoking status) when one is finally produced.
