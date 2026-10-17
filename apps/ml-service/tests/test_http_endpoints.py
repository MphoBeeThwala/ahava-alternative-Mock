"""
Every live HTTP endpoint of the ML service, exercised through FastAPI's
TestClient with the in-memory store (no DATABASE_URL): service authentication,
request validation, and the main success path of each route. The engine's rules
are covered in depth elsewhere; this file proves the routes are wired to it.
"""
import importlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

SECRET = "test-secret-123"
AUTH = {"x-ahava-service-key": SECRET}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ML_SERVICE_REQUIRE_AUTH", "true")
    monkeypatch.setenv("ML_SERVICE_SHARED_SECRET", SECRET)
    import main
    importlib.reload(main)
    return TestClient(main.app)


def uid() -> str:
    return f"http-user-{uuid.uuid4().hex[:12]}"


def iso(days_ago: float = 0.0) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago, seconds=5)).isoformat()


def vitals(days_ago: float = 0.0, **over) -> dict:
    body = {
        "timestamp": iso(days_ago), "heart_rate_resting": 70, "hrv_rmssd": 40, "spo2": 98,
        "skin_temp_offset": 0.0, "respiratory_rate": 15,
    }
    body.update(over)
    return body


class TestServiceAuth:
    def test_health_check_is_public(self, client):
        res = client.get("/")
        assert res.status_code == 200
        assert res.json()["status"] == "ok"
        assert "Not a Medical Diagnosis" in res.headers["x-medical-disclaimer"]

    @pytest.mark.parametrize("method,path", [
        ("get", "/readiness-score/u1"), ("get", "/early-warning/baseline/u1"),
        ("get", "/early-warning/summary/u1"), ("post", "/ingest?user_id=u1"),
        ("post", "/ingest/bp?user_id=u1"), ("get", "/research/models"),
    ])
    def test_protected_routes_reject_missing_and_wrong_keys(self, client, method, path):
        assert getattr(client, method)(path).status_code == 401
        assert getattr(client, method)(path, headers={"x-ahava-service-key": "wrong"}).status_code == 401

    def test_fails_closed_when_auth_is_on_but_no_secret_is_set(self, monkeypatch):
        monkeypatch.setenv("ML_SERVICE_REQUIRE_AUTH", "true")
        monkeypatch.setenv("ML_SERVICE_SHARED_SECRET", "")
        import main
        importlib.reload(main)
        res = TestClient(main.app).get("/readiness-score/u1", headers=AUTH)
        assert res.status_code == 503


class TestIngest:
    def test_valid_reading_is_processed(self, client):
        user = uid()
        res = client.post(f"/ingest?user_id={user}", json=vitals(), headers=AUTH)
        assert res.status_code == 200
        body = res.json()
        assert body["user_id"] == user and body["status"] == "processed"
        assert body["alert_level"] in ("GREEN", "YELLOW", "RED")
        assert isinstance(body["anomalies"], list)

    @pytest.mark.parametrize("override", [
        {"spo2": 120}, {"heart_rate_resting": 5}, {"respiratory_rate": 100},
        {"timestamp": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()},
    ])
    def test_out_of_range_or_future_values_are_rejected(self, client, override):
        res = client.post(f"/ingest?user_id={uid()}", json=vitals(**override), headers=AUTH)
        assert res.status_code == 422

    def test_user_id_is_required(self, client):
        assert client.post("/ingest", json=vitals(), headers=AUTH).status_code == 422

    def test_a_dangerously_low_spo2_is_flagged(self, client):
        res = client.post(f"/ingest?user_id={uid()}", json=vitals(spo2=84), headers=AUTH)
        assert res.status_code == 200
        assert res.json()["alert_level"] != "GREEN"
        assert res.json()["anomalies"]


class TestIngestBp:
    def test_normal_reading_is_green(self, client):
        res = client.post(f"/ingest/bp?user_id={uid()}", json={"timestamp": iso(), "systolic": 118, "diastolic": 76}, headers=AUTH)
        assert res.status_code == 200
        assert res.json()["alert_level"] == "GREEN"

    def test_crisis_range_reading_is_red(self, client):
        res = client.post(f"/ingest/bp?user_id={uid()}", json={"timestamp": iso(), "systolic": 195, "diastolic": 125}, headers=AUTH)
        assert res.status_code == 200
        assert res.json()["alert_level"] == "RED"
        assert "Blood pressure flagged" in res.json()["message"]

    @pytest.mark.parametrize("sys_,dia", [(100, 125), (80, 80), (400, 80), (120, 10)])
    def test_transposed_or_out_of_range_pairs_are_rejected(self, client, sys_, dia):
        res = client.post(f"/ingest/bp?user_id={uid()}", json={"timestamp": iso(), "systolic": sys_, "diastolic": dia}, headers=AUTH)
        assert res.status_code == 422


class TestReadinessAndBaseline:
    def test_unknown_user_gets_a_defined_response(self, client):
        ready = client.get(f"/readiness-score/{uid()}", headers=AUTH)
        assert ready.status_code == 200
        assert 0 <= ready.json()["score"] <= 100
        base = client.get(f"/early-warning/baseline/{uid()}", headers=AUTH)
        assert base.status_code == 200
        assert isinstance(base.json(), dict)

    def test_readiness_responds_after_ingest(self, client):
        user = uid()
        for d in (3, 2, 1, 0):
            assert client.post(f"/ingest?user_id={user}", json=vitals(days_ago=d), headers=AUTH).status_code == 200
        res = client.get(f"/readiness-score/{user}", headers=AUTH)
        assert res.status_code == 200
        body = res.json()
        assert body["user_id"] == user and 0 <= body["score"] <= 100

    def test_baseline_progress_changes_as_data_arrives(self, client):
        user = uid()
        before = client.get(f"/early-warning/baseline/{user}", headers=AUTH).json()
        for d in range(5, -1, -1):
            client.post(f"/ingest?user_id={user}", json=vitals(days_ago=d), headers=AUTH)
        after = client.get(f"/early-warning/baseline/{user}", headers=AUTH).json()
        assert before != after


class TestEarlyWarning:
    def test_analyze_ingests_and_returns_a_summary(self, client):
        user = uid()
        res = client.post(f"/early-warning/analyze?user_id={user}", json={"biometrics": vitals()}, headers=AUTH)
        assert res.status_code == 200
        assert res.json()

    def test_analyze_validates_the_body(self, client):
        res = client.post(f"/early-warning/analyze?user_id={uid()}", json={"biometrics": vitals(spo2=500)}, headers=AUTH)
        assert res.status_code == 422

    def test_summary_is_404_without_data(self, client):
        assert client.get(f"/early-warning/summary/{uid()}", headers=AUTH).status_code == 404
        assert client.post(f"/early-warning/summary/{uid()}", json={}, headers=AUTH).status_code == 404

    def test_summary_get_and_post_use_stored_data_without_adding_readings(self, client):
        user = uid()
        client.post(f"/ingest?user_id={user}", json=vitals(), headers=AUTH)
        got = client.get(f"/early-warning/summary/{user}", headers=AUTH)
        assert got.status_code == 200
        posted = client.post(
            f"/early-warning/summary/{user}",
            json={"context": {"age": 55, "sex": "male", "smoker": False, "systolic_bp": 130, "bmi": 27}},
            headers=AUTH,
        )
        assert posted.status_code == 200
        # Repeated page loads must not create readings: the baseline stays put.
        a = client.get(f"/early-warning/baseline/{user}", headers=AUTH).json()
        client.post(f"/early-warning/summary/{user}", json={}, headers=AUTH)
        client.get(f"/early-warning/summary/{user}", headers=AUTH)
        assert client.get(f"/early-warning/baseline/{user}", headers=AUTH).json() == a

    def test_summary_post_rejects_invalid_context(self, client):
        user = uid()
        client.post(f"/ingest?user_id={user}", json=vitals(), headers=AUTH)
        assert client.post(f"/early-warning/summary/{user}", json={"context": {"age": 5}}, headers=AUTH).status_code == 422
        assert client.post(f"/early-warning/summary/{user}", json={"context": {"age": 50, "sex": "other"}}, headers=AUTH).status_code == 422

    def test_context_can_be_stored_and_is_validated(self, client):
        user = uid()
        ok = client.put(
            f"/early-warning/context/{user}",
            json={"age": 61, "sex": "female", "smoker": True, "systolic_bp": 145},
            headers=AUTH,
        )
        assert ok.status_code == 200
        assert ok.json() == {"status": "ok", "user_id": user}
        assert client.put(f"/early-warning/context/{user}", json={"age": 12}, headers=AUTH).status_code == 422
        assert client.put(f"/early-warning/context/{user}", json={}, headers=AUTH).status_code == 422
        # The stored context is what the plain GET summary uses.
        client.post(f"/ingest?user_id={user}", json=vitals(), headers=AUTH)
        assert client.get(f"/early-warning/summary/{user}", headers=AUTH).status_code == 200
