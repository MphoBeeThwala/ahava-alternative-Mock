"""
"Is there enough data to seek validation yet?" — answered with numbers.

The thresholds are rules of thumb from the prediction-model literature, not
guarantees, and are kept in one place so they can be argued with:

  * Development: about 10 events per candidate predictor is the long-standing
    minimum (Peduzzi 1996 and descendants). Riley et al. (BMJ 2020) give a
    per-model calculation that is the better method once a real model and a
    realistic prevalence exist; this is the conservative screen before that.
  * Validation: at least 100 events (and 100 non-events) in data the model
    was not developed on (Collins et al., Stat Med 2016).

So "validation ready" means enough events for a development set AND a separate
validation set. "Ready" is about volume only. It does not mean the data is
representative, that outcomes were recorded completely, or that the model is
any good; the warnings list says what else to check.
"""
from datetime import date, timedelta
from typing import Dict, List, Optional

import pandas as pd

from .dataset import build_frame, _clean
from .features import FEATURES, age_mid
from .outcomes import TARGETS, Target
from .train import MIN_EVENTS_TO_TRAIN

EVENTS_PER_PREDICTOR = 10
VALIDATION_MIN_EVENTS = 100
TRIAGE_AGREEMENT_MIN_CASES = 385  # +/-5% at 95% for a proportion near 50%
MIN_GROUP_SHARE = 0.10


def development_events_needed() -> int:
    return EVENTS_PER_PREDICTOR * len(FEATURES)


def _stage(events: int) -> str:
    dev = development_events_needed()
    if events < MIN_EVENTS_TO_TRAIN:
        return "INSUFFICIENT"
    if events < dev:
        return "EXPLORATORY"
    if events < dev + VALIDATION_MIN_EVENTS:
        return "DEVELOPMENT_READY"
    return "VALIDATION_READY"


def _eta_months(frame: pd.DataFrame, need: int) -> Optional[float]:
    """Linear projection from the last 90 days of events. Rough, and labelled so."""
    events = frame[frame["label"] == 1]
    have = len(events)
    if have >= need:
        return 0.0
    if events.empty:
        return None
    last = frame["day"].max()
    recent = events[events["day"] >= last - timedelta(days=90)]
    rate_per_month = len(recent) / 3.0
    return round((need - have) / rate_per_month, 1) if rate_per_month > 0 else None


def target_readiness(snaps: pd.DataFrame, outs: pd.DataFrame, target: Target) -> dict:
    frame = build_frame(snaps, outs, target)
    # Events are counted as labelled positive ROWS' subjects' first-event incidents: count distinct
    # subject-events, not rows (one person's 30 snapshot rows before an event are one event).
    positives = frame[frame["label"] == 1]
    events = int(positives["subject"].nunique())
    dev, val = development_events_needed(), development_events_needed() + VALIDATION_MIN_EVENTS
    # Representation is judged on the whole cohort, not only on rows that survived censoring: a cohort
    # that is almost all men is a problem whether or not its rows are old enough to label yet.
    warnings: List[str] = []
    cohort = snaps.drop_duplicates("subjectKey")
    if len(cohort):
        ages = cohort["ageBand"].map(age_mid)
        for name, mask in (
            ("female subjects", cohort["sex"] == "female"), ("male subjects", cohort["sex"] == "male"),
            ("subjects under 40", ages < 40), ("subjects 60 and over", ages >= 60),
        ):
            share = float(mask.mean())
            if share < MIN_GROUP_SHARE:
                warnings.append(f"only {share:.0%} of subjects are {name}: results will not generalise to them")
    warnings.append("negatives are only as reliable as clinicians' recording of outcomes: check ascertainment before relying on them")
    snap_frame = _clean(snaps, outs)[0]
    followup = (snap_frame.groupby("subjectKey")["day"].agg(lambda d: (max(d) - min(d)).days)).median() if len(snap_frame) else 0
    if followup is not None and followup < target.horizon_days / 2:
        warnings.append(f"median follow-up is {int(followup)} days against a {target.horizon_days}-day horizon: many rows are censored")
    return {
        "target": target.name, "definition": target.description, "stage": _stage(events),
        "event_subjects": events, "rows": int(len(frame)), "subjects": int(frame["subject"].nunique()),
        "events_needed": {"train_flagged_exploratory": MIN_EVENTS_TO_TRAIN, "development": dev, "development_plus_validation": val},
        "events_still_needed_for_validation": max(0, val - events),
        "rough_months_to_validation_ready": _eta_months(
            positives.drop_duplicates("subject").assign(label=1), val) if events else None,
        "warnings": warnings,
    }


def readiness_report(snaps: pd.DataFrame, outs: pd.DataFrame) -> dict:
    from .triage_agreement import triage_frame
    triage = triage_frame(outs)
    return {
        "as_of": str(date.today()),
        "snapshots": int(len(snaps)), "subjects": int(snaps["subjectKey"].nunique()) if len(snaps) else 0,
        "outcomes_recorded": {k: int(v) for k, v in outs["outcomeType"].value_counts().items()} if len(outs) else {},
        "targets": [target_readiness(snaps, outs, t) for t in TARGETS.values()],
        "triage_agreement": {
            "cases": int(len(triage)), "needed_for_plus_minus_5pct": TRIAGE_AGREEMENT_MIN_CASES,
            "ready": len(triage) >= TRIAGE_AGREEMENT_MIN_CASES,
        },
        "basis": {
            "events_per_predictor": EVENTS_PER_PREDICTOR, "validation_min_events": VALIDATION_MIN_EVENTS,
            "note": "Rules of thumb (Peduzzi 1996; Collins et al. 2016). Volume only: not a statement about representativeness or quality.",
        },
    }


def readiness_text(rep: dict) -> str:
    out = [f"Research data readiness as of {rep['as_of']}",
           f"  {rep['snapshots']} snapshots from {rep['subjects']} subjects; outcomes recorded: {rep['outcomes_recorded'] or 'none'}", ""]
    for t in rep["targets"]:
        need = t["events_needed"]
        eta = t["rough_months_to_validation_ready"]
        out += [
            f"[{t['stage']}] {t['target']}: {t['definition']}",
            f"    {t['event_subjects']} events (first events, one per person) in {t['subjects']} eligible subjects / {t['rows']} rows",
            f"    exploratory training at {need['train_flagged_exploratory']}; development at {need['development']}; "
            f"development + validation at {need['development_plus_validation']} -> {t['events_still_needed_for_validation']} more events needed",
            f"    rough time to get there at the recent rate: {'unknown (no recent events)' if eta is None else ('already there' if eta == 0 else f'~{eta} months')}",
        ] + [f"    ! {w}" for w in t["warnings"]] + [""]
    ta = rep["triage_agreement"]
    out.append(f"[{'READY' if ta['ready'] else 'ACCRUING'}] AI-vs-doctor triage agreement: {ta['cases']} reviewed cases "
               f"(~{ta['needed_for_plus_minus_5pct']} gives +/-5% on a proportion)")
    out += ["", rep["basis"]["note"]]
    return "\n".join(out)
