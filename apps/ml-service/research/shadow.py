"""
Service-side shadow scoring. Pure functions over snapshot dicts: no database,
no user ids, no side effects. The backend decides who may be scored (research
consent) and stores the result; this only turns measurements into a number.
"""
import logging
import threading
import time
from typing import Dict, List, Optional

from . import registry
from .artifact import ModelArtifact
from .features import build_features

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_cache: Dict[str, object] = {"at": 0.0, "models": []}
_TTL_SECONDS = 60.0


def approved_models(force: bool = False) -> List[ModelArtifact]:
    """Approved models, re-read at most once a minute so an approval or a revocation takes effect without a redeploy."""
    with _lock:
        if force or time.monotonic() - float(_cache["at"]) > _TTL_SECONDS:
            try:
                _cache["models"] = registry.load_approved()
            except Exception:
                logger.exception("[research] could not load approved models; serving none")
                _cache["models"] = []
            _cache["at"] = time.monotonic()
        return list(_cache["models"])  # type: ignore[arg-type]


def describe() -> List[dict]:
    return [{"name": m.name, "version": m.version, "target": m.target} for m in approved_models()]


def score_items(items: List[dict], wanted: Optional[List[dict]] = None) -> List[dict]:
    """
    items:  [{"snapshot_id", "snapshot": {...}, "history": [{...}]}]
    wanted: optionally [{"name","version"}] to restrict which approved models run.
    One bad item yields an `error` entry; it never fails the batch.
    """
    models = approved_models()
    if wanted:
        keep = {(w["name"], w["version"]) for w in wanted}
        models = [m for m in models if (m.name, m.version) in keep]
    results = []
    for item in items:
        sid = item.get("snapshot_id")
        try:
            feats = build_features(item["snapshot"], item.get("history") or [])
            preds = [{
                "model": m.name, "version": m.version, "target": m.target,
                "probability": round(m.predict_proba(feats), 6),
                "contributions": m.contributions(feats),
            } for m in models]
            results.append({"snapshot_id": sid, "predictions": preds})
        except Exception as e:
            logger.warning("[research] could not score snapshot: %s", e)
            results.append({"snapshot_id": sid, "predictions": [], "error": "unscorable"})
    return results
