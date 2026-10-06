import json

import pandas as pd
import pytest

pytest.importorskip("sklearn")

from research import registry
from research.cli import main
from research.features import FEATURES
from research.outcomes import OUTCOME_TYPES, TARGETS
from research.readiness import (EVENTS_PER_PREDICTOR, VALIDATION_MIN_EVENTS, _stage, development_events_needed,
                                readiness_report, target_readiness)
from research.triage_agreement import agreement_report, wilson
from research_helpers import outcome, snap, tables


def triage_outs(pairs):
    rows = [outcome(f"p{i}", 1, "TRIAGE_REVIEWED", {"aiLevel": a, "finalLevel": f}) for i, (a, f) in enumerate(pairs)]
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ triage agreement
def test_triage_agreement_counts_the_dangerous_direction_separately():
    # (AI level, doctor level); level 1 = most urgent
    pairs = [(3, 3), (3, 3), (2, 2), (4, 1), (5, 2), (4, 3), (1, 2), (2, 3), (3, 2), (5, 5)]
    r = agreement_report(triage_outs(pairs))
    assert r["cases"] == 10
    assert r["exact_agreement"]["estimate"] == pytest.approx(0.4)             # (3,3)x2 (2,2) (5,5)
    assert r["under_triage"]["estimate"] == pytest.approx(0.4)               # AI number > doctor: (4,1) (5,2) (4,3) (3,2)
    assert r["over_triage"]["estimate"] == pytest.approx(0.2)                # (1,2) (2,3)
    assert r["dangerous_under_triage"]["estimate"] == pytest.approx(0.2)     # AI 4-5 while doctor 1-2: (4,1) (5,2)
    assert r["severe_under_triage_2plus_levels"]["estimate"] == pytest.approx(0.2)
    assert r["confusion_ai_rows_by_final_cols"]["4"]["1"] == 1
    assert -1 <= r["weighted_kappa_quadratic"] <= 1


def test_triage_agreement_ignores_other_outcomes_and_junk_levels():
    outs = pd.DataFrame([outcome("a", 1, "TRIAGE_REVIEWED", {"aiLevel": 3, "finalLevel": 3}),
                         outcome("b", 1, "CVD_EVENT"),
                         outcome("c", 1, "TRIAGE_REVIEWED", {"aiLevel": None, "finalLevel": 2}),
                         outcome("d", 1, "TRIAGE_REVIEWED", {})])
    assert agreement_report(outs)["cases"] == 1


def test_no_cases_is_reported_plainly():
    assert agreement_report(pd.DataFrame(columns=["subjectKey", "outcomeType", "details", "day"]))["cases"] == 0


def test_wilson_interval_is_sane():
    w = wilson(5, 100)
    assert 0.02 < w["low"] < 0.05 < w["high"] < 0.12
    assert wilson(0, 10)["low"] == 0.0 and wilson(10, 10)["high"] == 1.0


# ------------------------------------------------------------------ readiness
def test_stage_thresholds_follow_the_stated_rules():
    dev = EVENTS_PER_PREDICTOR * len(FEATURES)
    assert development_events_needed() == dev
    assert _stage(0) == "INSUFFICIENT" and _stage(29) == "INSUFFICIENT"
    assert _stage(30) == "EXPLORATORY" and _stage(dev - 1) == "EXPLORATORY"
    assert _stage(dev) == "DEVELOPMENT_READY" and _stage(dev + VALIDATION_MIN_EVENTS - 1) == "DEVELOPMENT_READY"
    assert _stage(dev + VALIDATION_MIN_EVENTS) == "VALIDATION_READY"


def test_readiness_counts_people_once_however_many_rows_they_have():
    snaps = [snap("a", d) for d in range(0, 40, 2)] + [snap("b", d) for d in range(0, 150, 10)]
    outs = [outcome("a", 45)]
    s, o = tables(snaps, outs)
    r = target_readiness(s, o, TARGETS["adverse_event_90d"])
    assert r["event_subjects"] == 1
    assert r["rows"] > 1 and r["stage"] == "INSUFFICIENT"
    assert r["events_still_needed_for_validation"] == development_events_needed() + VALIDATION_MIN_EVENTS - 1
    assert any("ascertainment" in w for w in r["warnings"])


def test_readiness_warns_when_a_group_is_barely_represented():
    snaps = [snap(f"m{i}", 0, sex="male") for i in range(30)] + [snap("f0", 0, sex="female")]
    s, o = tables(snaps, [])
    r = target_readiness(s, o, TARGETS["adverse_event_90d"])
    assert any("female" in w for w in r["warnings"])


def test_readiness_report_on_an_empty_database_does_not_crash():
    s, o = tables([snap("a", 0)], [])
    rep = readiness_report(s, o)
    assert rep["triage_agreement"]["cases"] == 0 and len(rep["targets"]) == len(TARGETS)


# ------------------------------------------------------------------ contracts
def test_outcome_vocabulary_is_pinned():
    assert OUTCOME_TYPES == ("HYPERTENSION_DIAGNOSED", "DIABETES_DIAGNOSED", "CVD_EVENT", "ARRHYTHMIA_DIAGNOSED",
                             "HOSPITAL_ADMISSION", "EMERGENCY_REFERRAL", "DEATH", "ALERT_CONFIRMED", "ALERT_DISMISSED",
                             "TRIAGE_REVIEWED")


def test_targets_only_use_known_outcomes_and_features():
    for t in TARGETS.values():
        assert set(t.outcome_types) <= set(OUTCOME_TYPES)
        assert t.exclude_if_known is None or t.exclude_if_known in FEATURES
        assert t.horizon_days > 0


# ------------------------------------------------------------------ CLI
@pytest.fixture(autouse=True)
def model_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("RESEARCH_MODEL_DIR", str(tmp_path))


def test_cli_readiness_and_triage_on_synthetic_data(capsys):
    assert main(["readiness", "--source", "synthetic", "--synthetic-subjects", "60", "--json"]) == 0
    out = capsys.readouterr().out
    assert json.loads(out[: out.rindex("}") + 1])["targets"]
    assert main(["triage", "--source", "synthetic", "--synthetic-subjects", "60"]) == 0


def test_cli_refuses_to_train_without_enough_events(capsys):
    assert main(["train", "--target", "diabetes_365d", "--source", "synthetic", "--synthetic-subjects", "60"]) == 2
    assert "not enough events" in capsys.readouterr().err


def test_cli_train_then_approval_is_refused_for_synthetic(capsys):
    assert main(["train", "--target", "adverse_event_90d", "--source", "synthetic", "--synthetic-subjects", "500",
                 "--bootstrap", "20"]) == 0
    m = registry.list_models()[0]
    assert m["status"] == "CANDIDATE" and m["synthetic"]
    capsys.readouterr()
    assert main(["approve", m["name"], m["version"], "--by", "Dr A. Example"]) == 2
    assert "synthetic" in capsys.readouterr().err
    assert registry.load_approved() == []
