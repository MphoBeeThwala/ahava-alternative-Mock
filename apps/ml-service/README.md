# ML Early Warning Service

Runs the early-warning analysis for biometrics (baseline, anomaly detection). The backend can run without this service (it will use built-in fallback logic).

## Python version

**Use Python 3.11 or 3.12.** Pydantic does not yet provide pre-built wheels for Python 3.14, so `pip install` will fail on 3.14 (Rust build required).

### If you only have Python 3.14

1. Install Python 3.12 from [python.org/downloads](https://www.python.org/downloads/) (or run `winget install Python.Python.3.12`).
2. From this folder run:
   ```powershell
   py -3.12 -m venv .venv312
   .\.venv312\Scripts\pip install -r requirements.txt
   .\.venv312\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8000
   ```

### If you have Python 3.11 or 3.12

```powershell
.\run.ps1
```

Or manually:
```powershell
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Service listens on **http://localhost:8000**. Backend uses `ML_SERVICE_URL=http://localhost:8000` by default.

## Security env vars

Set these in production/staging:

- `ML_SERVICE_SHARED_SECRET` : shared secret value that backend sends as `x-ahava-service-key`
- `ML_SERVICE_REQUIRE_AUTH` : `true` (default) to enforce header verification on non-public ML endpoints

Backend and ML service must use the exact same `ML_SERVICE_SHARED_SECRET`.

## Storage mode (`TIMESCALE_MODE`)

`db.py` supports three modes:

- `TIMESCALE_MODE=auto` (default): use TimescaleDB when extension is available, otherwise plain PostgreSQL table
- `TIMESCALE_MODE=on`: require TimescaleDB extension and hypertable setup
- `TIMESCALE_MODE=off`: always use plain PostgreSQL table

For Railway Postgres without Timescale installed, use `auto` or `off`.
