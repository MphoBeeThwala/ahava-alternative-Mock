# Redis Troubleshooting

## Issue: "Redis not initialized" or Backend Crash on Startup

**Fixed in:** Decoupled queue from Redis so the queue module no longer calls `getRedis()` at load time. The Redis connection is now passed explicitly after initialization.

### Running Without Redis

The backend **runs without Redis** for core API and triage:

1. **Option A:** Don't set `REDIS_URL` in your `.env` (or leave it empty).
2. **Option B:** Set `REDIS_URL` but if Redis is down, the app will log a warning and continue without background jobs.

```
⚠️ REDIS_URL not set, skipping Redis/queues (core API will work)
```
or
```
⚠️ Redis/Queue unavailable, running without background jobs: <error>
```

**What works without Redis:**
- Auth, triage, visits, bookings, patient/doctor/nurse dashboards
- AI triage (Gemini + StatPearls)
- Email fallback: `addEmailJob` sends directly via Resend (no queue)

**What doesn't work without Redis:**
- BullMQ background jobs (PDF export, push notifications, queued emails)
- Redis-backed rate limiting (uses in-memory fallback)

### Running With Redis

1. **Install and start Redis locally** (e.g. `docker run -d -p 6379:6379 redis` or Windows Redis).
2. **Set** `REDIS_URL=redis://localhost:6379` in `apps/backend/.env`.
3. **Restart** the backend.

If Redis fails to connect (e.g. timeout), the app will start without queues instead of crashing.
