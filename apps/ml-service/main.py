from fastapi import FastAPI, HTTPException
from models import BiometricData, IngestResponse, ReadinessScore, AlertLevel
from engine import EarlyWarningEngine
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="Ahava Healthcare - ML Early Warning Service",
    version="1.0.0",
    description="Analyzes wearable data for pre-symptomatic physiological shifts."
)

# Initialize Engine
engine = EarlyWarningEngine()

@app.get("/")
def health_check():
    return {"status": "ok", "service": "ML-Service-v1"}

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
    Calculate daily readiness score (0-100).
    """
    # Simple logic for MVP: Start at 100, subtract for recent anomalies
    score = 100
    baseline_status = "STABLE"
    
    # Check last data point
    if user_id in engine.DATA_STORE and engine.DATA_STORE[user_id]:
        last_data = engine.DATA_STORE[user_id][-1]
        _, anomalies = engine.ingest(user_id, last_data) # Re-eval last point
        
        if anomalies:
            score -= (len(anomalies) * 15)
            baseline_status = "DEVIATION DETECTED"
    
    return ReadinessScore(
        user_id=user_id,
        score=max(0, score),
        baseline_status=baseline_status,
        trend="STABLE" # Todo: Calculate trend slope
    )

# Middleware / Metadata
@app.middleware("http")
async def add_medical_disclaimer(request, call_next):
    response = await call_next(request)
    response.headers["X-Medical-Disclaimer"] = "Not a Medical Diagnosis. For informational purposes only."
    return response

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
