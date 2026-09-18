"""
EarlyWarningEngine.ingest / _evaluate end to end, via db.py's in-memory
fallback (DATABASE_URL unset — see conftest.py). Covers the behavior the
absolute-floor unit tests alone can't show: that a brand-new patient with
zero history still gets flagged on a genuinely critical first reading
(the AH-43/44 fix engine.py's __init__ comment describes — "no baseline
yet" must never mean a catastrophic reading reads GREEN), and that the
exercise-context suppression only ever softens a YELLOW, never a RED.
"""
from datetime import timedelta

from engine import EarlyWarningEngine
from models import AlertLevel


class TestFirstReadingNoHistory:
    def test_normal_first_reading_is_green(self, user_id, make_biometric):
        engine = EarlyWarningEngine()
        level, anomalies = engine.ingest(user_id, make_biometric())
        assert level == AlertLevel.GREEN
        assert any("No history yet" in a for a in anomalies)

    def test_critical_first_reading_is_red_despite_no_baseline(self, user_id, make_biometric):
        # This is the specific regression AH-43/44 fixed: a first-ever
        # reading used to be unconditionally GREEN ("no baseline to compare
        # against yet"), which meant a patient could submit a genuinely
        # critical reading as their very first data point and see no alert.
        engine = EarlyWarningEngine()
        level, anomalies = engine.ingest(user_id, make_biometric(spo2=80, respiratory_rate=15))
        assert level == AlertLevel.RED
        assert any("absolute floor" in a.lower() for a in anomalies)

    def test_borderline_indeterminate_spo2_alone_on_first_reading_stays_green(self, user_id, make_biometric):
        engine = EarlyWarningEngine()
        level, _ = engine.ingest(user_id, make_biometric(spo2=95, respiratory_rate=15))
        assert level == AlertLevel.GREEN


class TestExerciseContextSuppression:
    def test_high_step_count_suppresses_a_yellow_heart_rate_reading(self, user_id, make_biometric, days_ago):
        engine = EarlyWarningEngine()
        # _is_exercise_context requires >= 10 prior readings with step_count
        # populated, and compares the current reading's steps against the
        # 90th percentile of history — seed a history of low-activity days
        # plus this one high-activity day.
        for i in range(12):
            engine.ingest(
                user_id,
                make_biometric(
                    timestamp=days_ago(12 - i),
                    heart_rate_resting=70,
                    step_count=2000,
                    spo2=98,
                    respiratory_rate=15,
                ),
            )

        level, anomalies = engine.ingest(
            user_id,
            make_biometric(heart_rate_resting=125, step_count=20000, spo2=98, respiratory_rate=15),
        )

        assert level == AlertLevel.GREEN
        assert any("Suppressed" in a for a in anomalies)

    def test_exercise_context_never_suppresses_a_red_absolute_floor_breach(self, user_id, make_biometric, days_ago):
        engine = EarlyWarningEngine()
        for i in range(12):
            engine.ingest(
                user_id,
                make_biometric(
                    timestamp=days_ago(12 - i),
                    heart_rate_resting=70,
                    step_count=2000,
                    spo2=98,
                    respiratory_rate=15,
                ),
            )

        # Critically low SpO2 during a high-activity reading — desaturation
        # during exercise is dangerous, not a benign side-effect of it.
        level, anomalies = engine.ingest(
            user_id,
            make_biometric(spo2=85, step_count=20000, respiratory_rate=15, heart_rate_resting=120),
        )

        assert level == AlertLevel.RED
        assert any("not suppressed" in a for a in anomalies)


class TestPersistenceGating:
    def test_a_single_isolated_elevated_reading_does_not_escalate(self, user_id, make_biometric, days_ago):
        # §50.3: the current reading must breach AND recur on >=2 of the
        # last 3 readings before it counts — build a stable personal
        # baseline, then submit one elevated-but-not-floor-breaching HR
        # reading (below the 120 YELLOW absolute floor, so only the
        # baseline-relative path could flag it) with no persistence behind
        # it.
        engine = EarlyWarningEngine()
        for i in range(20):
            engine.ingest(
                user_id,
                make_biometric(
                    timestamp=days_ago(20 - i),
                    heart_rate_resting=70 + (i % 3),  # small natural variation, avoids std=0
                    spo2=98,
                    respiratory_rate=15,
                ),
            )

        level, _ = engine.ingest(
            user_id,
            make_biometric(heart_rate_resting=95, spo2=98, respiratory_rate=15),
        )

        assert level == AlertLevel.GREEN

    def test_a_persistent_elevated_heart_rate_does_escalate(self, user_id, make_biometric, days_ago):
        engine = EarlyWarningEngine()
        for i in range(20):
            engine.ingest(
                user_id,
                make_biometric(
                    timestamp=days_ago(20 - i),
                    heart_rate_resting=70 + (i % 3),
                    spo2=98,
                    respiratory_rate=15,
                ),
            )

        # Two elevated readings in a row (both below the 120 absolute
        # floor), so this can only be the persistence-gated baseline-
        # relative path firing, not _absolute_floor.
        engine.ingest(user_id, make_biometric(heart_rate_resting=100, spo2=98, respiratory_rate=15))
        level, anomalies = engine.ingest(
            user_id, make_biometric(heart_rate_resting=100, spo2=98, respiratory_rate=15)
        )

        assert level == AlertLevel.YELLOW
        assert any("persistent" in a for a in anomalies)
