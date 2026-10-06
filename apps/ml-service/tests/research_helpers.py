"""Hand-built snapshot/outcome tables for the research tests. Small enough to reason about by eye."""
from datetime import date, timedelta
import pandas as pd

from research.features import SNAPSHOT_COLUMNS

D0 = date(2026, 3, 1)


def snap(subject, day_offset, **over):
    row = {c: None for c in SNAPSHOT_COLUMNS}
    row.update({
        "subjectKey": subject, "observedDay": (D0 + timedelta(days=day_offset)).isoformat(), "ageBand": "45-49",
        "sex": "female", "hrResting": 66.0, "hrvRmssd": 40.0, "spo2": 97.0, "source": "wearable",
        "liveAlertLevel": None, "liveFraminghamPct": None,
    })
    row.update(over)
    return row


def outcome(subject, day_offset, outcome_type="CVD_EVENT", details=None):
    return {"subjectKey": subject, "outcomeType": outcome_type,
            "outcomeDay": (D0 + timedelta(days=day_offset)).isoformat(), "icd10": None,
            "details": details or {}, "source": "CLINICIAN_ENTRY"}


def tables(snaps, outs):
    return pd.DataFrame(snaps), pd.DataFrame(outs, columns=["subjectKey", "outcomeType", "outcomeDay", "icd10", "details", "source"])
