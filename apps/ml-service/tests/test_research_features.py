import math

from research.features import FEATURES, FEATURE_SCHEMA_HASH, age_mid, build_features
from research_helpers import snap


def test_every_feature_is_produced_and_unknowns_stay_nan():
    f = build_features(snap("s", 10))
    assert set(f) == set(FEATURES)
    # Not measured / not asked: NaN, never a silent 0 or "no".
    for name in ("smoker", "diabetes", "hiv_positive", "sbp", "glucose", "bmi", "total_chol", "hr_delta_14d"):
        assert math.isnan(f[name]), name
    # ...but whether something was measured is itself recorded.
    assert (f["sbp_missing"], f["glucose_missing"], f["bmi_missing"]) == (1.0, 1.0, 1.0)


def test_known_values_pass_through_and_unknown_sex_is_nan():
    f = build_features(snap("s", 10, smoker=False, sbp=131.0, steps=8000, sex=None))
    assert f["smoker"] == 0.0 and f["sbp"] == 131.0 and f["sbp_missing"] == 0.0 and f["steps_k"] == 8.0
    assert math.isnan(f["sex_male"])


def test_history_is_strictly_earlier_days_only():
    now = snap("s", 20, hrResting=80.0)
    past = [snap("s", d, hrResting=60.0) for d in (8, 10, 12, 14)]
    base = build_features(now, past)
    assert base["hr_delta_14d"] == 20.0 and base["n_prior_14d"] == 4

    # A same-day record and later records must change nothing: that is the leakage guard.
    contaminated = past + [snap("s", 20, hrResting=200.0), snap("s", 21, hrResting=200.0), snap("s", 40, hrResting=200.0)]
    after = build_features(now, contaminated)
    assert all(
        (math.isnan(base[k]) and math.isnan(after[k])) or base[k] == after[k] for k in FEATURES
    ), "features changed when same-day/future records were added"


def test_old_history_outside_the_window_is_ignored():
    f = build_features(snap("s", 60, hrResting=70.0), [snap("s", d, hrResting=50.0) for d in (1, 2, 3, 4)])
    assert f["n_prior_14d"] == 0 and math.isnan(f["hr_delta_14d"])


def test_delta_needs_at_least_three_prior_readings():
    assert math.isnan(build_features(snap("s", 20, hrResting=80.0), [snap("s", 18), snap("s", 19)])["hr_delta_14d"])
    assert not math.isnan(build_features(snap("s", 20, hrResting=80.0), [snap("s", 17), snap("s", 18), snap("s", 19)])["hr_delta_14d"])


def test_slope_direction():
    rising = [snap("s", d, hrResting=60.0 + (d - 10)) for d in range(10, 16)]
    falling = [snap("s", d, hrResting=80.0 - (d - 10)) for d in range(10, 16)]
    assert build_features(snap("s", 20), rising)["hr_slope_14d"] > 0.9
    assert build_features(snap("s", 20), falling)["hr_slope_14d"] < -0.9


def test_spo2_minimum_includes_this_reading():
    f = build_features(snap("s", 20, spo2=88.0), [snap("s", d, spo2=97.0) for d in (15, 16, 17)])
    assert f["spo2_min_14d"] == 88.0


def test_age_mid():
    assert age_mid("40-44") == 42.0 and age_mid("18-24") == 21.0 and age_mid("85+") == 87.0
    assert math.isnan(age_mid(None)) and math.isnan(age_mid("junk"))


def test_schema_hash_is_stable_and_present():
    assert len(FEATURE_SCHEMA_HASH) == 64
