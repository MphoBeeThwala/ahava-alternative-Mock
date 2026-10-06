"""
A trained model as a plain JSON file, scored with numpy only.

Why JSON and not pickle: it is inspectable by a clinician or auditor (every
coefficient is readable), it cannot execute code on load, and the live service
needs no scikit-learn. The model family is deliberately simple (regularised
logistic regression on standardised, median-imputed features): with the data
volumes this product will see for a long time, a model you can read beats one
you cannot, and it is what a regulator will ask for first.
"""
import hashlib
import json
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

from .features import FEATURES, FEATURE_SCHEMA_HASH

ARTIFACT_FORMAT = 1


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


@dataclass
class ModelArtifact:
    name: str
    target: str
    horizon_days: int
    features: List[str]
    impute: Dict[str, float]          # training-set medians
    mean: Dict[str, float]
    scale: Dict[str, float]           # training-set standard deviations (never 0)
    coef: Dict[str, float]
    intercept: float
    platt_a: float = 1.0              # calibration: p = sigmoid(a * logit + b), fitted on out-of-fold scores
    platt_b: float = 0.0
    feature_schema_hash: str = FEATURE_SCHEMA_HASH
    synthetic: bool = False           # trained on generated data: can never be approved
    card: dict = field(default_factory=dict)  # data summary, metrics, intended use, limitations
    version: str = ""

    # ---- scoring -------------------------------------------------------
    def _standardised(self, feats: Dict[str, float]) -> Dict[str, float]:
        out = {}
        for f in self.features:
            v = feats.get(f, float("nan"))
            if v is None or (isinstance(v, float) and math.isnan(v)):
                v = self.impute[f]
            out[f] = (v - self.mean[f]) / self.scale[f]
        return out

    def logit(self, feats: Dict[str, float]) -> float:
        z = self.intercept
        for f, x in self._standardised(feats).items():
            z += self.coef[f] * x
        return z

    def predict_proba(self, feats: Dict[str, float]) -> float:
        return _sigmoid(self.platt_a * self.logit(feats) + self.platt_b)

    def contributions(self, feats: Dict[str, float], top: int = 5) -> List[dict]:
        """Largest per-feature pushes on the (uncalibrated) logit, signed. Explains a score; not causal."""
        parts = [(f, self.coef[f] * x) for f, x in self._standardised(feats).items()]
        parts.sort(key=lambda t: abs(t[1]), reverse=True)
        return [{"feature": f, "logit": round(c, 4)} for f, c in parts[:top] if abs(c) > 1e-9]

    def predict_matrix(self, X: np.ndarray, columns: List[str]) -> np.ndarray:
        """Vectorised calibrated probabilities for a feature matrix (used by evaluation)."""
        idx = {c: i for i, c in enumerate(columns)}
        z = np.full(X.shape[0], self.intercept, dtype=float)
        for f in self.features:
            col = X[:, idx[f]].astype(float).copy()
            col[np.isnan(col)] = self.impute[f]
            z += self.coef[f] * (col - self.mean[f]) / self.scale[f]
        zc = self.platt_a * z + self.platt_b
        return 1.0 / (1.0 + np.exp(-np.clip(zc, -40, 40)))

    # ---- (de)serialisation --------------------------------------------
    def _body(self) -> dict:
        return {
            "format": ARTIFACT_FORMAT, "name": self.name, "target": self.target,
            "horizon_days": self.horizon_days, "features": self.features, "impute": self.impute,
            "mean": self.mean, "scale": self.scale, "coef": self.coef, "intercept": self.intercept,
            "platt_a": self.platt_a, "platt_b": self.platt_b,
            "feature_schema_hash": self.feature_schema_hash, "synthetic": self.synthetic,
        }

    def content_hash(self) -> str:
        """Hash of the numbers that decide a prediction. Approval is bound to it."""
        return hashlib.sha256(json.dumps(self._body(), sort_keys=True).encode()).hexdigest()

    def to_json(self) -> str:
        if not self.version:
            self.version = self.content_hash()[:12]
        return json.dumps({**self._body(), "version": self.version, "card": self.card}, indent=2, sort_keys=True)

    @classmethod
    def from_json(cls, text: str) -> "ModelArtifact":
        d = json.loads(text)
        if d.get("format") != ARTIFACT_FORMAT:
            raise ValueError(f"unsupported artifact format {d.get('format')!r}")
        a = cls(
            name=d["name"], target=d["target"], horizon_days=int(d["horizon_days"]), features=list(d["features"]),
            impute=d["impute"], mean=d["mean"], scale=d["scale"], coef=d["coef"], intercept=float(d["intercept"]),
            platt_a=float(d.get("platt_a", 1.0)), platt_b=float(d.get("platt_b", 0.0)),
            feature_schema_hash=d["feature_schema_hash"], synthetic=bool(d.get("synthetic", False)),
            card=d.get("card", {}), version=d.get("version", ""),
        )
        a.validate()
        return a

    def validate(self) -> None:
        unknown = [f for f in self.features if f not in FEATURES]
        if unknown:
            raise ValueError(f"artifact uses unknown features: {unknown}")
        for f in self.features:
            for table in (self.impute, self.mean, self.scale, self.coef):
                if f not in table or not math.isfinite(table[f]):
                    raise ValueError(f"artifact has a missing or non-finite value for {f!r}")
            if self.scale[f] <= 0:
                raise ValueError(f"artifact scale for {f!r} must be positive")
        if not all(math.isfinite(x) for x in (self.intercept, self.platt_a, self.platt_b)):
            raise ValueError("artifact has a non-finite intercept or calibration")
