# Railway deployment – frontend + backend

## Fix CORS / login once and for all

The frontend **always** calls `/api` on its own origin. Next.js rewrites proxy `/api/*` to the backend. So the browser never talks to the backend URL → **no CORS**.

### Frontend service (Railway)

1. **Variables** – set exactly:
   - **`BACKEND_URL`** = `https://backend-production-9a3b.up.railway.app`  
     (your real backend URL, no trailing slash, no `/api`)
2. **Remove** **`NEXT_PUBLIC_API_URL`** if it exists (so the app never uses the backend URL from the browser).
3. **Redeploy** the frontend (new build) so rewrites use this `BACKEND_URL`.

### Backend service (Railway)

- No change. CORS is irrelevant once the frontend uses the proxy.

### After redeploy

- Login/signup go to `https://frontend-production-326c.up.railway.app/api/auth/login` (same origin).
- Next.js proxies to your backend. No CORS.

### If you see 502 on login/signup

A **502 Bad Gateway** means the frontend reached the backend via the proxy but the backend response was invalid. Common causes:

1. **Backend service not running** – In Railway, open the backend service and check it’s deployed and running (not crashed or sleeping).
2. **Wrong or missing BACKEND_URL** – On the **frontend** service, ensure `BACKEND_URL` is set to your backend URL (e.g. `https://backend-production-9a3b.up.railway.app`) with no trailing slash. Redeploy the frontend after changing it.
3. **Backend crash on startup** – Check backend logs (e.g. DB connection, Redis, env vars). Fix the backend so it starts and stays up; the 502 will stop once the backend responds.
