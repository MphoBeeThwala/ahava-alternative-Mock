"""
EarlyWarningEngine._absolute_floor — the baseline-independent, SATS/NEWS2-
aligned safety net (AH-43/44/50 gap-report fixes described in engine.py's
own comments). This is the one check that fires even with zero history, so
its thresholds are the actual last line of defense for a brand-new patient
on their very first reading. Pinning every documented boundary exactly.
"""
import pytest

from engine import EarlyWarningEngine
from models import AlertLevel


@pytest.fixture
def engine():
    return EarlyWarningEngine()


class TestSpo2Thresholds:
    def test_spo2_at_or_below_91_is_red(self, engine, make_biometric):
        level, anomalies = engine._absolute_floor(make_biometric(spo2=91, respiratory_rate=15))
        assert level == AlertLevel.RED
        assert any("spo2" in a for a in anomalies)

    def test_spo2_far_below_critical_is_red(self, engine, make_biometric):
        level, _ = engine._absolute_floor(make_biometric(spo2=80, respiratory_rate=15))
        assert level == AlertLevel.RED

    def test_spo2_92_to_93_is_yellow(self, engine, make_biometric):
        level, anomalies = engine._absolute_floor(make_biometric(spo2=93, respiratory_rate=15))
        assert level == AlertLevel.YELLOW
        assert any("spo2" in a for a in anomalies)

    def test_spo2_94_to_96_alone_is_indeterminate_but_not_escalated(self, engine, make_biometric):
        # §50.4: indeterminate band is "not reassuring" but only escalates
        # alongside a respiratory-rate deviation, never on its own.
        level, anomalies = engine._absolute_floor(make_biometric(spo2=95, respiratory_rate=15))
        assert level == AlertLevel.GREEN
        assert any("indeterminate" in a for a in anomalies)

    def test_spo2_94_to_96_with_rr_deviation_escalates_to_yellow(self, engine, make_biometric):
        level, _ = engine._absolute_floor(make_biometric(spo2=95, respiratory_rate=25))
        assert level == AlertLevel.YELLOW

    def test_spo2_above_96_is_clean(self, engine, make_biometric):
        level, anomalies = engine._absolute_floor(make_biometric(spo2=98, respiratory_rate=15))
        assert level == AlertLevel.GREEN
        assert not any("spo2" in a for a in anomalies)


class TestRespiratoryRateThresholds:
    def test_rr_30_or_above_is_red(self, engine, make_biometric):
        level, anomalies = engine._absolute_floor(make_biometric(respiratory_rate=30, spo2=98))
        assert level == AlertLevel.RED
        assert any("respiratory_rate" in a for a in anomalies)

    def test_rr_8_or_below_is_red(self, engine, make_biometric):
        level, _ = engine._absolute_floor(make_biometric(respiratory_rate=8, spo2=98))
        assert level == AlertLevel.RED

    def test_rr_24_to_29_is_yellow(self, engine, make_biometric):
        level, _ = engine._absolute_floor(make_biometric(respiratory_rate=25, spo2=98))
        assert level == AlertLevel.YELLOW

    def test_rr_9_to_10_is_yellow(self, engine, make_biometric):
        level, _ = engine._absolute_floor(make_biometric(respiratory_rate=10, spo2=98))
        assert level == AlertLevel.YELLOW

    def test_rr_normal_range_is_clean(self, engine, make_biometric):
        level, anomalies = engine._absolute_floor(make_biometric(respiratory_rate=16, spo2=98))
        assert level == AlertLevel.GREEN
        assert not any("respiratory_rate" in a for a in anomalies)


class TestHeartRateThresholds:
    def test_hr_130_or_above_is_red(self, engine, make_biometric):
        level, anomalies = engine._absolute_floor(make_biometric(heart_rate_resting=130, spo2=98, respiratory_rate=15))
        assert level == AlertLevel.RED
        assert any("heart_rate_resting" in a for a in anomalies)

    def test_hr_40_or_below_is_red(self, engine, make_biometric):
        level, _ = engine._absolute_floor(make_biometric(heart_rate_resting=40, spo2=98, respiratory_rate=15))
        assert level == AlertLevel.RED

    def test_hr_120_to_129_is_yellow(self, engine, make_biometric):
        level, _ = engine._absolute_floor(make_biometric(heart_rate_resting=125, spo2=98, respiratory_rate=15))
        assert level == AlertLevel.YELLOW

    def test_hr_41_to_45_is_yellow(self, engine, make_biometric):
        level, _ = engine._absolute_floor(make_biometric(heart_rate_resting=42, spo2=98, respiratory_rate=15))
        assert level == AlertLevel.YELLOW

    def test_hr_normal_range_is_clean(self, engine, make_biometric):
        level, anomalies = engine._absolute_floor(make_biometric(heart_rate_resting=72, spo2=98, respiratory_rate=15))
        assert level == AlertLevel.GREEN
        assert not any("heart_rate_resting" in a for a in anomalies)


class TestCombinedAndWorstOf:
    def test_all_vitals_normal_is_green_with_no_anomalies(self, engine, make_biometric):
        level, anomalies = engine._absolute_floor(make_biometric())
        assert level == AlertLevel.GREEN
        assert anomalies == []

    def test_one_critical_vital_among_normal_others_still_red(self, engine, make_biometric):
        level, anomalies = engine._absolute_floor(
            make_biometric(spo2=98, respiratory_rate=15, heart_rate_resting=135)
        )
        assert level == AlertLevel.RED
        assert len(anomalies) == 1

    def test_red_from_one_metric_is_never_downgraded_by_a_later_yellow_check(self, engine, make_biometric):
        # spo2 breaches RED first; respiratory_rate only breaches YELLOW.
        # The YELLOW branches guard with a rank check specifically so this
        # can't downgrade an already-RED level.
        level, anomalies = engine._absolute_floor(
            make_biometric(spo2=85, respiratory_rate=25, heart_rate_resting=70)
        )
        assert level == AlertLevel.RED
        assert any("spo2" in a for a in anomalies)
        assert any("respiratory_rate" in a for a in anomalies)

    def test_multiple_yellow_breaches_stay_yellow_not_red(self, engine, make_biometric):
        level, anomalies = engine._absolute_floor(
            make_biometric(spo2=93, respiratory_rate=25, heart_rate_resting=125)
        )
        assert level == AlertLevel.YELLOW
        assert len(anomalies) == 3
