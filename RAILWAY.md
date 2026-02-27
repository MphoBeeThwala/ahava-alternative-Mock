# Railway deployment – frontend + backend

## Frontend service must use the Next.js (workspace) app

The **patient-facing app** (Patient Portal, Early Warning, AI Doctor) is the **Next.js app** in the `workspace` folder. To get the latest UI (teal theme, Early Warning in sidebar) and avoid an old or wrong build:

1. **Root Directory:** Leave **empty** (repo root). Do **not** set Root to `frontend` (that’s a different, older Vite app).
2. **Build:** A root `railway.toml` tells Railway to use `workspace/Dockerfile`. If your frontend service uses repo root, it will use that and build the Next.js app.
3. **After deploy:** In the sidebar you should see **“App v2”** at the bottom and links for **Early Warning (ML)** and **AI Doctor**. If you still see purple and only “Patient Portal”, trigger a **redeploy** and do a **hard refresh** (Ctrl+Shift+R).

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
