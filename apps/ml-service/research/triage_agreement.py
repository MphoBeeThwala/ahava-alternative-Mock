"""
AI triage vs the doctor's final level, from the automatically recorded
TRIAGE_REVIEWED outcomes. This accrues fastest of anything in the pipeline and
needs no wearable history, so it is the first place real accuracy evidence
appears.

Levels are SATS-style: 1 = most urgent, 5 = least. Therefore
  under-triage = the AI's number is HIGHER than the doctor's (it rated the
                 patient less urgent than the clinician did): the dangerous error
  over-triage  = the AI's number is LOWER (more urgent than the clinician)
"""
import math
from typing import Dict

import numpy as np
import pandas as pd


def triage_frame(outs: pd.DataFrame) -> pd.DataFrame:
    if outs is None or len(outs) == 0:
        return pd.DataFrame(columns=["ai", "final"])
    rows = []
    for r in outs[outs["outcomeType"] == "TRIAGE_REVIEWED"].itertuples():
        d = r.details if isinstance(r.details, dict) else {}
        ai, fin = d.get("aiLevel"), d.get("finalLevel")
        if isinstance(ai, (int, float)) and isinstance(fin, (int, float)) and ai == ai and fin == fin:
            rows.append({"ai": int(ai), "final": int(fin), "day": r.day if hasattr(r, "day") else None})
    return pd.DataFrame(rows, columns=["ai", "final", "day"])


def wilson(k: int, n: int, z: float = 1.96) -> Dict[str, float]:
    if n == 0:
        return {"estimate": float("nan"), "low": float("nan"), "high": float("nan")}
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return {"estimate": p, "low": max(0.0, centre - half), "high": min(1.0, centre + half)}


def agreement_report(outs: pd.DataFrame) -> dict:
    t = triage_frame(outs)
    n = len(t)
    if n == 0:
        return {"cases": 0, "status": "no reviewed triage cases yet"}
    diff = t["ai"] - t["final"]  # > 0: AI less urgent than the doctor
    report = {
        "cases": n,
        "exact_agreement": wilson(int((diff == 0).sum()), n),
        "within_one_level": wilson(int((diff.abs() <= 1).sum()), n),
        "under_triage": wilson(int((diff > 0).sum()), n),
        "over_triage": wilson(int((diff < 0).sum()), n),
        # AI called it routine (4/5) when the doctor called it emergent/very urgent (1/2)
        "dangerous_under_triage": wilson(int(((t["ai"] >= 4) & (t["final"] <= 2)).sum()), n),
        "severe_under_triage_2plus_levels": wilson(int((diff >= 2).sum()), n),
        "confusion_ai_rows_by_final_cols": {
            str(a): {str(f): int(((t["ai"] == a) & (t["final"] == f)).sum()) for f in range(1, 6)} for a in range(1, 6)
        },
    }
    if t["ai"].nunique() > 1 or t["final"].nunique() > 1:
        from sklearn.metrics import cohen_kappa_score
        report["weighted_kappa_quadratic"] = float(cohen_kappa_score(t["ai"], t["final"], weights="quadratic", labels=[1, 2, 3, 4, 5]))
    return report


def agreement_text(rep: dict) -> str:
    if rep.get("cases", 0) == 0:
        return "No reviewed triage cases recorded yet."
    f = lambda d: f"{d['estimate']:.1%} (95% CI {d['low']:.1%}–{d['high']:.1%})"
    lines = [f"AI vs doctor triage, {rep['cases']} reviewed cases (level 1 = most urgent)",
             f"  exact agreement:              {f(rep['exact_agreement'])}",
             f"  within one level:             {f(rep['within_one_level'])}",
             f"  AI less urgent than doctor:   {f(rep['under_triage'])}   <- the dangerous direction",
             f"  AI more urgent than doctor:   {f(rep['over_triage'])}",
             f"  AI said 4-5, doctor said 1-2: {f(rep['dangerous_under_triage'])}",
             f"  AI two+ levels too low:       {f(rep['severe_under_triage_2plus_levels'])}"]
    if "weighted_kappa_quadratic" in rep:
        lines.append(f"  weighted kappa (quadratic):   {rep['weighted_kappa_quadratic']:.2f}")
    return "\n".join(lines)
