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
