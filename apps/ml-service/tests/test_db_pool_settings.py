"""
Database connection budget. Each uvicorn worker has its own pool and psycopg2 opens the pool's minimum
at creation, so fixed per-worker sizes multiply with the worker and replica counts (5 x 8 x 3 = 120
connections held open, against Postgres's usual 100). The pool is therefore sized from a budget per
replica that is shared out among the workers.
"""
import psycopg2.pool
import pytest

import db
from db import DEFAULT_CONNECTIONS_PER_REPLICA, pool_settings


def cfg(**env):
    return pool_settings({k: str(v) for k, v in env.items()})


def test_the_default_replica_budget_is_modest():
    assert DEFAULT_CONNECTIONS_PER_REPLICA == 20


def test_one_worker_with_no_settings_gets_the_whole_budget_and_opens_one_connection_at_start():
    c = cfg()
    assert (c["min"], c["max"], c["workers"], c["warnings"]) == (1, 20, 1, [])


@pytest.mark.parametrize("workers,expected_max", [(2, 10), (3, 6), (4, 5), (8, 2), (20, 1)])
def test_the_budget_is_shared_out_among_the_workers(workers, expected_max):
    c = cfg(ML_SERVICE_WORKERS=workers)
    assert c["max"] == expected_max and c["min"] == 1 and c["warnings"] == []


def test_adding_workers_can_never_add_connections():
    for workers in range(1, 21):
        c = cfg(ML_SERVICE_WORKERS=workers)
        assert workers * c["max"] <= DEFAULT_CONNECTIONS_PER_REPLICA


def test_more_workers_than_budget_is_allowed_but_loudly_warned_about():
    c = cfg(ML_SERVICE_WORKERS=24)
    assert c["max"] == 1 and c["min"] == 1
    assert any("24 workers exceed the connection budget of 20" in w for w in c["warnings"])


def test_the_size_that_caused_the_problem_is_now_impossible_by_default():
    # 24 workers x 5 connections each was ~120 held open. Now: one each.
    c = cfg(ML_SERVICE_WORKERS=24)
    assert 24 * c["min"] == 24


def test_a_larger_budget_is_shared_out_the_same_way():
    assert cfg(ML_SERVICE_WORKERS=4, ML_DB_CONNECTIONS_PER_REPLICA=40)["max"] == 10


def test_explicit_per_worker_settings_still_win_but_an_oversized_one_is_warned_about():
    ok = cfg(ML_SERVICE_WORKERS=4, ML_DB_POOL_MAX=4)
    assert ok["max"] == 4 and ok["warnings"] == []
    big = cfg(ML_SERVICE_WORKERS=4, ML_DB_POOL_MAX=30)
    assert big["max"] == 30
    assert any("can hold 120 connections, over the budget of 20" in w for w in big["warnings"])


def test_the_minimum_never_exceeds_the_maximum():
    c = cfg(ML_SERVICE_WORKERS=20, ML_DB_POOL_MIN=5)
    assert c["max"] == 1 and c["min"] == 1
    assert cfg(ML_DB_POOL_MAX=3, ML_DB_POOL_MIN=9)["min"] == 3


@pytest.mark.parametrize("bad", ["0", "-2", "1.5", "abc", "1e1", " "])
def test_nonsense_settings_fall_back_to_safe_defaults_instead_of_crashing_the_service(bad):
    # int("abc") used to raise at import time and take the whole service down.
    for name in ("ML_SERVICE_WORKERS", "ML_DB_CONNECTIONS_PER_REPLICA", "ML_DB_POOL_MAX", "ML_DB_POOL_MIN"):
        c = cfg(**{name: bad})
        assert c["min"] >= 1 and c["max"] >= c["min"]
        if bad.strip():
            assert any(name in w for w in c["warnings"]), name


def test_the_real_pool_is_created_with_the_computed_sizes(monkeypatch):
    seen = {}

    class FakePool:
        def __init__(self, minconn, maxconn, dsn):
            seen.update(minconn=minconn, maxconn=maxconn, dsn=dsn)

    monkeypatch.setattr(psycopg2.pool, "ThreadedConnectionPool", FakePool)
    monkeypatch.setattr(db, "_db_url", "postgresql://x/y")
    monkeypatch.setattr(db, "_pool", None)
    monkeypatch.setenv("ML_SERVICE_WORKERS", "8")
    for var in ("ML_DB_POOL_MIN", "ML_DB_POOL_MAX", "ML_DB_CONNECTIONS_PER_REPLICA"):
        monkeypatch.delenv(var, raising=False)
    db._get_pool()
    assert seen == {"minconn": 1, "maxconn": 2, "dsn": "postgresql://x/y"}
    monkeypatch.setattr(db, "_pool", None)  # leave no fake behind for other tests
