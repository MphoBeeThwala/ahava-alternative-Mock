"""
TimescaleDB persistence layer for the ML Early Warning Service.

Replaces the in-memory DATA_STORE / CONTEXT_STORE dicts so that all
biometric history survives service restarts, scaling events, and deployments.

Requirements: psycopg2-binary (added to requirements.txt)
Database:     The same PostgreSQL instance used by the Node backend,
              with the TimescaleDB extension enabled and the
              biometric_time_series hypertable created via the migration
              in apps/backend/prisma/migrations/timescaledb/init.sql
"""

import os
import json
import logging
from typing import List, Optional
from datetime import datetime, timedelta, timezone

import psycopg2
import psycopg2.extras
import psycopg2.pool

from models import BiometricData, ContextualProfile

logger = logging.getLogger(__name__)

_db_url = os.getenv("DATABASE_URL")
_use_db = bool(_db_url)
_timescale_mode = (os.getenv("TIMESCALE_MODE", "auto") or "auto").strip().lower()
_memory_biometrics: dict[str, list[dict]] = {}
_memory_context: dict[str, ContextualProfile] = {}

# ---------------------------------------------------------------------------
# Connection pool (shared across requests for the lifetime of the process)
# ---------------------------------------------------------------------------
_pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        if not _db_url:
            raise RuntimeError("DATABASE_URL environment variable not set")
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
            dsn=_db_url,
        )
        logger.info("[db] Connection pool created")
    return _pool


def _get_conn():
    return _get_pool().getconn()


def _put_conn(conn):
    _get_pool().putconn(conn)


# ---------------------------------------------------------------------------
# Ensure hypertable exists (idempotent — safe to call on every startup)
# ---------------------------------------------------------------------------
HYPERTABLE_SQL = """
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS biometric_time_series (
    time                TIMESTAMPTZ NOT NULL,
    user_id             TEXT        NOT NULL,
    hr_resting          DOUBLE PRECISION,
    hrv_rmssd           DOUBLE PRECISION,
    spo2                DOUBLE PRECISION,
    resp_rate           DOUBLE PRECISION,
    step_count          INTEGER,
    active_cals         DOUBLE PRECISION,
    sleep_hrs           DOUBLE PRECISION,
    skin_temp           DOUBLE PRECISION,
    ecg_rhythm          TEXT        DEFAULT 'unknown',
    temp_trend          TEXT        DEFAULT 'normal',
    alert_level         TEXT        DEFAULT 'GREEN',
    anomalies           JSONB       DEFAULT '[]'
);

SELECT create_hypertable(
    'biometric_time_series', 'time',
    if_not_exists => TRUE,
    migrate_data  => TRUE
);

CREATE INDEX IF NOT EXISTS bts_user_time_idx
    ON biometric_time_series (user_id, time DESC);
"""

PLAIN_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS biometric_time_series (
    time         TIMESTAMPTZ NOT NULL,
    user_id      TEXT        NOT NULL,
    hr_resting   DOUBLE PRECISION,
    hrv_rmssd    DOUBLE PRECISION,
    spo2         DOUBLE PRECISION,
    resp_rate    DOUBLE PRECISION,
    step_count   INTEGER,
    active_cals  DOUBLE PRECISION,
    sleep_hrs    DOUBLE PRECISION,
    skin_temp    DOUBLE PRECISION,
    ecg_rhythm   TEXT DEFAULT 'unknown',
    temp_trend   TEXT DEFAULT 'normal',
    alert_level  TEXT DEFAULT 'GREEN',
    anomalies    JSONB DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS bts_user_time_idx
    ON biometric_time_series (user_id, time DESC);
"""


def ensure_schema() -> None:
    """Call once at service startup to create hypertable if not already present."""
    if not _use_db:
        return
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            if _timescale_mode == "off":
                cur.execute(PLAIN_TABLE_SQL)
                conn.commit()
                logger.info("[db] TIMESCALE_MODE=off; plain PostgreSQL table ready")
                return

            # Try TimescaleDB first; fall back gracefully to plain Postgres table
            try:
                cur.execute(HYPERTABLE_SQL)
                conn.commit()
                logger.info("[db] TimescaleDB hypertable ready")
            except Exception as ts_err:
                conn.rollback()
                logger.warning(
                    "[db] TimescaleDB extension unavailable (%s); "
                    "creating plain table as fallback", ts_err
                )
                cur.execute(PLAIN_TABLE_SQL)
                conn.commit()
    finally:
        _put_conn(conn)


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------
def save_biometric(
    user_id: str,
    data: BiometricData,
    alert_level: str,
    anomalies: list,
) -> None:
    if not _use_db:
        row = data.model_dump()
        row["alert_level"] = alert_level
        row["anomalies"] = anomalies
        _memory_biometrics.setdefault(user_id, []).append(row)
        return
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO biometric_time_series
                    (time, user_id, hr_resting, hrv_rmssd, spo2, resp_rate,
                     step_count, active_cals, sleep_hrs, skin_temp,
                     ecg_rhythm, temp_trend, alert_level, anomalies)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    data.timestamp,
                    user_id,
                    data.heart_rate_resting,
                    data.hrv_rmssd,
                    data.spo2,
                    data.respiratory_rate,
                    data.step_count,
                    data.active_calories,
                    data.sleep_duration_hours,
                    data.skin_temp_offset,
                    getattr(data, "ecg_rhythm", "unknown") or "unknown",
                    getattr(data, "temperature_trend", "normal") or "normal",
                    alert_level,
                    psycopg2.extras.Json(anomalies),
                ),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _put_conn(conn)


# ---------------------------------------------------------------------------
# Read — returns rows as plain dicts with keys matching BiometricData fields
# ---------------------------------------------------------------------------
def load_biometrics(user_id: str, days: int = 30) -> List[dict]:
    if not _use_db:
        rows = _memory_biometrics.get(user_id, [])
        if not rows:
            return []
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        filtered = [r for r in rows if isinstance(r.get("timestamp"), datetime) and r["timestamp"].astimezone(timezone.utc) >= cutoff]
        return sorted(filtered, key=lambda r: r.get("timestamp") or datetime.now(timezone.utc))
    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    time        AS timestamp,
                    hr_resting  AS heart_rate_resting,
                    hrv_rmssd,
                    spo2,
                    resp_rate   AS respiratory_rate,
                    step_count,
                    active_cals AS active_calories,
                    sleep_hrs   AS sleep_duration_hours,
                    skin_temp   AS skin_temp_offset,
                    ecg_rhythm,
                    temp_trend  AS temperature_trend,
                    alert_level,
                    anomalies
                FROM biometric_time_series
                WHERE user_id = %s
                  AND time > NOW() - INTERVAL '1 day' * %s
                ORDER BY time ASC
                """,
                (user_id, days),
            )
            rows = cur.fetchall()
            return [dict(r) for r in rows]
    finally:
        _put_conn(conn)


def load_latest_biometric(user_id: str) -> Optional[dict]:
    if not _use_db:
        rows = _memory_biometrics.get(user_id, [])
        if not rows:
            return None
        return max(rows, key=lambda r: r.get("timestamp") or datetime.min.replace(tzinfo=timezone.utc))
    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    time        AS timestamp,
                    hr_resting  AS heart_rate_resting,
                    hrv_rmssd,
                    spo2,
                    resp_rate   AS respiratory_rate,
                    step_count,
                    active_cals AS active_calories,
                    sleep_hrs   AS sleep_duration_hours,
                    skin_temp   AS skin_temp_offset,
                    ecg_rhythm,
                    temp_trend  AS temperature_trend,
                    alert_level,
                    anomalies
                FROM biometric_time_series
                WHERE user_id = %s
                ORDER BY time DESC
                LIMIT 1
                """,
                (user_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        _put_conn(conn)


def count_biometrics(user_id: str, days: int = 30) -> int:
    if not _use_db:
        return len(load_biometrics(user_id, days=days))
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)
                FROM biometric_time_series
                WHERE user_id = %s
                  AND time > NOW() - INTERVAL '1 day' * %s
                """,
                (user_id, days),
            )
            result = cur.fetchone()
            return int(result[0]) if result else 0
    finally:
        _put_conn(conn)


# ---------------------------------------------------------------------------
# Context (CVD risk profile) — stored in User.riskProfile JSON via Prisma
# We read it directly from the shared PostgreSQL users table.
# ---------------------------------------------------------------------------
def load_context(user_id: str) -> Optional[ContextualProfile]:
    if not _use_db:
        return _memory_context.get(user_id)
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT "riskProfile" FROM users WHERE id = %s',
                (user_id,),
            )
            row = cur.fetchone()
            if not row or not row[0]:
                return None
            profile_data = row[0] if isinstance(row[0], dict) else json.loads(row[0])
            # Build ContextualProfile — default age 50 if not stored
            return ContextualProfile(
                age=int(profile_data.get("age", 50)),
                smoker=bool(profile_data.get("smoker", False)),
                hypertension=bool(profile_data.get("hypertension", False)),
                cholesterol_known=bool(profile_data.get("cholesterolKnown", False)),
                cholesterol_mmol_per_L=profile_data.get("cholesterolValue"),
            )
    except Exception as e:
        logger.warning("[db] load_context failed for %s: %s", user_id, e)
        return None
    finally:
        _put_conn(conn)


def save_context(user_id: str, profile: ContextualProfile) -> None:
    """Persist context back to User.riskProfile column."""
    if not _use_db:
        _memory_context[user_id] = profile
        return
    conn = _get_conn()
    try:
        profile_json = json.dumps({
            "age": profile.age,
            "smoker": profile.smoker,
            "hypertension": profile.hypertension,
            "cholesterolKnown": profile.cholesterol_known,
            "cholesterolValue": profile.cholesterol_mmol_per_L,
        })
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE users SET "riskProfile" = %s::jsonb WHERE id = %s',
                (profile_json, user_id),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _put_conn(conn)
