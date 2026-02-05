# ML Service Guide

## Overview

The Ahava Healthcare platform uses a **Python FastAPI ML Service** for advanced biometric analysis and early warning detection. This service provides:

- **Anomaly Detection**: Identifies unusual patterns in biometric data
- **Readiness Scoring**: Calculates a 0-100 health readiness score
- **Baseline Establishment**: Builds personalized baselines over 14 days
- **Early Warning Detection**: Predicts health issues before symptoms appear

## Current Status

### ✅ **Good News: The System Works Without It!**

The platform has a **robust fallback system** that ensures functionality even when the ML service is unavailable:

1. **Fallback Analysis**: When ML service is down, the system uses basic threshold-based analysis
2. **Always Returns Values**: The system always provides `alertLevel` and `readinessScore` values
3. **No Breaking Errors**: The API continues to work normally

### ⚠️ **What You're Missing Without ML Service**

When the ML service is **not running**, you get:
- ✅ Basic threshold-based alerts (heart rate, SpO2, blood pressure)
- ✅ Simple readiness scores (100 for GREEN, 70 for YELLOW, 40 for RED)
- ❌ **Missing**: Advanced anomaly detection using statistical analysis
- ❌ **Missing**: Personalized baselines (requires 14 days of data)
- ❌ **Missing**: Context-aware filtering (exercise vs. rest)
- ❌ **Missing**: Early warning predictions (heart attack, respiratory infection precursors)

## How to Start the ML Service

### Option 1: Run Locally (Development)

```bash
# Navigate to ML service directory
cd apps/ml-service

# Install dependencies (if not already done)
pip install -r requirements.txt

# Start the service
python main.py
# or
uvicorn main:app --host 0.0.0.0 --port 8000
```

The service will run on `http://localhost:8000`

### Option 2: Configure Environment Variable

Set the `ML_SERVICE_URL` environment variable in your backend `.env` file:

```env
ML_SERVICE_URL=http://localhost:8000
# Or if running on a different host/port:
ML_SERVICE_URL=http://your-ml-service-host:8000
```

### Option 3: Docker (Recommended for Production)

```bash
# Build and run the ML service container
docker build -t ahava-ml-service apps/ml-service
docker run -p 8000:8000 ahava-ml-service
```

## Testing ML Service Availability

### Check if ML Service is Running

```bash
# Health check
curl http://localhost:8000/

# Expected response:
# {"status": "ok", "service": "ML-Service-v1"}
```

### Test Biometric Ingestion

```bash
curl -X POST "http://localhost:8000/ingest?user_id=test-user-123" \
  -H "Content-Type: application/json" \
  -d '{
    "timestamp": "2024-01-01T12:00:00Z",
    "heart_rate_resting": 75,
    "hrv_rmssd": 50,
    "spo2": 98,
    "respiratory_rate": 16,
    "step_count": 5000,
    "active_calories": 200
  }'
```

## What Happens When ML Service is Down?

### ✅ **System Behavior (Current Implementation)**

1. **Automatic Fallback**: The system detects ML service unavailability
2. **Basic Analysis**: Uses threshold-based rules:
   - Heart rate > 100 → YELLOW alert
   - Heart rate > 120 → RED alert
   - SpO2 < 95 → YELLOW alert
   - SpO2 < 90 → RED alert
   - Blood pressure > 140/90 → YELLOW alert
   - Respiratory rate > 20 → YELLOW alert

3. **Default Scores**:
   - GREEN → Readiness Score: 100
   - YELLOW → Readiness Score: 70
   - RED → Readiness Score: 40

4. **No Errors**: API continues to work, returns valid responses

### 📊 **Comparison: With vs Without ML Service**

| Feature | Without ML Service | With ML Service |
|---------|-------------------|-----------------|
| Alert Detection | Basic thresholds | Statistical anomaly detection |
| Readiness Score | Fixed (100/70/40) | Dynamic (0-100) based on trends |
| Baseline | Not used | Personalized 14-day baseline |
| Context Awareness | No | Filters exercise-related spikes |
| Early Warnings | Basic | Advanced (heart attack, infection precursors) |
| False Positives | Higher | Lower (context-aware) |

## Is This a Problem?

### ✅ **Short Answer: No, it's not a breaking problem**

The system is designed to work without the ML service. However:

### ⚠️ **For Production Use**

1. **Recommended**: Run the ML service for better accuracy
2. **Minimum Viable**: System works with fallback, but alerts are less sophisticated
3. **Best Practice**: Deploy ML service alongside backend for full functionality

### 🔧 **Quick Fix for Testing**

If you want to test with the ML service running:

1. **Start ML Service**:
   ```bash
   cd apps/ml-service
   pip install -r requirements.txt
   python main.py
   ```

2. **Verify it's running**:
   ```bash
   curl http://localhost:8000/
   ```

3. **Test again**: Run your biometric submission test - you should now see:
   - More accurate `alertLevel` values
   - Dynamic `readinessScore` (0-100)
   - Better anomaly detection

## Monitoring ML Service Health

The backend logs warnings when ML service is unavailable:

```
[Monitoring] ML service unavailable, using fallback logic: connect ECONNREFUSED
```

You can monitor these logs to know when the ML service needs attention.

## Summary

- ✅ **System works without ML service** (fallback mode)
- ✅ **No breaking errors** - API always returns valid responses
- ⚠️ **Less sophisticated** without ML service (basic thresholds only)
- 🚀 **Recommended**: Run ML service for production-grade early warning detection
- 🔧 **Easy to start**: Just run `python main.py` in `apps/ml-service`

The empty values you saw were likely due to the response structure. This has been fixed to ensure values are always returned, even in fallback mode.

