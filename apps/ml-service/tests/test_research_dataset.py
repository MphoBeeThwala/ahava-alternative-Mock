"""The modelling-frame rules that keep a model honest: incident-only, censoring, no leakage, subject-level splits."""
import numpy as np
import pytest

from research.dataset import build_frame, temporal_subject_split
from research.outcomes import Target, TARGETS
from research_helpers import outcome, snap, tables

T90 = TARGETS["adverse_event_90d"]


def frame_for(snaps, outs, target=T90):
    return build_frame(*tables(snaps, outs), target)


def rows(frame, subject):
    return frame[frame["subject"] == subject].sort_values("day")


def test_event_inside_horizon_labels_the_row_positive():
    f = frame_for([snap("a", 0)], [outcome("a", 60)])
    assert list(f["label"]) == [1]


def test_horizon_boundary_is_inclusive_at_90_and_not_at_91():
    on = frame_for([snap("a", 0)], [outcome("a", 90)])
    assert list(on["label"]) == [1]
    after = frame_for([snap("a", 0)], [outcome("a", 91)])
    assert list(after["label"]) == [0]  # event came after the horizon, and follow-up covered it: a true negative


def test_negative_requires_full_follow_up_otherwise_the_row_is_dropped():
    # Last seen day 30: we cannot say they were event-free for 90 days.
    short = frame_for([snap("a", 0), snap("a", 30)], [])
    assert len(short) == 0
    # Seen again at day 95: the day-0 row is now a genuine 90-day negative.
    long = frame_for([snap("a", 0), snap("a", 95)], [])
    assert len(long) == 1 and long["label"].iloc[0] == 0


def test_an_outcome_extends_known_follow_up():
    # No later snapshot, but a clinician recorded a (non-target) outcome at day 100: alive and observed.
    f = frame_for([snap("a", 0)], [outcome("a", 100, "ALERT_DISMISSED")])
    assert len(f) == 1 and f["label"].iloc[0] == 0


def test_prevalent_rows_after_the_event_are_excluded():
    # The day-120 row has plenty of follow-up (a snapshot at day 300), so only the prevalence rule can drop
    # it: without that rule it would enter as a bogus "negative" from someone who already had the event.
    f = frame_for([snap("a", 0), snap("a", 50), snap("a", 120), snap("a", 300)], [outcome("a", 60)])
    assert list(rows(f, "a")["label"]) == [1, 1]            # days 0 and 50 predict the day-60 event
    assert len(f) == 2


def test_a_row_on_the_event_day_is_excluded_not_labelled():
    f = frame_for([snap("a", 60)], [outcome("a", 60)])
    assert len(f) == 0


def test_features_never_see_the_future():
    snaps = [snap("a", 0, hrResting=60.0), snap("a", 5, hrResting=60.0), snap("a", 6, hrResting=60.0),
             snap("a", 7, hrResting=60.0), snap("a", 8, hrResting=140.0)]
    f = frame_for(snaps, [outcome("a", 200)])
    day7 = rows(f, "a").iloc[3]
    assert day7["hr_delta_14d"] == 0.0   # the 140 bpm reading on day 8 is invisible on day 7
    day8 = rows(f, "a").iloc[4]
    assert day8["hr_delta_14d"] == pytest.approx(80.0)


def test_new_diagnosis_targets_exclude_people_who_already_have_it():
    t = TARGETS["hypertension_180d"]
    snaps = [snap("known", 0, hypertensionKnown=True), snap("unknown", 0, hypertensionKnown=False),
             snap("never_asked", 0, hypertensionKnown=None)]
    outs = [outcome("known", 30, "HYPERTENSION_DIAGNOSED"), outcome("unknown", 30, "HYPERTENSION_DIAGNOSED"),
            outcome("never_asked", 30, "HYPERTENSION_DIAGNOSED")]
    f = frame_for(snaps, outs, t)
    assert set(f["subject"]) == {"unknown", "never_asked"}  # "known" is excluded; unknown status is NOT assumed to be "has it"


def test_only_the_targets_outcome_types_count():
    f = frame_for([snap("a", 0)], [outcome("a", 30, "ALERT_DISMISSED"), outcome("a", 200, "ALERT_CONFIRMED")])
    assert list(f["label"]) == [0]


def test_baseline_columns_are_carried_for_comparison():
    f = frame_for([snap("a", 0, liveAlertLevel="RED", liveFraminghamPct=12.5)], [outcome("a", 10)])
    assert f["live_alert_score"].iloc[0] == 2.0 and f["live_framingham_pct"].iloc[0] == 12.5


def test_temporal_split_is_by_whole_subjects_and_tests_on_the_latest():
    snaps, outs = [], []
    for i in range(20):
        snaps += [snap(f"s{i:02d}", i * 10), snap(f"s{i:02d}", i * 10 + 100)]
    f = frame_for(snaps, outs)
    tr, te = temporal_subject_split(f, test_fraction=0.25)
    train_subjects, test_subjects = set(f.iloc[tr]["subject"]), set(f.iloc[te]["subject"])
    assert not (train_subjects & test_subjects)
    assert len(test_subjects) == 5
    assert min(f[f["subject"].isin(test_subjects)]["day"]) >= max(f[f["subject"].isin(train_subjects)].groupby("subject")["day"].min())
