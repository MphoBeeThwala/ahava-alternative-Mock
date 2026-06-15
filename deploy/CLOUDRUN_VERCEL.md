# Deploy on Google Cloud Run (API) + Vercel (Workspace)

## Architecture
- **Vercel** hosts the Next.js app in `workspace/`.
- **Cloud Run** hosts the Express API in `apps/backend/`.
- The frontend calls **same-origin** `/api/*`, which is proxied at runtime by `workspace/src/app/api/[...path]/route.ts` to the backend `BACKEND_URL`.
- WebSockets connect **directly** to the backend URL from the browser (requires `NEXT_PUBLIC_BACKEND_URL`).

---

## Backend (Google Cloud Run)

### Container
- Use `apps/backend/Dockerfile`.
- The app listens on `process.env.PORT` (Cloud Run sets this automatically).
- Startup runs `prisma migrate deploy` before starting the server.

### Required environment variables
- `DATABASE_URL`
- `JWT_SECRET` (32+ chars recommended; required)

### Recommended environment variables
- `FRONTEND_URL` (used for email verification/reset links)
- `CORS_ORIGIN` (comma-separated allowlist; set to your Vercel domain(s) if you also call the backend directly from a browser)
- `REDIS_URL` (optional; enables WebSocket pub/sub across instances)
- `TIMEZONE` (defaults to Africa/Johannesburg if unset)

### Health check
- `GET /health`

---

## Frontend (Vercel)

### Project settings
- Framework: Next.js
- Root directory: `workspace`

### Required environment variables
- `BACKEND_URL` = `https://<your-cloud-run-service-url>` (no trailing slash)

### Recommended environment variables
- `NEXT_PUBLIC_BACKEND_URL` = `https://<your-cloud-run-service-url>` (no trailing slash; enables browser WebSockets)
- Avoid setting `NEXT_PUBLIC_API_URL` unless you have a specific legacy reason.

---

## WebSockets
- Backend accepts WebSocket upgrades on the same host/port as the API.
- Clients connect to: `wss://<cloud-run-host>/ws?token=<jwt>`
- If you run multiple Cloud Run instances and need cross-instance delivery, set `REDIS_URL`.
