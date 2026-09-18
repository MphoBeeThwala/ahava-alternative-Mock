"""
Shared fixtures for the ML early-warning engine test suite.

DATABASE_URL is deliberately left unset for this whole suite: db.py falls
back to an in-process dict store whenever it's unset (`_use_db = bool(
os.getenv("DATABASE_URL"))`), so these tests exercise the real ingest/
evaluate code path end to end without needing TimescaleDB/Postgres running.
That in-memory store is a module-level dict shared across the whole test
session, so every test uses a fresh, randomly generated user_id to avoid
cross-test contamination.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

os.environ.pop("DATABASE_URL", None)

from models import BiometricData  # noqa: E402


@pytest.fixture
def user_id() -> str:
    return f"test-user-{uuid.uuid4().hex[:12]}"


@pytest.fixture
def make_biometric():
    def _make(**overrides) -> BiometricData:
        defaults = dict(
            timestamp=datetime.now(timezone.utc),
            heart_rate_resting=70.0,
            hrv_rmssd=40.0,
            spo2=98.0,
            skin_temp_offset=0.0,
            respiratory_rate=15.0,
            step_count=0,
            active_calories=0.0,
            sleep_duration_hours=7.0,
            ecg_rhythm="unknown",
            temperature_trend="normal",
        )
        defaults.update(overrides)
        return BiometricData(**defaults)

    return _make


@pytest.fixture
def days_ago():
    def _days_ago(n: float) -> datetime:
        return datetime.now(timezone.utc) - timedelta(days=n)

    return _days_ago
