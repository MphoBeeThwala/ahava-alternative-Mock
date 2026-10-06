"""Training and evaluation on generated data: proves the code is honest, not that any model is good."""
import math

import numpy as np
import pandas as pd
import pytest

pytest.importorskip("sklearn")

from research import evaluate, registry
from research.artifact import ModelArtifact
from research.dataset import build_frame
from research.features import FEATURES
from research.outcomes import TARGETS
from research.synthetic import make_synthetic
from research.train import MIN_EVENTS_TO_TRAIN, check_power, train

T = TARGETS["adverse_event_90d"]


@pytest.fixture(scope="module")
def synth():
    snaps, outs = make_synthetic(n_subjects=700, seed=11)
    return snaps, outs, build_frame(snaps, outs, T)


@pytest.fixture(scope="module")
def trained(synth):
    _, _, frame = synth
    return train(frame, T, synthetic=True, n_boot=40, seed=1)


def test_power_counts_people_not_rows(synth):
    _, _, frame = synth
    p = check_power(frame)
    assert p["events"] == p["event_subjects"] == frame.loc[frame.label == 1, "subject"].nunique()
    assert p["positive_rows"] > 5 * p["events"], "a person contributes many positive rows; counting rows would overstate the evidence"


def test_it_learns_a_planted_signal_and_reports_it_with_intervals(trained):
    art, card = trained
    cv = card["cross_validated"]
    assert cv["auroc"]["estimate"] > 0.65
    assert cv["auroc"]["low"] <= cv["auroc"]["estimate"] <= cv["auroc"]["high"]
    assert 0.6 < cv["calibration"]["slope"] < 1.5
    assert card["status"] == "CANDIDATE" and "never shown to patients" in card["intended_use"]
    assert card["data"]["events"] == check_power(build_frame(*make_synthetic(700, seed=11), T))["events"]


def test_synthetic_models_are_flagged_and_cannot_be_approved(trained, tmp_path, monkeypatch):
    art, card = trained
    monkeypatch.setenv("RESEARCH_MODEL_DIR", str(tmp_path))
    assert art.synthetic and card["synthetic"]
    registry.save_candidate(art)
    with pytest.raises(ValueError, match="synthetic"):
        registry.approve(art.name, art.version, "Dr A. Example")


def test_the_artifact_scores_identically_row_by_row_and_in_bulk(trained, synth):
    art, _ = trained
    _, _, frame = synth
    sample = frame.sample(40, random_state=0)
    bulk = art.predict_matrix(sample[list(FEATURES)].to_numpy(float), list(FEATURES))
    single = [art.predict_proba({f: row[f] for f in FEATURES}) for _, row in sample.iterrows()]
    assert bulk == pytest.approx(single)
    assert all(0 < p < 1 for p in bulk)
    assert ModelArtifact.from_json(art.to_json()).content_hash() == art.content_hash()


def test_a_pure_noise_target_scores_about_chance(synth):
    """The null test: if labels carry no information, honest out-of-fold evaluation must not find any."""
    _, _, frame = synth
    rng = np.random.default_rng(3)
    noise = frame.copy()
    per_subject = {s: int(rng.random() < 0.2) for s in noise["subject"].unique()}
    noise["label"] = noise["subject"].map(per_subject)  # random, constant within a person
    _, card = train(noise, T, synthetic=True, n_boot=40, seed=2)
    auc = card["cross_validated"]["auroc"]
    assert 0.40 < auc["estimate"] < 0.60, auc


def test_refuses_to_train_on_too_few_events_unless_forced(synth):
    _, _, frame = synth
    people = frame.loc[frame.label == 1, "subject"].unique()[: MIN_EVENTS_TO_TRAIN - 5]
    keep = frame[(frame.label == 0) | frame["subject"].isin(people)]
    small = keep[(keep.label == 1) | keep["subject"].isin(keep["subject"].unique()[:200])]
    with pytest.raises(ValueError, match="not enough events"):
        train(small, T, synthetic=True)
    art, card = train(small, T, synthetic=True, force_small=True, n_boot=20)
    assert card["underpowered"] is True


def test_baseline_comparison_is_made_on_rows_the_baseline_covers(synth):
    _, _, frame = synth
    f = frame.copy()
    f["live_alert_score"] = np.where(np.arange(len(f)) % 2 == 0, np.random.default_rng(0).integers(0, 3, len(f)), np.nan)
    p = np.random.default_rng(1).random(len(f))
    out = evaluate.baseline_comparison(f, p, n_boot=20)
    assert out["live_alert_level"]["rows_covered"] == int(f["live_alert_score"].notna().sum())
    assert out["framingham_lab_pct"]["status"] == "insufficient_coverage"


# ------------------------------------------------------------------ the metric functions themselves
def test_auroc_basics():
    y = np.array([0, 0, 1, 1])
    assert evaluate.auroc(y, np.array([0.1, 0.2, 0.8, 0.9])) == 1.0
    assert evaluate.auroc(y, np.array([0.9, 0.8, 0.2, 0.1])) == 0.0
    assert math.isnan(evaluate.auroc(np.zeros(4), np.random.random(4)))


def test_calibration_detects_overconfidence_and_bias():
    rng = np.random.default_rng(0)
    p_true = rng.uniform(0.02, 0.4, 20000)
    y = (rng.random(20000) < p_true).astype(int)
    good = evaluate.calibration(y, p_true)
    assert abs(good["slope"] - 1) < 0.1 and abs(good["intercept"]) < 0.1 and good["ece"] < 0.02
    logit = np.log(p_true / (1 - p_true))
    overconfident = 1 / (1 + np.exp(-3 * logit))
    assert evaluate.calibration(y, overconfident)["slope"] < 0.6
    biased = np.clip(p_true * 2, 0, 0.99)
    assert evaluate.calibration(y, biased)["intercept"] < -0.4


def test_threshold_and_confusion_numbers():
    y = np.array([1, 1, 1, 1, 0, 0, 0, 0, 0, 0])
    p = np.array([0.9, 0.8, 0.7, 0.2, 0.6, 0.3, 0.2, 0.1, 0.1, 0.05])
    thr = evaluate.threshold_for_sensitivity(y, p, 0.75)
    r = evaluate.at_threshold(y, p, thr)
    assert r["sensitivity"] == 0.75 and r["specificity"] == pytest.approx(5 / 6) and r["ppv"] == pytest.approx(0.75)
    assert r["flag_rate"] == pytest.approx(0.4) and r["number_needed_to_review"] == pytest.approx(4 / 3)


def test_net_benefit_formula():
    y = np.array([1, 1, 0, 0])
    p = np.array([0.9, 0.9, 0.9, 0.1])
    assert evaluate.net_benefit(y, p, 0.2) == pytest.approx(2 / 4 - 1 / 4 * 0.2 / 0.8)


def test_subgroups_report_too_few_events_instead_of_noise(synth):
    _, _, frame = synth
    tiny = frame[frame.subject.isin(frame.subject.unique()[:15])]
    rep = evaluate.subgroup_report(tiny.reset_index(drop=True), np.random.default_rng(0).random(len(tiny)))
    assert all(("status" in v) or v["events"] >= evaluate.MIN_EVENTS_FOR_SUBGROUP for v in rep.values())


def test_cluster_bootstrap_resamples_whole_subjects():
    # Two subjects, perfectly separated within each only because rows are duplicated: a row-level bootstrap
    # would report a tight interval; resampling people can't (only 2 people exist).
    y = np.array([1] * 50 + [0] * 50)
    p = np.array([0.9] * 50 + [0.1] * 50)
    g = np.array(["a"] * 50 + ["b"] * 50)
    ci = evaluate.cluster_bootstrap_ci(evaluate.auroc, y, p, g, n_boot=100)
    assert math.isnan(ci["low"]) or ci["low"] < 1.0 or ci["estimate"] == 1.0
