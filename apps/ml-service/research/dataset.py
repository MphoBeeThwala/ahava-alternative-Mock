"""
Turn the research tables into a labelled, leakage-safe modelling frame.

The design choices that matter (each has a test):

 * Incident, not prevalent. A row is excluded if the subject already had a
   target outcome on or before that day, or (for new-diagnosis targets) the
   condition is already known. Otherwise a model scores well by reading the
   answer off its input.
 * Censoring is explicit. A row is a negative only if the subject was observed
   for the whole horizon; a subject last seen 20 days after a snapshot is not
   a 90-day negative, they are simply unknown and are dropped. Counting them
   as negatives would make every model look better than it is.
 * Features see strictly earlier days only (features.py).
 * Splits are by subject, never by row, so one person's rows cannot sit on
   both sides of a train/test split.
"""
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple
import os

import numpy as np
import pandas as pd

from .features import FEATURES, SNAPSHOT_COLUMNS, build_features, parse_day, HISTORY_FETCH_DAYS
from .outcomes import Target, get_target

LEVEL_SCORE = {"GREEN": 0.0, "YELLOW": 1.0, "RED": 2.0}


# --------------------------------------------------------------------- loading
def load_from_db(dsn: Optional[str] = None) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Read the research tables. Use a read-only login limited to them (scripts/research-db-role.ts)."""
    import psycopg2  # imported here: the live service and unit tests never need a database
    dsn = dsn or os.getenv("RESEARCH_DATABASE_URL")
    if not dsn:
        raise RuntimeError("set RESEARCH_DATABASE_URL (a read-only login on the research tables)")
    snap_cols = ", ".join(f'"{c}"' for c in ("subjectKey",) + SNAPSHOT_COLUMNS + (
        "liveAlertLevel", "liveCvdCategory", "liveFraminghamPct", "liveBpPrompt"))
    conn = psycopg2.connect(dsn)
    try:
        conn.set_session(readonly=True)
        snaps = pd.read_sql_query(f"SELECT {snap_cols} FROM research_snapshots", conn)
        outs = pd.read_sql_query(
            'SELECT "subjectKey", "outcomeType", "outcomeDay", "icd10", "details", "source" FROM research_outcomes', conn)
    finally:
        conn.close()
    return snaps, outs


def load_from_csv(directory: str) -> Tuple[pd.DataFrame, pd.DataFrame]:
    snaps = pd.read_csv(os.path.join(directory, "snapshots.csv"))
    outs = pd.read_csv(os.path.join(directory, "outcomes.csv"))
    if "details" in outs.columns:
        import json
        outs["details"] = outs["details"].map(lambda v: json.loads(v) if isinstance(v, str) and v.strip() else {})
    return snaps, outs


def _clean(snaps: pd.DataFrame, outs: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    snaps = snaps.copy()
    outs = outs.copy()
    snaps["day"] = snaps["observedDay"].map(parse_day)
    outs["day"] = outs["outcomeDay"].map(parse_day)
    snaps = snaps.sort_values(["subjectKey", "day"], kind="mergesort").reset_index(drop=True)
    return snaps, outs


def _records(group: pd.DataFrame) -> List[Dict]:
    """Rows as dicts with NaN -> None, `observedDay` as a date, plus the live-engine columns for baselines."""
    keep = [c for c in SNAPSHOT_COLUMNS if c in group.columns]
    extra = [c for c in ("liveAlertLevel", "liveFraminghamPct") if c in group.columns]
    out = []
    for r in group[keep + extra + ["day"]].to_dict("records"):
        rec = {k: (None if (isinstance(v, float) and v != v) or v is pd.NA or v is pd.NaT else v) for k, v in r.items()}
        rec["observedDay"] = rec.pop("day")
        out.append(rec)
    return out


# --------------------------------------------------------------------- building
def build_frame(snaps: pd.DataFrame, outs: pd.DataFrame, target: Target) -> pd.DataFrame:
    """One row per eligible snapshot: subject, day, FEATURES..., label, baseline columns."""
    snaps, outs = _clean(snaps, outs)
    H = target.horizon_days

    events: Dict[str, List[date]] = {}
    for r in outs[outs["outcomeType"].isin(target.outcome_types)].itertuples():
        events.setdefault(r.subjectKey, []).append(r.day)

    # Last day we know a subject was alive and observed: any snapshot or any recorded outcome.
    last_seen: Dict[str, date] = snaps.groupby("subjectKey")["day"].max().to_dict()
    for r in outs.itertuples():
        if r.day > last_seen.get(r.subjectKey, date.min):
            last_seen[r.subjectKey] = r.day

    rows = []
    for subject, group in snaps.groupby("subjectKey", sort=False):
        records = _records(group)
        subj_events = sorted(events.get(subject, []))
        for i, rec in enumerate(records):
            d = rec["observedDay"]
            if any(e <= d for e in subj_events):
                continue  # prevalent: the outcome already happened
            window = [h for h in records[:i] if d - timedelta(days=HISTORY_FETCH_DAYS) <= h["observedDay"] < d]
            feats = build_features(rec, window)
            if target.exclude_if_known and feats.get(target.exclude_if_known) == 1.0:
                continue
            hit = any(d < e <= d + timedelta(days=H) for e in subj_events)
            if not hit and last_seen[subject] < d + timedelta(days=H):
                continue  # censored: not observed long enough to call this a negative
            row = {"subject": subject, "day": d, **feats, "label": int(hit),
                   "sex": rec.get("sex"), "age_band": rec.get("ageBand"),
                   "live_alert_score": LEVEL_SCORE.get(rec.get("liveAlertLevel")),
                   "live_framingham_pct": rec.get("liveFramingham" "Pct")}
            rows.append(row)
    cols = ["subject", "day", *FEATURES, "label", "sex", "age_band", "live_alert_score", "live_framingham_pct"]
    frame = pd.DataFrame(rows, columns=cols)
    for c in ("live_alert_score", "live_framingham_pct"):
        frame[c] = pd.to_numeric(frame[c], errors="coerce")
    return frame


def target_frame(snaps: pd.DataFrame, outs: pd.DataFrame, target_name: str) -> pd.DataFrame:
    return build_frame(snaps, outs, get_target(target_name))


# --------------------------------------------------------------------- splitting
def temporal_subject_split(frame: pd.DataFrame, test_fraction: float = 0.25) -> Tuple[np.ndarray, np.ndarray]:
    """
    Subjects whose FIRST eligible row falls in the latest `test_fraction` of subjects (by first date)
    go to test; everyone else trains. Whole subjects, so no leakage across the boundary; later
    subjects, so it mimics deploying on people the model has never seen.
    """
    first = frame.groupby("subject")["day"].min().sort_values(kind="mergesort")
    n_test = max(1, int(round(len(first) * test_fraction)))
    test_subjects = set(first.index[-n_test:])
    is_test = frame["subject"].isin(test_subjects).to_numpy()
    return np.where(~is_test)[0], np.where(is_test)[0]
