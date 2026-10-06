"""
Synthetic data for exercising the pipeline end to end. NOT patient data and NOT
evidence of anything: the outcomes are generated from a formula this file
writes, so a model "learning" them proves the code runs, nothing about people.

Everything produced here is flagged: the training CLI stamps `synthetic: true`
on the artifact and the registry refuses to approve such an artifact.
"""
from datetime import date, timedelta
from typing import Tuple

import numpy as np
import pandas as pd

from .features import SNAPSHOT_COLUMNS

AGE_BANDS = ["18-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79"]


def make_synthetic(n_subjects: int = 400, days: int = 240, seed: int = 7,
                   start: date = date(2026, 1, 1)) -> Tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    snap_rows, out_rows = [], []
    for s in range(n_subjects):
        key = f"synthetic-{s:05d}"
        age_idx = int(rng.integers(0, len(AGE_BANDS)))
        band = AGE_BANDS[age_idx]
        age = 21 + 5 * age_idx
        male = bool(rng.random() < 0.45)
        smoker = bool(rng.random() < (0.30 if male else 0.10))
        diabetes = bool(rng.random() < 0.04 + 0.002 * max(age - 30, 0))
        htn = bool(rng.random() < 0.10 + 0.007 * max(age - 30, 0))
        bmi = float(np.clip(rng.normal(27, 5), 16, 50))
        enrol = int(rng.integers(0, days // 2))
        follow = int(rng.integers(30, days - enrol + 1))

        latent = -5.3 + 0.045 * (age - 40) + 0.5 * male + 0.7 * smoker + 0.6 * diabetes + 0.5 * htn + 0.04 * (bmi - 27)
        event_day = None
        for t in range(follow):
            # A true physiological signal that builds in the weeks before an event: what the
            # history-derived features are there to catch.
            hazard = 1 / (1 + np.exp(-(latent)))
            if rng.random() < hazard * 0.05:
                event_day = enrol + t
                break
        horizon_end = follow if event_day is None else (event_day - enrol)

        for t in range(horizon_end):
            if rng.random() < 0.30:  # not every day has a reading
                continue
            d = start + timedelta(days=enrol + t)
            to_event = (horizon_end - t) if event_day is not None else 999
            ramp = max(0.0, 1.0 - to_event / 30.0)  # 0 far from the event, 1 at the event
            hr = rng.normal(68 + 4 * smoker, 4) + 9 * ramp
            hrv = rng.normal(45 - 0.2 * (age - 40), 6) - 12 * ramp
            row = {c: None for c in SNAPSHOT_COLUMNS}
            row.update({
                "subjectKey": key, "observedDay": d.isoformat(), "ageBand": band,
                "sex": "male" if male else "female", "smoker": smoker, "diabetes": diabetes,
                "hypertensionKnown": htn,
                "hrResting": round(float(hr), 1), "hrvRmssd": round(float(max(hrv, 5)), 1),
                "spo2": round(float(np.clip(rng.normal(97.5 - 1.5 * ramp, 0.8), 85, 100)), 1),
                "respRate": round(float(rng.normal(15 + 2 * ramp, 1.5)), 1),
                "sleepHours": round(float(np.clip(rng.normal(7 - 1.2 * ramp, 0.9), 2, 11)), 1),
                "steps": int(max(0, rng.normal(7000, 2500))),
                "ecgIrregular": bool(rng.random() < 0.01 + 0.08 * ramp),
                "temperatureTrend": "normal", "source": "wearable",
                "bmi": round(bmi, 1) if rng.random() < 0.6 else None,
                "sbp": round(float(rng.normal(122 + 0.4 * (age - 40) + 14 * htn + 6 * ramp, 10)), 0)
                       if rng.random() < 0.35 else None,
                "glucose": round(float(rng.normal(5.2 + 2.0 * diabetes, 0.8)), 1) if rng.random() < 0.2 else None,
            })
            snap_rows.append(row)
        if event_day is not None:
            out_rows.append({"subjectKey": key, "outcomeType": "CVD_EVENT",
                             "outcomeDay": (start + timedelta(days=event_day)).isoformat(),
                             "icd10": "I21.9", "details": {}, "source": "CLINICIAN_ENTRY"})

        # A triage case for some subjects: AI vs doctor, with a known amount of under-triage.
        if rng.random() < 0.25:
            ai = int(rng.integers(1, 6))
            shift = int(rng.choice([-1, 0, 0, 0, 0, 1, 1, 2], p=[0.1, 0.4, 0.15, 0.1, 0.05, 0.1, 0.05, 0.05]))
            final = int(np.clip(ai - shift, 1, 5))  # final < ai means the doctor judged it MORE urgent
            out_rows.append({"subjectKey": key, "outcomeType": "TRIAGE_REVIEWED",
                             "outcomeDay": (start + timedelta(days=enrol + 1)).isoformat(), "icd10": None,
                             "details": {"aiLevel": ai, "finalLevel": final, "overridden": ai != final, "route": "RELEASED"},
                             "source": "TRIAGE_REVIEW"})
    snaps = pd.DataFrame(snap_rows)
    outs = pd.DataFrame(out_rows)
    snaps["liveAlertLevel"] = None
    snaps["liveFraminghamPct"] = np.nan
    return snaps, outs
