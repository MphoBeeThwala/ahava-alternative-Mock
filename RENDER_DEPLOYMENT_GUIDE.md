# 🚀 Render Deployment Guide for Ahava Healthcare

This guide walks you through deploying your monorepo to **Render.com** instead of Railway. Render supports all your services: Express backend, frontend apps, worker service, and managed databases.

---

## ✅ **Is Render Enough for the Monorepo?**

**YES**, Render is perfectly suitable for your monorepo deployment:

### ✅ **Supports**
- **Web Services** → Backend API (Express) + Frontend apps (Next.js, React)
- **Background Workers** → BullMQ workers
- **Managed Databases** → PostgreSQL (Render Postgres)
- **Managed Redis** → Redis cache
- **Auto-scaling** → Built-in horizontal scaling
- **Auto-deploy** → Git integration with automatic deployments
- **Multiple services** → Deploy API, admin, doctor, worker all in one project

### ⚠️ **Limitations** (Minor)
- Render doesn't support monorepo builds out-of-the-box like Railway
- Each service needs explicit `rootDir` configuration (already in `render.yaml`)
- Build times may be ~2-5 mins per service (normal for Node.js)

---

## 📋 **Step 1: Setup Render Account & Prepare Repo**

### 1.1 Create Render Account
1. Go to [render.com](https://render.com)
2. Sign up with GitHub
3. Authorize Render to access your GitHub repositories

### 1.2 Update Your Repository

Your `render.yaml` exists at `deploy/render/render.yaml`. However, we need to make it the main deployment config. Copy it to the root:

```bash
# Copy Render config to root (Render looks here by default)
cp deploy/render/render.yaml ./render.yaml
```

Or create a new one at the root with this content:

```yaml
services:
  # ─── Backend API (Express.js) ───────────────────
  - type: web
    name: ahava-api
    env: node
    plan: standard
    branch: main
    rootDir: apps/backend
    buildCommand: npm ci && npm run build
    startCommand: node dist/index.js
    healthCheckPath: /health
    healthCheckInterval: 30
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
      - key: DATABASE_URL
        sync: false
      - key: REDIS_URL
        sync: false
      - key: JWT_SECRET
        sync: false
      - key: ENCRYPTION_KEY
        sync: false
      - key: ENCRYPTION_IV_SALT
        sync: false
      - key: PAYSTACK_SECRET_KEY
        sync: false
      - key: PAYSTACK_WEBHOOK_SECRET
        sync: false
      - key: FRONTEND_URL
        sync: false
      - key: TIMEZONE
        value: Africa/Johannesburg

  # ─── Frontend (Next.js) ───────────────────────────
  - type: web
    name: ahava-frontend
    env: node
    plan: standard
    branch: main
    rootDir: workspace
    buildCommand: npm ci && npm run build
    startCommand: npm start
    healthCheckPath: /
    envVars:
      - key: NODE_ENV
        value: production
      - key: NEXT_PUBLIC_API_URL
        sync: false

  # ─── Background Worker (BullMQ) ────────────────────
  - type: background
    name: ahava-worker
    env: node
    plan: standard
    branch: main
    rootDir: apps/worker
    buildCommand: npm ci && npm run build
    startCommand: node dist/worker.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: REDIS_URL
        sync: false

# ─── Managed Databases ──────────────────────────────
databases:
  - name: ahava-postgres
    databaseName: ahava_db
    plan: standard
    version: "15"
    
  - name: ahava-redis
    plan: standard
```

---

## 🔧 **Step 2: Code Changes Required**

### 2.1 Update Backend for Render (apps/backend)

**File:** `apps/backend/src/index.ts`

Update CORS origins to include Render domains:

```typescript
// Line 65-80: Update CORS origins
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  : process.env.NODE_ENV === "production"
    ? [
        "https://ahava-frontend.onrender.com",  // ← Add Render frontend URL
        // Keep existing Railway URLs if you're migrating gradually
        "https://ahava-healthcare-admin.railway.app",
        "https://ahava-healthcare-doctor.railway.app",
      ]
    : [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3003",
        "http://127.0.0.1:3003",
      ];
```

**File:** `apps/backend/Dockerfile` (Check if needed)

Render uses `buildCommand` + `startCommand` from `render.yaml`, but we should verify the Dockerfile works. Update if building from Dockerfile:

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build

FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 apiuser
WORKDIR /app
COPY --from=builder --chown=apiuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=apiuser:nodejs /app/dist ./dist
COPY --from=builder --chown=apiuser:nodejs /app/package.json ./
COPY --from=builder --chown=apiuser:nodejs /app/prisma ./prisma
USER apiuser
EXPOSE 10000
ENV NODE_ENV=production
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/index.js"]
```

### 2.2 Update Frontend for Render (workspace)

**File:** `workspace/package.json`

Ensure the `start` script works with Render:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "node_modules/.next/standalone/server.js",
    "lint": "eslint",
    "test": "echo \"No tests configured for workspace\""
  }
}
```

If the above doesn't work, use Next.js built-in start:

```json
{
  "scripts": {
    "start": "next start -p ${PORT:-3000}"
  }
}
```

**File:** `workspace/next.config.ts` (Create if doesn't exist)

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone", // ← Enables standalone server for Render
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:10000",
  },
};

export default nextConfig;
```

### 2.3 Update Worker (apps/worker)

**File:** `apps/worker/package.json`

Ensure it has proper start command:

```json
{
  "scripts": {
    "dev": "tsx watch src/worker.ts",
    "build": "tsc",
    "start": "node dist/worker.js",
    "test": "echo 'No tests'",
    "type-check": "tsc --noEmit"
  }
}
```

---

## 🌐 **Step 3: Connect to Render Dashboard**

### 3.1 Create Blueprint (Recommended - One-Click Deploy)

1. Go to [render.com/blueprints](https://render.com/blueprints)
2. Click **"New Blueprint"**
3. Connect your GitHub repo
4. Render will detect `render.yaml` automatically
5. Click **"Apply Blueprint"**
6. Fill in environment variables (see Step 4)

### 3.2 Manual Service Creation (Alternative)

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"+ New"** → **"Web Service"**
3. Select your GitHub repository
4. Configure:
   - **Name:** `ahava-api`
   - **Branch:** `main`
   - **Root Directory:** `apps/backend`
   - **Build Command:** `npm ci && npm run build`
   - **Start Command:** `node dist/index.js`
   - **Plan:** Standard ($7/month)
5. Click **"Create Web Service"**
6. Repeat for frontend, worker

---

## 🔑 **Step 4: Configure Environment Variables**

### 4.1 Add Environment Variables to Render

In Render Dashboard → Your Service → **Environment**:

**For Backend (`ahava-api`):**
```
NODE_ENV=production
PORT=10000
DATABASE_URL=postgresql://user:password@host:5432/ahava_db
REDIS_URL=redis://default:password@host:6379
JWT_SECRET=your-32-character-secret-key-here
ENCRYPTION_KEY=base64-encoded-32-byte-key
ENCRYPTION_IV_SALT=another-secret-salt
PAYSTACK_SECRET_KEY=sk_live_your_key
PAYSTACK_WEBHOOK_SECRET=whsec_your_secret
FRONTEND_URL=https://ahava-frontend.onrender.com
TIMEZONE=Africa/Johannesburg
```

**For Frontend (`ahava-frontend`):**
```
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://ahava-api.onrender.com
```

**For Worker (`ahava-worker`):**
```
NODE_ENV=production
REDIS_URL=postgresql://user:password@host:5432/ahava_db
```

### 4.2 Get Database Connection Strings

After creating PostgreSQL and Redis on Render:

1. Go to Render Dashboard → **Databases**
2. Click on **`ahava-postgres`** → Copy **External Database URL**
3. Click on **`ahava-redis`** → Copy **Internal Redis URL** (or External if worker needs it)
4. Paste into environment variables above

---

## 🚀 **Step 5: Deploy**

### 5.1 Automatic Deploy (Recommended)

Once environment variables are set, just push to `main`:

```bash
git add .
git commit -m "Configure for Render deployment"
git push origin main
```

Render will automatically:
1. Detect the push
2. Build all services in `render.yaml`
3. Deploy them in order
4. Show logs in dashboard

### 5.2 Manual Redeploy

Go to Render Dashboard → Service → **"Manual Deploy"** → Click button

---

## 📊 **Step 6: Verify Deployment**

### 6.1 Check Service Health

In Render Dashboard:
- Click each service
- Look for **"Live"** status (green)
- Check **Logs** for errors

### 6.2 Test API

```bash
curl https://ahava-api.onrender.com/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2025-06-15T10:30:00Z",
  "timezone": "Africa/Johannesburg"
}
```

### 6.3 Test Frontend

Visit `https://ahava-frontend.onrender.com` in browser

---

## 🔄 **Troubleshooting**

### Issue: "Build failed"
**Solution:**
- Check **Logs** tab in Render dashboard
- Ensure all environment variables are set
- Verify `buildCommand` matches your `package.json` scripts

### Issue: "Service crashed"
**Solution:**
- Check logs: `Logs` tab in Render
- Ensure `DATABASE_URL` is correct
- Check Redis connection with `REDIS_URL`
- Look for port conflicts (use `PORT=10000` for backend)

### Issue: "CORS errors in browser"
**Solution:**
- Update `CORS_ORIGIN` in backend code (see Step 2.1)
- Make sure `NEXT_PUBLIC_API_URL` matches backend URL
- Clear browser cache

### Issue: "Prisma migrations fail"
**Solution:**
- Add to backend's `startCommand`:
  ```
  sh -c "npx prisma migrate deploy && node dist/index.js"
  ```
- Or run migrations manually:
  - Render Dashboard → Service → **Shell** tab
  - Run: `npx prisma migrate deploy`

---

## 💰 **Pricing**

**Render Standard Plan Costs:**
- 1 Web Service: $7/month
- 1 PostgreSQL (standard): $15/month
- 1 Redis (standard): $20/month
- **Total per service**: ~$42/month × 3 services = **~$126/month**

**Cost Optimization:**
- Use **"Starter" plan** for frontend ($7/month)
- Use **"Starter" databases** if low traffic ($7 each)
- **Total optimized**: ~$50/month

---

## 🎯 **Migration Checklist**

- [ ] Fork/clone repo
- [ ] Copy `deploy/render/render.yaml` to root as `render.yaml`
- [ ] Update CORS origins in backend code
- [ ] Update Next.js config in frontend
- [ ] Create Render account
- [ ] Create Blueprint or manually add services
- [ ] Add environment variables
- [ ] Create PostgreSQL database
- [ ] Create Redis instance
- [ ] Push to `main` branch
- [ ] Monitor logs in Render dashboard
- [ ] Test `/health` endpoint
- [ ] Test frontend UI
- [ ] Set custom domain (optional)

---

## 🆘 **Need Help?**

- **Render Docs:** https://render.com/docs
- **GitHub Issues:** Create an issue in the repo
- **Email:** support@ahavahealthcare.co.za

---

**Happy deploying! 🚀**
