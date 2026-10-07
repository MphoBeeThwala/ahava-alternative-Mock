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

# Every uvicorn worker is its own process with its own pool, and psycopg2 opens
# `minconn` connections the moment the pool is created (which happens at import,
# in ensure_schema). Fixed per-worker sizes therefore multiply: 5 per worker x 8
# workers x 3 replicas = 120 connections held open all day, against a Postgres
# that allows about 100 by default. Past that, new connections are refused and
# this service silently falls back to in-memory history. So the size is derived
# from a budget PER REPLICA instead, divided among that replica's workers.
DEFAULT_CONNECTIONS_PER_REPLICA = 20


def _whole_number(env, name: str, default: int, warnings: List[str]) -> int:
    raw = (env.get(name) or "").strip()
    if raw == "":
        return default
    if not raw.isdigit() or int(raw) < 1:
        warnings.append(f"{name}={raw!r} is not a whole number of at least 1; using {default}")
        return default
    return int(raw)


def pool_settings(env=None) -> dict:
    """
    Per-worker pool size. `ML_DB_CONNECTIONS_PER_REPLICA` (default 20) is shared out among the
    `ML_SERVICE_WORKERS` workers, so adding workers can never add connections. `ML_DB_POOL_MAX` and
    `ML_DB_POOL_MIN` still override per worker; an override that would exceed the budget is allowed
    but warned about. Pure function of the environment, so it is testable without a database.
    """
    env = os.environ if env is None else env
    warnings: List[str] = []
    workers = _whole_number(env, "ML_SERVICE_WORKERS", 1, warnings)
    budget = _whole_number(env, "ML_DB_CONNECTIONS_PER_REPLICA", DEFAULT_CONNECTIONS_PER_REPLICA, warnings)
    derived_max = max(1, budget // workers)
    explicit_max = (env.get("ML_DB_POOL_MAX") or "").strip() != ""
    max_conn = _whole_number(env, "ML_DB_POOL_MAX", derived_max, warnings)
    min_conn = min(_whole_number(env, "ML_DB_POOL_MIN", 1, warnings), max_conn)
    if workers > budget:
        warnings.append(
            f"{workers} workers exceed the connection budget of {budget} per replica; each gets 1 connection, "
            f"so a replica can hold {workers}. Lower ML_SERVICE_WORKERS or raise ML_DB_CONNECTIONS_PER_REPLICA"
        )
    elif explicit_max and workers * max_conn > budget:
        warnings.append(
            f"ML_DB_POOL_MAX={max_conn} x {workers} workers can hold {workers * max_conn} connections, "
            f"over the budget of {budget} per replica"
        )
    return {"min": min_conn, "max": max_conn, "workers": workers, "budget": budget, "warnings": warnings}


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        if not _db_url:
            raise RuntimeError("DATABASE_URL environment variable not set")
        cfg = pool_settings()
        for w in cfg["warnings"]:
            logger.warning("[db] %s", w)
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=cfg["min"],
            maxconn=cfg["max"],
            dsn=_db_url,
        )
        logger.info(
            "[db] Connection pool created min=%s max=%s (budget %s per replica across %s workers)",
            cfg["min"], cfg["max"], cfg["budget"], cfg["workers"],
        )
    return _pool


def _get_conn(timeout: float = 5.0):
    """Get connection with retry - avoids immediate PoolError under burst."""
    import time
    pool = _get_pool()
    deadline = time.time() + timeout
    last_err = None
    while time.time() < deadline:
        try:
            return pool.getconn()
        except psycopg2.pool.PoolError as e:
            last_err = e
            time.sleep(0.05)
    raise last_err if last_err else psycopg2.pool.PoolError("connection pool exhausted (timeout)")


def _put_conn(conn):
    try:
        _get_pool().putconn(conn)
    except Exception:
        pass


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
            # The service normally runs as a least-privilege role that cannot
            # run DDL (apps/backend/src/scripts/ml-db-role.ts, which also
            # creates this table as the database owner). If the table is
            # already there, there is nothing to create — don't attempt DDL.
            cur.execute("SELECT to_regclass('public.biometric_time_series') IS NOT NULL")
            if bool(cur.fetchone()[0]):
                logger.info("[db] biometric_time_series present; skipping schema setup")
                return

            if _timescale_mode == "off":
                cur.execute(PLAIN_TABLE_SQL)
                conn.commit()
                logger.info("[db] TIMESCALE_MODE=off; plain PostgreSQL table ready")
                return

            if _timescale_mode == "on":
                cur.execute(HYPERTABLE_SQL)
                conn.commit()
                logger.info("[db] TimescaleDB hypertable ready")
                return

            # AUTO mode: only attempt CREATE EXTENSION when extension exists on host.
            cur.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_available_extensions
                    WHERE name = 'timescaledb'
                )
                """
            )
            available = bool(cur.fetchone()[0])

            if available:
                cur.execute(HYPERTABLE_SQL)
                conn.commit()
                logger.info("[db] TimescaleDB available; hypertable ready")
            else:
                cur.execute(PLAIN_TABLE_SQL)
                conn.commit()
                logger.info(
                    "[db] TimescaleDB not available on this host; using plain PostgreSQL table"
                )
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
    try:
        conn = _get_conn()
    except psycopg2.pool.PoolError as e:
        logger.warning("[db] save_biometric pool exhausted for %s, using memory fallback: %s", user_id, e)
        row = data.model_dump()
        row["alert_level"] = alert_level
        row["anomalies"] = anomalies
        _memory_biometrics.setdefault(user_id, []).append(row)
        return
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
        try:
            conn.rollback()
        except Exception:
            pass
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
    try:
        conn = _get_conn()
    except psycopg2.pool.PoolError as e:
        logger.warning("[db] load_biometrics pool exhausted for %s: %s", user_id, e)
        return []
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
    try:
        conn = _get_conn()
    except psycopg2.pool.PoolError as e:
        logger.warning("[db] load_latest_biometric pool exhausted for %s: %s", user_id, e)
        return None
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
    try:
        conn = _get_conn()
    except psycopg2.pool.PoolError as e:
        logger.warning("[db] count_biometrics pool exhausted for %s: %s", user_id, e)
        return 0
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
    try:
        conn = _get_conn()
    except psycopg2.pool.PoolError as e:
        logger.warning("[db] load_context pool exhausted for %s: %s", user_id, e)
        return None
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
    try:
        conn = _get_conn()
    except psycopg2.pool.PoolError as e:
        logger.warning("[db] save_context pool exhausted for %s, using memory fallback: %s", user_id, e)
        _memory_context[user_id] = profile
        return
    try:
        profile_json = json.dumps({
            "age": profile.age,
            "smoker": profile.smoker,
            "hypertension": profile.hypertension,
            "cholesterolKnown": profile.cholesterol_known,
            "cholesterolValue": profile.cholesterol_mmol_per_L,
        })
        with conn.cursor() as cur:
            # Shallow-merge instead of replacing the column outright — riskProfile
            # also holds medicalPassport/passportCompletionPercent (and other
            # fields) written by the Node API's /patient/risk-profile route,
            # which this background context sync must not clobber.
            cur.execute(
                'UPDATE users SET "riskProfile" = COALESCE("riskProfile", \'{}\'::jsonb) || %s::jsonb WHERE id = %s',
                (profile_json, user_id),
            )
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        _put_conn(conn)
