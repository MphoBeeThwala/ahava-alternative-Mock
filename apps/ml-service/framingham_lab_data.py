"""Framingham lab-based (cholesterol) 10-year CVD risk score.

Transcribed 2026-09-24 from the SA NDoH Appendix VII primary source
(docs/references/Appendix-VII-Cardiovascular-Risk-Assessment-F2020-4-Version-1.0-1-November-2024.pdf,
pages 3-5: "LABORATORY BASED RISK SCREENING — FRAMINGHAM RISK SCORE
(CHOLESTEROL-BASED)"). Unlike who_2019_chart_data.py, this table is plain
digitized text in the source PDF, not a colour-coded image — transcribed
directly from a single clean PDF-text read at the start of this session,
not pixel classification and not multiple reconciled visual passes. Still
NOT clinically signed off — see CLINICAL_SIGNOFF_CHECKLIST.md row 11.
Gated behind FRAMINGHAM_LAB_CHART_SIGNED_OFF in engine.py; do not remove
that gate without sign-off.

This is a different, separate instrument from CvdRiskAssessment's WHO 2019
non-lab chart (who_2019_chart_data.py) — needs total cholesterol, HDL, and
BP-treatment status, none of which the WHO non-lab chart uses. Also not
the same thing as the deleted _framingham_adapted (AH-45, see
docs/ENGINEERING_PLAN.md §12): that function used resting HR and
hypertension as stand-in inputs, which are not real Framingham variables.
This uses the actual instrument's own inputs as printed in the source.

Ranges are (low, high, points) with None meaning unbounded on that side;
low is inclusive, high is exclusive except where the source's own bands
are written as inclusive on both ends (e.g. cholesterol "5.2-6.19"), kept
literal to the source rather than normalized.
"""

# Section A — Age points (5-year bands, 30-79; SBP/cholesterol/HDL bands
# below apply at any age within that range — the source gives one age
# range for the whole page, not per sub-table).
AGE_POINTS = {
    "male": {
        (30, 34): 0, (35, 39): 2, (40, 44): 5, (45, 49): 6, (50, 54): 8,
        (55, 59): 10, (60, 64): 11, (65, 69): 12, (70, 74): 14, (75, 79): 15,
    },
    "female": {
        (30, 34): 0, (35, 39): 2, (40, 44): 4, (45, 49): 5, (50, 54): 7,
        (55, 59): 8, (60, 64): 9, (65, 69): 10, (70, 74): 11, (75, 79): 12,
    },
}

# Total cholesterol (mmol/L) -> points. (low, high, points); high is
# inclusive per the source's own printed bands ("4.1-5.19" etc.).
TOTAL_CHOL_POINTS = {
    "male": [
        (None, 4.1, 0), (4.1, 5.19, 1), (5.2, 6.19, 2), (6.2, 7.2, 3), (7.2, None, 4),
    ],
    "female": [
        (None, 4.1, 0), (4.1, 5.19, 1), (5.2, 6.19, 3), (6.2, 7.2, 4), (7.2, None, 5),
    ],
}

# HDL cholesterol (mmol/L) -> points. Identical for both sexes in the
# source table.
HDL_POINTS = [
    (1.5, None, -2), (1.3, 1.49, -1), (1.2, 1.29, 0), (0.9, 1.119, 1), (None, 0.9, 2),
]

SMOKER_POINTS = {"male": 4, "female": 3}
# *Type 2 diabetics > 40 years of age qualify for statin therapy
# irrespective of risk score — a clinical-management note printed
# alongside the points table, not itself a scoring input. Surfaced as a
# flag (see engine.py), never blended into total_points.
DIABETIC_POINTS = {"male": 3, "female": 4}

# Systolic BP (mmHg) -> points, split by treated/untreated status per sex.
SBP_POINTS = {
    "male": {
        "untreated": [(None, 120, -2), (120, 129, 0), (130, 139, 1), (140, 149, 2), (150, 159, 2), (160, None, 3)],
        "treated":   [(None, 120, 0),  (120, 129, 2), (130, 139, 3), (140, 149, 4), (150, 159, 4), (160, None, 5)],
    },
    "female": {
        "untreated": [(None, 120, -3), (120, 129, 0), (130, 139, 1), (140, 149, 2), (150, 159, 4), (160, None, 5)],
        "treated":   [(None, 120, -1), (120, 129, 2), (130, 139, 3), (140, 149, 5), (150, 159, 6), (160, None, 7)],
    },
}

# Section B — total points -> 10-year risk %. Exact transcription; kept as
# a direct point->percentage map, not a formula. The open-ended rows at
# each table's extremes are handled separately (MEN_MIN_POINTS/MAX_POINTS,
# WOMEN_MIN_POINTS below) rather than forced into this dict, matching
# exactly what the source prints. Do not extrapolate beyond what's here.
MEN_POINTS_TO_RISK = {
    -2: 1.1, -1: 1.4, 0: 1.6, 1: 1.9, 2: 2.3, 3: 2.8, 4: 3.3, 5: 3.9, 6: 4.7,
    7: 5.6, 8: 6.7, 9: 7.9, 10: 9.4, 11: 11.2, 12: 13.2, 13: 15.6, 14: 18.4,
    15: 21.6, 16: 25.3, 17: 29.4,
}
MEN_MIN_POINTS = -3   # source row "<=-3" -> "<1", not an exact percentage
MEN_MAX_POINTS = 18   # source row ">=18" -> ">30", not an exact percentage

WOMEN_POINTS_TO_RISK = {
    -1: 1.0, 0: 1.2, 1: 1.5, 2: 1.7, 3: 2.0, 4: 2.4, 5: 2.8, 6: 3.3, 7: 3.9,
    8: 4.5, 9: 5.3, 10: 6.3, 11: 7.3, 12: 8.6, 13: 10.0, 14: 11.7, 15: 13.7,
    16: 15.9, 17: 18.5, 18: 21.5, 19: 24.8,
}
WOMEN_MIN_POINTS = -2  # source row "<=-2" -> "<1"
# No open-ended top row is printed for women in the source (highest row is
# 19); points above 19 have no table value here and must not be invented.
