from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
from models import (
    BiometricData, IngestResponse, ReadinessScore, AlertLevel,
    ContextualProfile, EarlyWarningSummary,
)
from engine import EarlyWarningEngine, _dict_to_biometric
import db
from datetime import datetime
import os
import hmac
from dotenv import load_dotenv


class EarlyWarningAnalyzeRequest(BaseModel):
    """Request body for full early-warning analysis (wearable + optional context)."""
    biometrics: BiometricData
    context: Optional[ContextualProfile] = None

load_dotenv()

ML_SERVICE_SHARED_SECRET = os.getenv("ML_SERVICE_SHARED_SECRET", "").strip()
ML_SERVICE_REQUIRE_AUTH = os.getenv("ML_SERVICE_REQUIRE_AUTH", "true").strip().lower() == "true"
ML_SERVICE_AUTH_HEADER = "x-ahava-service-key"
ML_SERVICE_PUBLIC_PATHS = {"/", "/docs", "/openapi.json", "/redoc"}

app = FastAPI(
    title="Ahava Healthcare - ML Early Warning Service",
    version="1.0.0",
    description="Analyzes wearable data for pre-symptomatic physiological shifts."
)

print(
    f"[ml-auth] require_auth={ML_SERVICE_REQUIRE_AUTH} "
    f"secret_configured={bool(ML_SERVICE_SHARED_SECRET)} "
    f"secret_length={len(ML_SERVICE_SHARED_SECRET)}"
)

# Initialize Engine
engine = EarlyWarningEngine()

@app.get("/")
def health_check():
    return {"status": "ok", "service": "ML-Service-v1"}

@app.middleware("http")
async def verify_service_auth(request: Request, call_next):
    """
    Enforce service-to-service auth for all non-public endpoints.
    """
    if ML_SERVICE_REQUIRE_AUTH and request.url.path not in ML_SERVICE_PUBLIC_PATHS:
        if not ML_SERVICE_SHARED_SECRET:
            return JSONResponse(
                status_code=503,
                content={"detail": "ML service auth is enabled but not configured"},
            )

        provided = request.headers.get(ML_SERVICE_AUTH_HEADER, "").strip()
        if not provided or not hmac.compare_digest(provided, ML_SERVICE_SHARED_SECRET):
            return JSONResponse(status_code=401, content={"detail": "Invalid service authentication"})

    return await call_next(request)

@app.post("/ingest", response_model=IngestResponse)
def ingest_biometrics(data: BiometricData, user_id: str):
    """
    Ingest user biometric data and run anomaly detection.
    """
    try:
        alert_level, anomalies = engine.ingest(user_id, data)
        
        message = "Data processed successfully."
        if alert_level != AlertLevel.GREEN:
            message = "Anomalies detected. Medical review suggested."

        return IngestResponse(
            user_id=user_id,
            status="processed",
            processed_at=datetime.now(),
            alert_level=alert_level,
            anomalies=anomalies,
            message=message
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/readiness-score/{user_id}", response_model=ReadinessScore)
def get_readiness_score(user_id: str):
    """
    Calculate daily readiness score (0-100) using persistent DB history.
    """
    score, baseline_status, trend = engine.get_readiness_score(user_id)
    return ReadinessScore(
        user_id=user_id,
        score=score,
        baseline_status=baseline_status,
        trend=trend,
    )


@app.post("/early-warning/analyze", response_model=EarlyWarningSummary)
def early_warning_analyze(user_id: str, body: EarlyWarningAnalyzeRequest):
    """
    Full early-warning analysis: preprocessing, Framingham/QRISK3/ML risk scores,
    fusion layer (trajectory + alert). For use by backend or direct integration.
    """
    try:
        # Store new data first so baselines and features include this point
        engine.ingest(user_id, body.biometrics)
        summary = engine.full_analysis(user_id, body.biometrics, body.context)
        return summary
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/early-warning/summary/{user_id}", response_model=EarlyWarningSummary)
def early_warning_summary(user_id: str):
    """
    Return latest early-warning summary using last stored biometric row from DB.
    Returns HTTP 404 if no data exists for user.
    """
    latest_row = db.load_latest_biometric(user_id)
    if not latest_row:
        raise HTTPException(status_code=404, detail="No biometric data for user")
    try:
        last = _dict_to_biometric(latest_row)
        summary = engine.full_analysis(user_id, last, engine.get_context(user_id))
        return summary
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/early-warning/context/{user_id}")
def set_early_warning_context(user_id: str, context: ContextualProfile):
    """Store contextual profile (age, smoker, hypertension) for CVD risk algorithms."""
    engine.set_context(user_id, context)
    return {"status": "ok", "user_id": user_id}


@app.get("/early-warning/baseline/{user_id}")
def get_baseline_info(user_id: str):
    """Return baseline confidence stage and progress for a user."""
    return engine.get_baseline_info(user_id)

# ---------------------------------------------------------------------------
# Research: shadow scoring (docs/RESEARCH_DATA_PIPELINE.md)
#
# Scores de-identified snapshots with models a named human has approved for
# SHADOW use. The backend stores the result next to the snapshot; nothing here
# is returned to patients or clinicians and nothing feeds a live decision. The
# research package is imported defensively: if it is missing or broken the live
# endpoints above are unaffected and these answer 503.
# ---------------------------------------------------------------------------
try:
    from research import shadow as _research_shadow
except Exception as _research_err:  # pragma: no cover - defensive
    _research_shadow = None
    print(f"[research] shadow scoring unavailable: {_research_err}")


class _ModelRef(BaseModel):
    name: str
    version: str


class _ShadowItem(BaseModel):
    snapshot_id: str
    snapshot: dict
    history: List[dict] = []


class ShadowPredictRequest(BaseModel):
    models: Optional[List[_ModelRef]] = None
    items: List[_ShadowItem]


@app.get("/research/models")
def research_models():
    """Models currently approved for shadow scoring (usually none)."""
    if _research_shadow is None:
        raise HTTPException(status_code=503, detail="research scoring unavailable")
    return {"models": _research_shadow.describe()}


@app.post("/research/shadow-predict")
def research_shadow_predict(body: ShadowPredictRequest):
    if _research_shadow is None:
        raise HTTPException(status_code=503, detail="research scoring unavailable")
    if len(body.items) > 200:
        raise HTTPException(status_code=413, detail="at most 200 items per request")
    results = _research_shadow.score_items(
        [i.model_dump() for i in body.items],
        [m.model_dump() for m in body.models] if body.models else None,
    )
    return {"results": results}


# Middleware / Metadata
@app.middleware("http")
async def add_medical_disclaimer(request, call_next):
    response = await call_next(request)
    response.headers["X-Medical-Disclaimer"] = "Not a Medical Diagnosis. For informational purposes only."
    return response

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
