import json
import math

import numpy as np
import pytest

from research import registry
from research.artifact import ModelArtifact
from research.features import FEATURES, FEATURE_SCHEMA_HASH, build_features
from research_helpers import snap


def make_artifact(**over) -> ModelArtifact:
    a = ModelArtifact(
        name="adverse_event_90d", target="adverse_event_90d", horizon_days=90, features=list(FEATURES),
        impute={f: 1.0 for f in FEATURES}, mean={f: 0.0 for f in FEATURES}, scale={f: 1.0 for f in FEATURES},
        coef={f: 0.0 for f in FEATURES}, intercept=-2.0,
    )
    a.coef["hr_resting"] = 0.05
    a.mean["hr_resting"], a.scale["hr_resting"], a.impute["hr_resting"] = 70.0, 10.0, 70.0
    for k, v in over.items():
        setattr(a, k, v)
    return a


@pytest.fixture(autouse=True)
def model_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("RESEARCH_MODEL_DIR", str(tmp_path))
    return tmp_path


def test_json_roundtrip_preserves_predictions():
    a = make_artifact()
    b = ModelArtifact.from_json(a.to_json())
    feats = build_features(snap("s", 10, hrResting=90.0))
    assert b.predict_proba(feats) == pytest.approx(a.predict_proba(feats))
    assert b.content_hash() == a.content_hash() and b.version == a.version


def test_missing_values_are_imputed_with_training_medians_not_zero():
    a = make_artifact()
    missing = build_features(snap("s", 10, hrResting=None))
    at_median = build_features(snap("s", 10, hrResting=70.0))
    assert a.predict_proba(missing) == pytest.approx(a.predict_proba(at_median))


def test_vectorised_scoring_matches_single_row_scoring():
    a = make_artifact(platt_a=0.8, platt_b=-0.1)
    feats = [build_features(snap("s", 10, hrResting=h)) for h in (55.0, 70.0, 100.0)]
    X = np.array([[f[c] for c in FEATURES] for f in feats])
    vec = a.predict_matrix(X, list(FEATURES))
    assert vec == pytest.approx([a.predict_proba(f) for f in feats])


def test_contributions_explain_the_score_and_are_signed():
    a = make_artifact()
    hi = a.contributions(build_features(snap("s", 10, hrResting=100.0)))
    assert hi[0]["feature"] == "hr_resting" and hi[0]["logit"] > 0
    lo = a.contributions(build_features(snap("s", 10, hrResting=40.0)))
    assert lo[0]["logit"] < 0


@pytest.mark.parametrize("breakage", [
    lambda a: a.coef.__setitem__("hr_resting", float("nan")),
    lambda a: a.scale.__setitem__("hr_resting", 0.0),
    lambda a: a.impute.pop("hr_resting"),
    lambda a: setattr(a, "intercept", float("inf")),
])
def test_corrupt_artifacts_are_rejected_at_load(breakage):
    a = make_artifact()
    breakage(a)
    # NaN/inf are not valid JSON numbers by default; allow them in the dump so the loader is what rejects them.
    text = json.dumps({**a._body(), "version": "x", "card": {}}, allow_nan=True)
    with pytest.raises(ValueError):
        ModelArtifact.from_json(text)


def test_unknown_features_are_rejected():
    a = make_artifact()
    a.features.append("patient_name")
    with pytest.raises(ValueError):
        ModelArtifact.from_json(json.dumps({**a._body(), "version": "x", "card": {}}))


# ----------------------------------------------------------------- registry / approval gate
def test_training_output_is_a_candidate_and_is_not_served():
    a = make_artifact()
    registry.save_candidate(a)
    assert registry.list_models()[0]["status"] == "CANDIDATE"
    assert registry.load_approved() == []


def test_approval_serves_the_model_and_is_attributed():
    a = make_artifact()
    registry.save_candidate(a)
    rec = registry.approve(a.name, a.version, "Dr A. Example", "shadow trial")
    assert rec["scope"] == "SHADOW_ONLY" and rec["approved_by"] == "Dr A. Example"
    assert [m.version for m in registry.load_approved()] == [a.version]
    assert registry.list_models()[0]["status"] == "APPROVED_SHADOW"


def test_synthetic_models_can_never_be_approved():
    a = make_artifact(synthetic=True)
    registry.save_candidate(a)
    with pytest.raises(ValueError, match="synthetic"):
        registry.approve(a.name, a.version, "Dr A. Example")
    assert registry.load_approved() == []


def test_approval_needs_a_named_approver():
    a = make_artifact()
    registry.save_candidate(a)
    for who in ("", "  ", "x"):
        with pytest.raises(ValueError):
            registry.approve(a.name, a.version, who)


def test_editing_a_model_after_approval_voids_the_approval(model_dir):
    a = make_artifact()
    d = registry.save_candidate(a)
    registry.approve(a.name, a.version, "Dr A. Example")
    tampered = json.loads((d / "model.json").read_text())
    tampered["coef"]["hr_resting"] = 5.0
    (d / "model.json").write_text(json.dumps(tampered))
    assert registry.list_models()[0]["status"] == "APPROVAL_VOID_MODEL_CHANGED"
    assert registry.load_approved() == []


def test_a_model_on_an_old_feature_schema_is_not_served_or_approvable():
    a = make_artifact(feature_schema_hash="0" * 64)
    registry.save_candidate(a)
    with pytest.raises(ValueError, match="feature schema"):
        registry.approve(a.name, a.version, "Dr A. Example")


def test_revoke_stops_serving():
    a = make_artifact()
    registry.save_candidate(a)
    registry.approve(a.name, a.version, "Dr A. Example")
    assert registry.revoke(a.name, a.version) is True
    assert registry.load_approved() == []


def test_a_corrupt_artifact_is_reported_not_fatal(model_dir):
    a = make_artifact()
    registry.save_candidate(a)
    bad = model_dir / "broken" / "v1"
    bad.mkdir(parents=True)
    (bad / "model.json").write_text("{not json")
    statuses = {m["name"]: m["status"] for m in registry.list_models()}
    assert statuses["adverse_event_90d"] == "CANDIDATE" and statuses["broken"].startswith("INVALID")


@pytest.mark.parametrize("name,version", [("../x", "v"), ("x", "../../etc"), ("", "v"), (".hidden", "v"), ("a/b", "v")])
def test_path_traversal_in_names_is_refused(name, version):
    with pytest.raises(ValueError):
        registry.approve(name, version, "Dr A. Example")


def test_no_synthetic_or_unapproved_model_is_committed_in_the_repo():
    """The shipped artifacts directory must hold only approved, non-synthetic, untampered models (normally none)."""
    import pathlib
    shipped = pathlib.Path(registry.__file__).resolve().parent / "artifacts"
    for model_json in shipped.glob("*/*/model.json"):
        art = ModelArtifact.from_json(model_json.read_text())
        approval = model_json.parent / "approval.json"
        assert not art.synthetic, f"{model_json} is synthetic"
        assert approval.exists(), f"{model_json} is committed without an approval.json"
        assert json.loads(approval.read_text())["content_hash"] == art.content_hash(), f"{model_json} changed after approval"
