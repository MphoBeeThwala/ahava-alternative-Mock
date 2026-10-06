"""Shadow scoring over HTTP: approved models only, authenticated, de-identified in, nothing user-facing out."""
import importlib
import os

import pytest
from fastapi.testclient import TestClient

from research import registry, shadow
from research.features import FEATURES
from research_helpers import snap
from test_research_artifact import make_artifact

SECRET = "test-secret-123"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("RESEARCH_MODEL_DIR", str(tmp_path))
    monkeypatch.setenv("ML_SERVICE_REQUIRE_AUTH", "true")
    monkeypatch.setenv("ML_SERVICE_SHARED_SECRET", SECRET)
    monkeypatch.setattr(shadow, "_TTL_SECONDS", 0.0)  # pick up approvals immediately in tests
    import main
    importlib.reload(main)
    return TestClient(main.app), {"x-ahava-service-key": SECRET}


def approved(name="adverse_event_90d"):
    a = make_artifact(name=name, target=name)
    registry.save_candidate(a)
    registry.approve(a.name, a.version, "Dr A. Example")
    return a


def payload(**over):
    return {"items": [{"snapshot_id": "snap-1", "snapshot": snap("x", 20, hrResting=95.0),
                       "history": [snap("x", d, hrResting=62.0) for d in (14, 15, 16)]}], **over}


def test_requires_service_authentication(client):
    c, _ = client
    assert c.get("/research/models").status_code == 401
    assert c.post("/research/shadow-predict", json=payload()).status_code == 401


def test_serves_nothing_until_a_human_approves_a_model(client):
    c, h = client
    assert c.get("/research/models", headers=h).json() == {"models": []}
    registry.save_candidate(make_artifact())  # a candidate, not approved
    assert c.get("/research/models", headers=h).json() == {"models": []}
    r = c.post("/research/shadow-predict", json=payload(), headers=h).json()
    assert r["results"][0]["predictions"] == []  # a candidate is never scored


def test_scores_with_an_approved_model(client):
    c, h = client
    a = approved()
    assert c.get("/research/models", headers=h).json()["models"] == [{"name": a.name, "version": a.version, "target": a.target}]
    res = c.post("/research/shadow-predict", json=payload(), headers=h).json()["results"][0]
    assert res["snapshot_id"] == "snap-1"
    pred = res["predictions"][0]
    assert 0 < pred["probability"] < 1 and pred["version"] == a.version
    assert pred["contributions"][0]["feature"] in FEATURES
    # a hotter heart rate than baseline must score higher: the history path is wired in
    cold = payload(); cold["items"][0]["snapshot"] = snap("x", 20, hrResting=50.0)
    cold_p = c.post("/research/shadow-predict", json=cold, headers=h).json()["results"][0]["predictions"][0]["probability"]
    assert cold_p < pred["probability"]


def test_can_restrict_to_named_models(client):
    c, h = client
    a = approved()
    r = c.post("/research/shadow-predict", json=payload(models=[{"name": a.name, "version": "other"}]), headers=h).json()
    assert r["results"][0]["predictions"] == []


def test_one_bad_item_does_not_fail_the_batch(client):
    c, h = client
    approved()
    body = payload()
    body["items"].append({"snapshot_id": "bad", "snapshot": {"no": "observedDay"}, "history": []})
    res = c.post("/research/shadow-predict", json=body, headers=h).json()["results"]
    assert res[0]["predictions"] and res[1] == {"snapshot_id": "bad", "predictions": [], "error": "unscorable"}


def test_batch_size_is_capped(client):
    c, h = client
    big = {"items": [{"snapshot_id": str(i), "snapshot": snap("x", 1)} for i in range(201)]}
    assert c.post("/research/shadow-predict", json=big, headers=h).status_code == 413


def test_revoking_stops_scoring(client):
    c, h = client
    a = approved()
    registry.revoke(a.name, a.version)
    assert c.get("/research/models", headers=h).json() == {"models": []}


def test_the_live_endpoints_are_untouched(client):
    c, h = client
    assert c.get("/").status_code == 200
