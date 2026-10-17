"""
Measured-vitals rules: cuff blood pressure and overnight oximetry.

These are the rules that make a directly measured BP count. Before them the
engine only looked at wearable proxies (HR/HRV/SpO2 daily mean), so a 201/122
hypertensive-crisis reading stayed GREEN. Windows are anchored on each
reading's own timestamp so back-filled history is evaluated correctly.
"""
from datetime import datetime, timedelta, timezone

import pytest

from engine import EarlyWarningEngine
from models import AlertLevel, BpReading

T0 = datetime(2026, 8, 1, 7, 0, tzinfo=timezone.utc)


@pytest.fixture
def engine():
    return EarlyWarningEngine()


def bp(engine, user_id, when, sys, dia):
    return engine.ingest_bp(user_id, BpReading(timestamp=when, systolic=sys, diastolic=dia))


def feed(engine, user_id, start, days, sys, dia, per_day=2):
    last = (AlertLevel.GREEN, [])
    for d in range(days):
        for k in range(per_day):
            last = bp(engine, user_id, start + timedelta(days=d, hours=k * 13), sys, dia)
    return last


class TestCrisisRange:
    def test_first_ever_crisis_reading_is_red(self, engine, user_id):
        level, anomalies = bp(engine, user_id, T0, 201, 122)
        assert level == AlertLevel.RED
        assert anomalies[0].startswith("bp_crisis_range")

    def test_diastolic_alone_at_120_is_red(self, engine, user_id):
        level, _ = bp(engine, user_id, T0, 150, 120)
        assert level == AlertLevel.RED

    def test_179_over_119_is_not_crisis(self, engine, user_id):
        level, anomalies = bp(engine, user_id, T0, 179, 119)
        assert not any(a.startswith("bp_crisis") for a in anomalies)

    def test_red_while_recent_then_yellow_then_clears(self, engine, user_id):
        bp(engine, user_id, T0, 204, 124)
        # recheck an hour later is still high but below crisis: crisis remains RED within 6h
        level, _ = bp(engine, user_id, T0 + timedelta(hours=1), 170, 107)
        assert level == AlertLevel.RED
        # 12h later, normal reading: crisis is remembered as YELLOW for 72h
        level, anomalies = bp(engine, user_id, T0 + timedelta(hours=12), 128, 82)
        assert level == AlertLevel.YELLOW
        assert any(a.startswith("bp_recent_crisis") for a in anomalies)
        # 4 days later it no longer counts
        level, anomalies = bp(engine, user_id, T0 + timedelta(days=4), 126, 80)
        assert not any("crisis" in a for a in anomalies)


class TestOtherBpRules:
    def test_stage2_single_reading_is_yellow(self, engine, user_id):
        level, anomalies = bp(engine, user_id, T0, 165, 98)
        assert level == AlertLevel.YELLOW
        assert anomalies[0].startswith("bp_stage2")

    def test_low_bp_is_yellow(self, engine, user_id):
        level, anomalies = bp(engine, user_id, T0, 85, 55)
        assert level == AlertLevel.YELLOW
        assert anomalies[0].startswith("bp_low")

    def test_normal_bp_is_green(self, engine, user_id):
        level, anomalies = feed(engine, user_id, T0, 7, 118, 76)
        assert level == AlertLevel.GREEN and anomalies == []

    def test_sustained_home_hypertension_is_yellow(self, engine, user_id):
        level, anomalies = feed(engine, user_id, T0, 5, 138, 88)
        assert level == AlertLevel.YELLOW
        assert any(a.startswith("bp_sustained_elevated") for a in anomalies)

    def test_sustained_needs_enough_readings(self, engine, user_id):
        level, anomalies = bp(engine, user_id, T0, 138, 88)
        assert not any(a.startswith("bp_sustained") for a in anomalies)

    def test_rising_trend_is_flagged_before_any_threshold(self, engine, user_id):
        # two weeks at 126/80 (below every absolute threshold), then a climb to ~140
        feed(engine, user_id, T0, 14, 126, 80)
        level, anomalies = feed(engine, user_id, T0 + timedelta(days=14), 3, 140, 84)
        assert any(a.startswith("bp_rising") for a in anomalies)
        assert not any(a.startswith("bp_stage2") or a.startswith("bp_crisis") for a in anomalies)
        assert level == AlertLevel.YELLOW


    def test_small_rise_inside_normal_noise_is_not_flagged(self, engine, user_id):
        # prior fortnight swings 120-140 (SD ~10); a +5 mean shift is within noise
        for d in range(14):
            for k, v in enumerate((120, 140)):
                bp(engine, user_id, T0 + timedelta(days=d, hours=k * 13), v, 80)
        _, anomalies = feed(engine, user_id, T0 + timedelta(days=14), 3, 135, 82)
        assert not any(a.startswith("bp_rising") for a in anomalies)

    def test_modest_steady_climb_is_flagged(self, engine, user_id):
        # steady 136 for two weeks then ~142: +6 on a very steady person
        feed(engine, user_id, T0, 14, 136, 86)
        _, anomalies = feed(engine, user_id, T0 + timedelta(days=14), 3, 142, 88)
        assert any(a.startswith("bp_rising") for a in anomalies)


class TestWindowsFollowReadingTime:
    def test_backfilled_history_is_seen(self, engine, user_id):
        # Old timestamps, ingested "now": the window must anchor on the reading.
        feed(engine, user_id, datetime(2025, 1, 1, tzinfo=timezone.utc), 5, 138, 88)
        _, anomalies = bp(engine, user_id, datetime(2025, 1, 6, tzinfo=timezone.utc), 139, 89)
        assert any(a.startswith("bp_sustained_elevated") for a in anomalies)


class TestNocturnalOximetry:
    def _night(self, make_biometric, when, low, odi):
        return make_biometric(timestamp=when, spo2_night_min=low, night_odi_per_hr=odi)

    def test_repeated_low_nights_flag(self, engine, user_id, make_biometric):
        level = AlertLevel.GREEN
        for d in range(4):
            level, anomalies = engine.ingest(user_id, self._night(make_biometric, T0 + timedelta(days=d), 86, 4))
        assert level == AlertLevel.YELLOW
        assert any(a.startswith("nocturnal_hypoxaemia") for a in anomalies)

    def test_high_odi_pattern_flags(self, engine, user_id, make_biometric):
        for d in range(5):
            level, anomalies = engine.ingest(user_id, self._night(make_biometric, T0 + timedelta(days=d), 92, 18))
        assert any(a.startswith("nocturnal_desaturation_pattern") for a in anomalies)

    def test_one_bad_night_alone_does_not_flag(self, engine, user_id, make_biometric):
        level, anomalies = engine.ingest(user_id, self._night(make_biometric, T0, 84, 20))
        assert not any(a.startswith("nocturnal") for a in anomalies)


class TestFullAnalysis:
    def test_summary_carries_bp_assessment_and_fills_missing_systolic(self, engine, user_id, make_biometric):
        feed(engine, user_id, T0, 5, 138, 88)
        data = make_biometric(timestamp=T0 + timedelta(days=5))
        summary = engine.full_analysis(user_id, data)
        assert summary.bp_assessment.readings_7d >= 6
        assert summary.bp_assessment.level == "YELLOW"
        assert summary.alert_level == AlertLevel.YELLOW
        assert "bp_sustained_elevated" in summary.bp_assessment.flags


class TestReadinessScore:
    def test_informational_notes_do_not_cost_points(self, engine, user_id, make_biometric):
        # a normal first reading yields only the "No history yet" note
        engine.ingest(user_id, make_biometric(timestamp=T0))
        score, _, _ = engine.get_readiness_score(user_id)
        assert score == 100

    def test_yellow_is_capped_at_75(self, engine, user_id, make_biometric):
        bp(engine, user_id, T0, 165, 98)  # stage 2: one finding (85) but a YELLOW level
        engine.ingest(user_id, make_biometric(timestamp=T0 + timedelta(minutes=1)))
        score, _, _ = engine.get_readiness_score(user_id)
        assert score == 75

    def test_score_never_contradicts_alert_level(self, engine, user_id, make_biometric):
        bp(engine, user_id, T0, 205, 125)  # one crisis finding would otherwise be 85
        engine.ingest(user_id, make_biometric(timestamp=T0 + timedelta(minutes=1)))
        score, _, _ = engine.get_readiness_score(user_id)
        assert score <= 40
