"""
Adversarial and statistical tests for the early-warning engine.

The other suites pin documented thresholds. These try to break the engine:
exact boundaries, randomised monotonicity, retries and duplicates, out-of-order
and clock-skewed data, nonsense input, determinism, and the rate at which a
healthy person is wrongly flagged (specificity) versus a deteriorating one
being caught (sensitivity) over a simulated 90 days.
"""
import random
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from engine import EarlyWarningEngine
from models import AlertLevel, BiometricData, BpReading

T0 = datetime(2026, 3, 1, 7, 0, tzinfo=timezone.utc)
RANK = {AlertLevel.GREEN: 0, AlertLevel.YELLOW: 1, AlertLevel.RED: 2}


@pytest.fixture
def engine():
    return EarlyWarningEngine()


def bp(engine, uid, when, sys, dia):
    return engine.ingest_bp(uid, BpReading(timestamp=when, systolic=sys, diastolic=dia))


def wearable(when, **kw):
    base = dict(timestamp=when, heart_rate_resting=68.0, hrv_rmssd=45.0, spo2=97.5, skin_temp_offset=0.0,
                respiratory_rate=15.0, step_count=5000, active_calories=0.0, sleep_duration_hours=7.2)
    base.update(kw)
    return BiometricData(**base)


# ---------------------------------------------------------------- boundaries
@pytest.mark.parametrize("sys,dia,expected", [
    (179, 119, AlertLevel.YELLOW),   # stage 2, not crisis
    (180, 90, AlertLevel.RED),       # systolic crisis threshold, inclusive
    (150, 120, AlertLevel.RED),      # diastolic crisis threshold, inclusive
    (160, 90, AlertLevel.YELLOW),    # stage 2 systolic, inclusive
    (150, 100, AlertLevel.YELLOW),   # stage 2 diastolic, inclusive
    (159, 99, AlertLevel.GREEN),     # just under stage 2 (single reading: no sustained rule yet)
    (120, 80, AlertLevel.GREEN),
    (89, 70, AlertLevel.YELLOW),     # low systolic
    (95, 49, AlertLevel.YELLOW),     # low diastolic
    (90, 50, AlertLevel.GREEN),      # exactly at the low limits is not low
])
def test_bp_boundaries(engine, user_id, sys, dia, expected):
    level, _ = bp(engine, user_id, T0, sys, dia)
    assert level == expected


# ------------------------------------------------------------- monotonicity
def test_raising_pressure_never_lowers_the_level(engine):
    rng = random.Random(1234)
    for _ in range(300):
        dia = rng.randint(55, 125)
        lo = rng.randint(max(dia + 10, 90), 200)
        hi = lo + rng.randint(0, 40)
        a = engine.ingest_bp(f"mono-a-{rng.random()}", BpReading(timestamp=T0, systolic=lo, diastolic=dia))[0]
        b = engine.ingest_bp(f"mono-b-{rng.random()}", BpReading(timestamp=T0, systolic=min(hi, 250), diastolic=dia))[0]
        assert RANK[b] >= RANK[a], (lo, hi, dia, a, b)


# ------------------------------------------------- retries, duplicates, order
def test_a_retried_reading_is_not_counted_twice(engine, user_id):
    """Three real readings sent twice each (a client retry) must not look like six."""
    for i in range(3):
        for _ in range(2):
            bp(engine, user_id, T0 + timedelta(hours=i * 12), 140, 90)
    _, _, a = engine._assess_measured_vitals(user_id, T0 + timedelta(days=2))
    assert a.readings_7d == 3, "duplicates inflate the reading count and can trigger 'sustained' early"


def test_a_retried_wearable_reading_is_stored_once(engine, user_id):
    for _ in range(3):
        engine.ingest(user_id, wearable(T0))
    import db
    assert len(db.load_biometrics(user_id, days=5, as_of=T0)) == 1


def test_arrival_order_does_not_change_the_final_assessment(engine):
    readings = [(T0 + timedelta(hours=12 * i), 136 + (i % 3), 88) for i in range(16)]
    end = readings[-1][0]

    sorted_uid, shuffled_uid = "order-sorted", "order-shuffled"
    for ts, s, d in readings:
        bp(engine, sorted_uid, ts, s, d)
    shuffled = readings[:]
    random.Random(7).shuffle(shuffled)
    for ts, s, d in shuffled:
        bp(engine, shuffled_uid, ts, s, d)

    la, aa, ba = engine._assess_measured_vitals(sorted_uid, end)
    lb, ab, bb = engine._assess_measured_vitals(shuffled_uid, end)
    assert (la, aa, ba.readings_7d, ba.mean_systolic_7d) == (lb, ab, bb.readings_7d, bb.mean_systolic_7d)


def test_naive_and_aware_timestamps_are_the_same_instant(engine):
    naive = datetime(2026, 3, 1, 7, 0)
    aware = datetime(2026, 3, 1, 7, 0, tzinfo=timezone.utc)
    assert bp(engine, "tz-naive", naive, 190, 110) == bp(engine, "tz-aware", aware, 190, 110)


# ---------------------------------------------------------------- bad input
def test_diastolic_above_systolic_is_rejected_not_flagged():
    """A transposed or mistyped reading (100/125) must be sent back, not turned into a crisis."""
    with pytest.raises(ValidationError):
        BpReading(timestamp=T0, systolic=100, diastolic=125)


@pytest.mark.parametrize("sys,dia", [(float("nan"), 80), (120, float("nan")), (float("inf"), 80), (-5, 80), (400, 80), (0, 0)])
def test_nonsense_numbers_are_rejected(sys, dia):
    with pytest.raises(ValidationError):
        BpReading(timestamp=T0, systolic=sys, diastolic=dia)


def test_wearable_nonsense_is_rejected():
    for bad in (dict(spo2=float("nan")), dict(heart_rate_resting=float("inf")), dict(hrv_rmssd=-1)):
        with pytest.raises(ValidationError):
            wearable(T0, **bad)


# ------------------------------------------------------------- determinism
def test_same_history_gives_identical_output_and_trace(engine):
    outs = []
    for uid in ("det-1", "det-2"):
        for i in range(10):
            engine.ingest(uid, wearable(T0 + timedelta(days=i), hrv_rmssd=45 + (i % 3)))
        s = engine.full_analysis(uid, wearable(T0 + timedelta(days=10)))
        outs.append((s.alert_level, s.anomalies, s.uncertainty.score, s.uncertainty.reasons, s.bp_assessment.level))
    assert outs[0] == outs[1]


# ------------------------------------------- simulated 90 days: specificity
def simulate_person(engine, uid, seed, *, days=90, sys_mean=118, dia_mean=76, drift=None, apnoea_from=None):
    """Two cuff readings a day plus a nightly wearable row. Returns per-day worst level."""
    rng = random.Random(seed)
    worst = {}
    for d in range(days):
        day = T0 + timedelta(days=d)
        extra = drift(d) if drift else 0
        apn = apnoea_from is not None and d >= apnoea_from
        w = wearable(
            day,
            heart_rate_resting=rng.gauss(66, 3), hrv_rmssd=max(15, rng.gauss(48, 6)),
            spo2=min(100, rng.gauss(97.3, 0.7)), respiratory_rate=min(20, max(12, rng.gauss(15, 1))),
            step_count=int(max(500, rng.gauss(6500, 1800))),
            sleep_duration_hours=min(9, max(5, rng.gauss(7.2, 0.6))),
            spo2_night_min=rng.gauss(86 if apn else 93, 1.5), night_odi_per_hr=max(0, rng.gauss(20 if apn else 2.5, 2.0)),
        )
        lv, _ = engine.ingest(uid, w)
        levels = [lv]
        for k in (0, 1):
            s = round(rng.gauss(sys_mean + extra, 6))
            dd = round(rng.gauss(dia_mean + extra * 0.6, 4))
            levels.append(bp(engine, uid, day + timedelta(hours=k * 13), max(s, dd + 15), dd)[0])
        worst[d] = max(levels, key=lambda l: RANK[l])
    return worst


def test_a_healthy_person_is_rarely_flagged_over_90_days(engine):
    """Specificity. Never RED; YELLOW on a small share of days at most, across many simulated people."""
    reds = yellow_days = total = 0
    for seed in range(25):
        worst = simulate_person(engine, f"healthy-{seed}", seed)
        reds += sum(1 for v in worst.values() if v == AlertLevel.RED)
        yellow_days += sum(1 for v in worst.values() if v == AlertLevel.YELLOW)
        total += len(worst)
    rate = yellow_days / total
    assert reds == 0, f"{reds} false RED days"
    assert rate <= 0.05, f"false YELLOW rate {rate:.1%} (target <= 5% of person-days)"


def test_a_steady_slow_climb_in_bp_is_caught_before_it_is_dangerous(engine):
    """Sensitivity. BP creeping +0.5 mmHg/day from a normal start must raise YELLOW well before day 60."""
    first_flag = []
    for seed in range(15):
        worst = simulate_person(engine, f"climb-{seed}", 100 + seed, drift=lambda d: 0.5 * d)
        flagged = [d for d, v in worst.items() if v != AlertLevel.GREEN and d >= 14]
        first_flag.append(flagged[0] if flagged else 999)
    assert max(first_flag) <= 45, f"slowest detection day: {max(first_flag)}"


def test_repeated_nocturnal_desaturation_is_caught_within_a_week(engine):
    caught = []
    for seed in range(15):
        worst = simulate_person(engine, f"apnoea-{seed}", 200 + seed, days=40, apnoea_from=20)
        flagged = [d for d, v in worst.items() if v != AlertLevel.GREEN and d >= 20]
        caught.append((flagged[0] - 20) if flagged else 99)
    assert max(caught) <= 7, f"slowest detection: {max(caught)} days after onset"


def test_a_crisis_is_red_regardless_of_history_or_activity(engine):
    for seed in range(10):
        uid = f"crisis-{seed}"
        simulate_person(engine, uid, 300 + seed, days=30)
        lv, a = bp(engine, uid, T0 + timedelta(days=30, hours=3), 192, 118)
        assert lv == AlertLevel.RED and a[0].startswith("bp_crisis_range")


# ---------------------------------------------------------- level vs score
def test_readiness_score_never_contradicts_the_alert_level(engine):
    rng = random.Random(5)
    for i in range(40):
        uid = f"score-{i}"
        engine.ingest(uid, wearable(T0))
        if rng.random() < 0.5:
            dia = rng.randint(60, 125)
            bp(engine, uid, T0 + timedelta(minutes=1), dia + rng.randint(15, 90), dia)
        engine.ingest(uid, wearable(T0 + timedelta(minutes=2)))
        level, _ = engine._evaluate(uid, wearable(T0 + timedelta(minutes=2)))
        score, _, _ = engine.get_readiness_score(uid)
        if level == AlertLevel.RED:
            assert score <= 40
        elif level == AlertLevel.YELLOW:
            assert score <= 75
