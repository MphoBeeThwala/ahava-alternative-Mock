FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./

EXPOSE 8000

# ML_SERVICE_WORKERS: a single uvicorn worker (the default) means every
# request — including the synchronous numpy/pandas scoring in engine.py and
# the synchronous psycopg2 calls in db.py, neither of which yields to the
# asyncio event loop — blocks that one process until it completes, so
# concurrent requests fully serialize regardless of how many CPUs the
# container has. Load-tested 2026-09-18 (see docs/ENGINEERING_PLAN.md):
# under concurrent /ingest traffic a single worker started missing the
# Node backend's 5s timeout. Multiple workers are only safe to set when
# DATABASE_URL is configured (production always has this) — db.py's
# no-DATABASE_URL fallback is a per-process in-memory dict, so a second
# worker in that mode would silently split a user's history across
# processes. Defaults to 1 (unchanged local/dev behaviour); set to the
# container's CPU count in production.
CMD ["sh", "-c", "python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${ML_SERVICE_WORKERS:-1}"]
