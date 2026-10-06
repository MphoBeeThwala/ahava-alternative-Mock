"""
Model registry on disk, with a human approval gate.

    artifacts/<name>/<version>/model.json      written by training (CANDIDATE)
    artifacts/<name>/<version>/approval.json   written ONLY by `approve`

Training never approves anything. Only an approved model is served to shadow
scoring, approval is bound to the model's content hash (editing the numbers
afterwards voids it), and a model trained on synthetic data can never be
approved. Approval here means "may be scored silently next to live traffic".
It does not mean validated and it does not permit showing anything to anyone;
that is a separate, regulated step this code does not provide.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from .artifact import ModelArtifact
from .features import FEATURE_SCHEMA_HASH


def artifact_root() -> Path:
    return Path(os.getenv("RESEARCH_MODEL_DIR") or Path(__file__).resolve().parent / "artifacts")


def _dir(name: str, version: str) -> Path:
    for part in (name, version):
        if not part or "/" in part or "\\" in part or part.startswith("."):
            raise ValueError(f"invalid model name/version: {part!r}")
    return artifact_root() / name / version


def save_candidate(artifact: ModelArtifact) -> Path:
    text = artifact.to_json()  # fixes artifact.version
    d = _dir(artifact.name, artifact.version)
    d.mkdir(parents=True, exist_ok=True)
    (d / "model.json").write_text(text)
    return d


def load(name: str, version: str) -> ModelArtifact:
    return ModelArtifact.from_json((_dir(name, version) / "model.json").read_text())


def approval_of(name: str, version: str) -> Optional[dict]:
    p = _dir(name, version) / "approval.json"
    return json.loads(p.read_text()) if p.exists() else None


def approve(name: str, version: str, approver: str, note: str = "") -> dict:
    approver = (approver or "").strip()
    if len(approver) < 3:
        raise ValueError("approval needs the approver's name (--by)")
    artifact = load(name, version)
    if artifact.synthetic:
        raise ValueError("refusing to approve a model trained on synthetic data")
    if artifact.feature_schema_hash != FEATURE_SCHEMA_HASH:
        raise ValueError("model was trained on a different feature schema than this code uses; retrain it")
    record = {
        "name": name, "version": version, "content_hash": artifact.content_hash(),
        "approved_by": approver, "approved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "scope": "SHADOW_ONLY", "note": note,
    }
    (_dir(name, version) / "approval.json").write_text(json.dumps(record, indent=2))
    return record


def revoke(name: str, version: str) -> bool:
    p = _dir(name, version) / "approval.json"
    if p.exists():
        p.unlink()
        return True
    return False


def list_models() -> List[dict]:
    root = artifact_root()
    out = []
    if not root.exists():
        return out
    for model_json in sorted(root.glob("*/*/model.json")):
        name, version = model_json.parent.parent.name, model_json.parent.name
        try:
            a = ModelArtifact.from_json(model_json.read_text())
        except Exception as e:  # a corrupt file is reported, never fatal
            out.append({"name": name, "version": version, "status": f"INVALID: {e}"})
            continue
        ap = approval_of(name, version)
        status = "CANDIDATE"
        if ap:
            status = "APPROVED_SHADOW" if ap.get("content_hash") == a.content_hash() else "APPROVAL_VOID_MODEL_CHANGED"
        out.append({
            "name": name, "version": version, "target": a.target, "status": status, "synthetic": a.synthetic,
            "approved_by": (ap or {}).get("approved_by"),
            "stale_feature_schema": a.feature_schema_hash != FEATURE_SCHEMA_HASH,
        })
    return out


def load_approved() -> List[ModelArtifact]:
    """Models that are approved, untampered, current-schema and not synthetic. Anything else is skipped."""
    ok = []
    for m in list_models():
        if m.get("status") != "APPROVED_SHADOW" or m.get("synthetic") or m.get("stale_feature_schema"):
            continue
        ok.append(load(m["name"], m["version"]))
    return ok
