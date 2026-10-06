"""
Train a candidate model for one target and write an inspectable artifact plus a
model card. Training only ever produces a CANDIDATE: approval is a separate,
human act (registry.py), and nothing here touches the live service.

Honest-evaluation design:
  * Out-of-fold predictions from subject-grouped, event-stratified K-fold; the
    reported metrics are on predictions no fold's model was trained on.
  * Calibration (Platt) is fitted on those out-of-fold scores, then applied to
    the final model trained on all data.
  * A second, temporal check: train on earlier-enrolled subjects, test on the
    latest ones. If the two disagree badly, believe the harsher one.
  * Hyperparameters are fixed (not tuned on the evaluation folds), so the
    numbers are not flattered by selection.
  * Too few events: refuse, or train flagged `underpowered` when forced.
"""
import json
import math
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.preprocessing import StandardScaler

from . import evaluate
from .artifact import ModelArtifact
from .dataset import temporal_subject_split
from .features import FEATURES, FEATURE_SCHEMA_HASH
from .outcomes import Target, get_target

MIN_EVENTS_TO_TRAIN = 30
MIN_EVENT_SUBJECTS = 15
DEFAULT_C = 0.1  # fixed L2 strength: strong regularisation for small event counts

INTENDED_USE = (
    "Research shadow evaluation only. Not validated, not a medical device, not for clinical decisions, "
    "never shown to patients or clinicians. Any use beyond silent comparison with what later happened "
    "requires ethics approval, prospective validation and regulatory review."
)


def _fit(X: np.ndarray, y: np.ndarray, c: float, seed: int) -> Tuple[SimpleImputer, StandardScaler, LogisticRegression]:
    imp = SimpleImputer(strategy="median", keep_empty_features=True).fit(X)
    Xi = imp.transform(X)
    sc = StandardScaler().fit(Xi)
    clf = LogisticRegression(C=c, solver="lbfgs", max_iter=2000, random_state=seed)
    clf.fit(sc.transform(Xi), y)
    return imp, sc, clf


def _raw_logit(parts, X: np.ndarray) -> np.ndarray:
    imp, sc, clf = parts
    return clf.decision_function(sc.transform(imp.transform(X)))


def _platt(logits: np.ndarray, y: np.ndarray) -> Tuple[float, float]:
    fit = LogisticRegression(C=1e6, solver="lbfgs", max_iter=1000).fit(logits.reshape(-1, 1), y)
    return float(fit.coef_[0][0]), float(fit.intercept_[0])


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -40, 40)))


def check_power(frame: pd.DataFrame) -> Dict[str, int]:
    """
    `events` counts PEOPLE who had the outcome, not rows. One person's 40 snapshots in the 90 days before an
    event are 40 positive rows but ONE event; counting rows would overstate the evidence about thirty-fold.
    """
    event_subjects = int(frame.loc[frame["label"] == 1, "subject"].nunique())
    return {"rows": int(len(frame)), "subjects": int(frame["subject"].nunique()),
            "events": event_subjects, "event_subjects": event_subjects, "positive_rows": int(frame["label"].sum())}


def train(frame: pd.DataFrame, target: Target, *, synthetic: bool, c: float = DEFAULT_C, seed: int = 0,
          n_splits: int = 5, n_boot: int = 300, force_small: bool = False,
          data_provenance: Optional[dict] = None) -> Tuple[ModelArtifact, dict]:
    power = check_power(frame)
    underpowered = power["events"] < MIN_EVENTS_TO_TRAIN or power["event_subjects"] < MIN_EVENT_SUBJECTS
    if underpowered and not force_small:
        raise ValueError(
            f"not enough events to train {target.name}: {power['events']} events from "
            f"{power['event_subjects']} subjects (need at least {MIN_EVENTS_TO_TRAIN} from {MIN_EVENT_SUBJECTS}). "
            "See `python -m research readiness`. Use --force-small to train a flagged, underpowered model anyway."
        )

    X = frame[list(FEATURES)].to_numpy(dtype=float)
    y = frame["label"].to_numpy()
    groups = frame["subject"].to_numpy()

    # ---- out-of-fold predictions (subject-grouped) -------------------------
    k = max(2, min(n_splits, power["event_subjects"]))
    oof_logit = np.zeros(len(y))
    for tr, te in StratifiedGroupKFold(n_splits=k, shuffle=True, random_state=seed).split(X, y, groups):
        if len(np.unique(y[tr])) < 2:
            raise ValueError("a training fold has no events; too few events for cross-validation")
        oof_logit[te] = _raw_logit(_fit(X[tr], y[tr], c, seed), X[te])
    a, b = _platt(oof_logit, y)
    oof_p = _sigmoid(a * oof_logit + b)

    cv_report = evaluate.full_report(frame, oof_p, n_boot=n_boot)

    # ---- temporal check ----------------------------------------------------
    temporal = None
    tr_idx, te_idx = temporal_subject_split(frame)
    if len(np.unique(y[tr_idx])) == 2 and len(np.unique(y[te_idx])) == 2:
        parts = _fit(X[tr_idx], y[tr_idx], c, seed)
        a_t, b_t = _platt(_raw_logit(parts, X[tr_idx]), y[tr_idx])  # in-sample calibration here; see card
        p_te = _sigmoid(a_t * _raw_logit(parts, X[te_idx]) + b_t)
        temporal = evaluate.full_report(frame.iloc[te_idx].reset_index(drop=True), p_te, n_boot=n_boot)
        temporal["note"] = ("trained on earlier-enrolled subjects, tested on the latest-enrolled; "
                            "calibration slope/intercept here are optimistic (fitted in-sample)")
    else:
        temporal = {"status": "skipped: train or test side has no events"}

    # ---- final model on all data ------------------------------------------
    imp, sc, clf = _fit(X, y, c, seed)
    medians = imp.statistics_
    art = ModelArtifact(
        name=target.name, target=target.name, horizon_days=target.horizon_days, features=list(FEATURES),
        impute={f: float(medians[i]) if not math.isnan(medians[i]) else 0.0 for i, f in enumerate(FEATURES)},
        mean={f: float(sc.mean_[i]) for i, f in enumerate(FEATURES)},
        scale={f: float(sc.scale_[i]) if sc.scale_[i] > 0 else 1.0 for i, f in enumerate(FEATURES)},
        coef={f: float(clf.coef_[0][i]) for i, f in enumerate(FEATURES)},
        intercept=float(clf.intercept_[0]), platt_a=a, platt_b=b,
        feature_schema_hash=FEATURE_SCHEMA_HASH, synthetic=synthetic,
    )
    days = frame["day"]
    card = {
        "target": {"name": target.name, "definition": target.description, "horizon_days": target.horizon_days,
                   "outcome_types": list(target.outcome_types)},
        "status": "CANDIDATE", "intended_use": INTENDED_USE,
        "synthetic": synthetic, "underpowered": bool(underpowered),
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data": {**power, "first_day": str(days.min()), "last_day": str(days.max()),
                 "provenance": data_provenance or {}},
        "method": {"model": "L2 logistic regression, median-imputed, standardised", "C": c, "folds": k,
                   "calibration": "Platt scaling fitted on out-of-fold scores", "seed": seed,
                   "bootstrap": f"subject-clustered, {n_boot} resamples, 95% percentile interval"},
        "cross_validated": cv_report,
        "temporal_holdout": temporal,
        "limitations": [
            "Not externally validated: all numbers come from the population that produced the data.",
            "Outcomes are those clinicians recorded; unrecorded outcomes are counted as negatives once follow-up elapses.",
            "Early adopters of a wearable-based service are not a random sample of the population.",
            "Calibration and subgroup results are unreliable until event counts are large (see readiness).",
        ],
        "top_coefficients": sorted(
            [{"feature": f, "coef": round(art.coef[f], 4)} for f in FEATURES], key=lambda d: -abs(d["coef"]))[:10],
    }
    art.card = card
    return art, card


def card_markdown(card: dict) -> str:
    cv = card["cross_validated"]
    f = lambda d: (f"{d['estimate']:.3f} (95% CI {d['low']:.3f}–{d['high']:.3f})"
                   if d and not math.isnan(d.get("low", float("nan"))) else
                   (f"{d['estimate']:.3f} (interval not estimable)" if d else "n/a"))
    lines = [
        f"# Model card: {card['target']['name']}  [{card['status']}]",
        "", f"**Intended use:** {card['intended_use']}", "",
        f"**Predicts:** {card['target']['definition']}.",
        f"**Data:** {card['data']['rows']} rows from {card['data']['subjects']} subjects; "
        f"{card['data']['events']} people had the outcome ({card['data']['positive_rows']} positive rows), "
        f"{card['data']['first_day']} to {card['data']['last_day']}.",
    ]
    if card["synthetic"]:
        lines += ["", "> **SYNTHETIC DATA. Pipeline test only. Says nothing about patients. Cannot be approved.**"]
    if card["underpowered"]:
        lines += ["", "> **UNDERPOWERED. Too few events for reliable estimates.**"]
    lines += [
        "", "## Cross-validated performance (subject-grouped, out-of-fold)",
        f"- AUROC: {f(cv['auroc'])}",
        f"- AUPRC: {f(cv['auprc'])} (no-skill = row prevalence {cv['prevalence']:.4f})",
        f"- Calibration slope {cv['calibration']['slope']:.2f} (1 = ideal), intercept {cv['calibration']['intercept']:.2f} (0 = ideal), "
        f"ECE {cv['calibration']['ece']:.3f}, Brier {cv['calibration']['brier']:.4f}",
    ]
    k = next((k for k in cv if k.startswith("at_sensitivity_")), None)
    if k and cv[k]:
        s = cv[k]
        lines.append(f"- At {k.split('_')[-1]}% sensitivity: specificity {s['specificity']:.2f}, PPV {s['ppv']:.3f}, "
                     f"flags {s['flag_rate']:.1%} of rows, ~{s['number_needed_to_review']:.0f} flagged rows reviewed per true positive row")
    lines += ["", "## Against what exists today (same rows)"]
    for name, b in cv["baselines"].items():
        if "status" in b:
            lines.append(f"- {name}: {b['status']} ({b['rows_covered']} rows covered)")
        else:
            lines.append(f"- {name}: baseline AUROC {f(b['baseline_auroc'])} vs model {f(b['model_auroc_same_rows'])} ({b['rows_covered']} rows)")
    lines += ["", "## Subgroups"]
    for name, s in cv["subgroups"].items():
        lines.append(f"- {name}: " + (f"{s['status']} ({s['events']} people with the outcome)" if "status" in s else
                     f"AUROC {s['auroc']:.3f}, observed {s['observed_rate']:.3%} vs predicted {s['mean_predicted']:.3%} ({s['events']} people with the outcome)"))
    t = card["temporal_holdout"]
    if t and "auroc" in t:
        lines += ["", "## Temporal hold-out (latest-enrolled subjects)", f"- AUROC: {f(t['auroc'])} ({t['events']} people with the outcome)"]
    lines += ["", "## Limitations"] + [f"- {x}" for x in card["limitations"]]
    return "\n".join(lines) + "\n"
