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

## Research tooling (offline) and shadow scoring

`python -m research ...` builds datasets from the pseudonymised research tables, trains and evaluates
candidate models, reports whether there is enough data to seek validation, and manages the human approval
gate. It needs `pip install -r requirements-research.txt` (scikit-learn) and `RESEARCH_DATABASE_URL`
(a read-only login from `pnpm --filter backend research-db-role`). Try it without patient data via
`--source synthetic`. The live service needs none of this: it serves only models a named person has approved
for **shadow** scoring (`GET /research/models`, `POST /research/shadow-predict`), numpy only, and by default
serves none. Optional: `RESEARCH_MODEL_DIR` (default `research/artifacts`). Full guide:
`docs/RESEARCH_DATA_PIPELINE.md`.

## Database connections

Every uvicorn worker is a separate process with its own connection pool, and each pool opens its minimum at start-up.
Fixed per-worker sizes therefore multiply with workers and replicas (5 per worker x 8 workers x 3 replicas = 120
connections held open, against a Postgres that allows about 100 by default). Past the limit new connections are refused
and the service quietly falls back to in-memory history, losing readings on restart.

So the pool is sized from a **budget per replica**, shared out among that replica's workers:

- `ML_DB_CONNECTIONS_PER_REPLICA` (default `20`): connections one replica may hold in total.
- `ML_SERVICE_WORKERS` (default `1`): workers per replica. Adding workers never adds connections; each just gets a smaller share.
- `ML_DB_POOL_MIN` (default `1`) and `ML_DB_POOL_MAX` (default: budget divided by workers) override per worker.
  An override that would exceed the budget is allowed but logged as a warning.

Size it so that `replicas x ML_DB_CONNECTIONS_PER_REPLICA` stays well under the database's `max_connections`
(`SHOW max_connections;`), leaving room for the backend. The effective numbers are logged at start-up (`[db] Connection pool created ...`).

