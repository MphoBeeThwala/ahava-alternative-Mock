"""
Evaluation metrics that mean something for a rare-outcome clinical model.

Reported together because any one alone misleads: AUROC says nothing about
calibration; calibration says nothing about how many alerts a clinician has to
wade through; and none of it means anything without an interval and a
comparison against what the rules engine already does on the SAME rows.
Subject-clustered bootstrap intervals, because rows from one person are not
independent.
"""
from typing import Callable, Dict, List, Optional

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

MIN_EVENTS_FOR_SUBGROUP = 10


def auroc(y: np.ndarray, p: np.ndarray) -> float:
    if len(np.unique(y)) < 2:
        return float("nan")
    return float(roc_auc_score(y, p))


def auprc(y: np.ndarray, p: np.ndarray) -> float:
    if y.sum() == 0:
        return float("nan")
    return float(average_precision_score(y, p))


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def calibration(y: np.ndarray, p: np.ndarray) -> Dict[str, float]:
    """
    Calibration-in-the-large (intercept, 0 is ideal), slope (1 is ideal; <1 means over-confident
    predictions), and expected calibration error over 10 equal-count bins.
    """
    out = {"intercept": float("nan"), "slope": float("nan"), "ece": float("nan"), "brier": float("nan")}
    if len(np.unique(y)) < 2:
        return out
    z = _logit(p).reshape(-1, 1)
    slope_fit = LogisticRegression(C=1e6, solver="lbfgs", max_iter=1000).fit(z, y)
    out["slope"] = float(slope_fit.coef_[0][0])
    # intercept with slope fixed at 1: logit(p) as an offset
    from scipy.optimize import minimize_scalar
    off = z.ravel()
    nll = lambda a: float(np.sum(np.logaddexp(0, off + a) - y * (off + a)))
    out["intercept"] = float(minimize_scalar(nll, bounds=(-10, 10), method="bounded").x)
    order = np.argsort(p)
    bins = np.array_split(order, 10)
    out["ece"] = float(sum(len(b) / len(p) * abs(y[b].mean() - p[b].mean()) for b in bins if len(b)))
    out["brier"] = float(brier_score_loss(y, p))
    return out


def threshold_for_sensitivity(y: np.ndarray, p: np.ndarray, sensitivity: float = 0.8) -> float:
    pos = np.sort(p[y == 1])
    if len(pos) == 0:
        return float("nan")
    return float(np.quantile(pos, 1 - sensitivity))


def at_threshold(y: np.ndarray, p: np.ndarray, thr: float) -> Dict[str, float]:
    flag = p >= thr
    tp, fp = int((flag & (y == 1)).sum()), int((flag & (y == 0)).sum())
    fn, tn = int((~flag & (y == 1)).sum()), int((~flag & (y == 0)).sum())
    div = lambda a, b: float(a / b) if b else float("nan")
    return {
        "threshold": float(thr), "sensitivity": div(tp, tp + fn), "specificity": div(tn, tn + fp),
        "ppv": div(tp, tp + fp), "npv": div(tn, tn + fn), "flag_rate": float(flag.mean()),
        # how many flagged rows a clinician would look at to find one true event
        "number_needed_to_review": div(tp + fp, tp),
    }


def net_benefit(y: np.ndarray, p: np.ndarray, pt: float) -> float:
    """Decision-curve net benefit at threshold probability pt: TP/n - FP/n * pt/(1-pt)."""
    n = len(y)
    flag = p >= pt
    tp, fp = (flag & (y == 1)).sum(), (flag & (y == 0)).sum()
    return float(tp / n - fp / n * pt / (1 - pt))


def cluster_bootstrap_ci(metric: Callable[[np.ndarray, np.ndarray], float], y: np.ndarray, p: np.ndarray,
                         groups: np.ndarray, n_boot: int = 300, seed: int = 0) -> Dict[str, float]:
    """95% percentile interval, resampling whole subjects with replacement."""
    rng = np.random.default_rng(seed)
    ids = np.unique(groups)
    index_by = {g: np.where(groups == g)[0] for g in ids}
    vals = []
    for _ in range(n_boot):
        pick = rng.choice(ids, size=len(ids), replace=True)
        idx = np.concatenate([index_by[g] for g in pick])
        v = metric(y[idx], p[idx])
        if not np.isnan(v):
            vals.append(v)
    point = metric(y, p)
    if len(vals) < max(20, n_boot // 5):
        return {"estimate": float(point), "low": float("nan"), "high": float("nan")}
    lo, hi = np.percentile(vals, [2.5, 97.5])
    return {"estimate": float(point), "low": float(lo), "high": float(hi)}


def baseline_comparison(frame, p: np.ndarray, n_boot: int = 300) -> Dict[str, dict]:
    """
    The model against what exists, on rows where the baseline actually produced a value. Reported on the
    rows the baseline covers for BOTH, so the comparison is like for like.
    """
    y = frame["label"].to_numpy()
    groups = frame["subject"].to_numpy()
    out = {}
    for name, col in (("live_alert_level", "live_alert_score"), ("framingham_lab_pct", "live_framingham_pct")):
        base = frame[col].to_numpy(dtype=float)
        ok = ~np.isnan(base)
        if ok.sum() < 50 or len(np.unique(y[ok])) < 2:
            out[name] = {"status": "insufficient_coverage", "rows_covered": int(ok.sum())}
            continue
        out[name] = {
            "rows_covered": int(ok.sum()),
            "baseline_auroc": cluster_bootstrap_ci(auroc, y[ok], base[ok], groups[ok], n_boot),
            "model_auroc_same_rows": cluster_bootstrap_ci(auroc, y[ok], p[ok], groups[ok], n_boot),
        }
    return out


def subgroup_report(frame, p: np.ndarray) -> Dict[str, dict]:
    """AUROC and mean predicted vs observed risk per sex and age group, where there are enough events to say anything."""
    y = frame["label"].to_numpy()
    subj = frame["subject"].to_numpy()
    age = frame["age_mid"].to_numpy(dtype=float)
    groups = {
        "sex=male": (frame["sex"] == "male").to_numpy(),
        "sex=female": (frame["sex"] == "female").to_numpy(),
        "age<40": age < 40,
        "age40-59": (age >= 40) & (age < 60),
        "age60+": age >= 60,
    }
    out = {}
    for name, mask in groups.items():
        # People with the outcome, not positive rows: one person is one event however many rows they have.
        n_events = int(len(np.unique(subj[mask & (y == 1)])))
        n_negative_rows = int((mask & (y == 0)).sum())
        if n_events < MIN_EVENTS_FOR_SUBGROUP or n_negative_rows < MIN_EVENTS_FOR_SUBGROUP:
            out[name] = {"status": "too_few_events", "rows": int(mask.sum()), "events": n_events}
            continue
        out[name] = {"rows": int(mask.sum()), "events": n_events, "auroc": auroc(y[mask], p[mask]),
                     "observed_rate": float(y[mask].mean()), "mean_predicted": float(p[mask].mean())}
    return out


def full_report(frame, p: np.ndarray, n_boot: int = 300, sensitivity: float = 0.8) -> dict:
    y = frame["label"].to_numpy()
    g = frame["subject"].to_numpy()
    thr = threshold_for_sensitivity(y, p, sensitivity)
    prevalence = float(y.mean())
    return {
        "rows": int(len(y)), "subjects": int(len(np.unique(g))),
        "events": int(len(np.unique(g[y == 1]))),  # people with the outcome
        "positive_rows": int(y.sum()), "prevalence": prevalence,
        "auroc": cluster_bootstrap_ci(auroc, y, p, g, n_boot),
        "auprc": {**cluster_bootstrap_ci(auprc, y, p, g, n_boot), "no_skill": prevalence},
        "calibration": calibration(y, p),
        f"at_sensitivity_{int(sensitivity * 100)}": at_threshold(y, p, thr) if not np.isnan(thr) else None,
        "net_benefit": {f"{pt:.2f}": {"model": net_benefit(y, p, pt), "treat_all": net_benefit(y, np.ones_like(p), pt)}
                        for pt in (0.05, 0.10, 0.20)},
        "baselines": baseline_comparison(frame, p, n_boot),
        "subgroups": subgroup_report(frame, p),
    }
