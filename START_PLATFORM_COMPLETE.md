# Complete Platform Startup Guide

## Quick Start (Both Frontend & Backend)

### Option 1: Start Both Services (Recommended)

**Terminal 1 - Backend:**
```bash
cd apps/backend
pnpm dev
```
Backend will run on: `http://localhost:4000`

**Terminal 2 - Frontend:**
```bash
cd workspace
pnpm dev
```
Frontend will run on: `http://localhost:3000`

---

## Step-by-Step Setup

### 1. **Start Backend Server**

```bash
# Navigate to backend
cd apps/backend

# Start development server
pnpm dev
```

**Expected Output:**
```
🔄 Starting initialization...
🔄 Connecting to Redis...
✅ Redis connected
🔄 Initializing Queues...
✅ BullMQ queues initialized
🚀 Ahava Healthcare API server running on port 4000
🌍 Timezone: Africa/Johannesburg
📊 Environment: development
```

**If you see errors:**
- **Redis connection failed**: Make sure Redis is running or set `REDIS_URL` in `.env`
- **Database connection failed**: Check `DATABASE_URL` in `.env`
- **Port 4000 already in use**: Stop other services or change `PORT` in `.env`

### 2. **Start Frontend Server**

Open a **new terminal** (keep backend running):

```bash
# Navigate to frontend
cd workspace

# Check environment variable (optional)
# Create .env.local if needed:
# NEXT_PUBLIC_API_URL=http://localhost:4000/api

# Start development server
pnpm dev
```

**Expected Output:**
```
  ▲ Next.js 15.5.4
  - Local:        http://localhost:3000
  - Ready in 2.3s
```

### 3. **Verify Connection**

1. Open browser: `http://localhost:3000`
2. Try to login or register
3. Check browser console for errors
4. Check backend terminal for API requests

---

## Troubleshooting Connection Errors

### Error: `ERR_CONNECTION_REFUSED`

**Cause:** Backend server is not running

**Solution:**
1. Check if backend is running:
   ```bash
   # Check if port 4000 is in use
   netstat -ano | findstr :4000
   ```

2. Start backend:
   ```bash
   cd apps/backend
   pnpm dev
   ```

3. Wait for "🚀 Ahava Healthcare API server running on port 4000"

### Error: `CORS Error`

**Cause:** Backend CORS not configured for frontend origin

**Solution:**
- Backend CORS is already configured for `http://localhost:3000` in development
- If using a different port, update `apps/backend/src/index.ts` CORS config

### Error: `401 Unauthorized`

**Cause:** Token expired or invalid

**Solution:**
1. Clear browser localStorage:
   ```javascript
   localStorage.clear()
   ```
2. Refresh page and login again

### Error: `500 Internal Server Error`

**Cause:** Backend database or service issue

**Solution:**
1. Check backend terminal for error messages
2. Verify database connection in `apps/backend/.env`
3. Check Redis connection if using queues

---

## Environment Variables

### Backend (`apps/backend/.env`)
```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/ahava_healthcare"

# Redis (optional for queues)
REDIS_URL="redis://localhost:6379"

# JWT
JWT_SECRET="your-32-character-secret-key-here"

# Encryption
ENCRYPTION_KEY="base64-encoded-32-byte-key"

# Server
PORT=4000
NODE_ENV=development
TIMEZONE=Africa/Johannesburg
```

### Frontend (`workspace/.env.local`)
```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```

**Note:** Frontend defaults to `http://localhost:4000/api` if `.env.local` is not set.

---

## Testing the Connection

### 1. **Health Check**
Open in browser: `http://localhost:4000/health`

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-02-10T...",
  "timezone": "Africa/Johannesburg"
}
```

### 2. **Test Login**
1. Go to: `http://localhost:3000/auth/login`
2. Use test credentials or register new user
3. Check browser Network tab for API calls
4. Verify successful login redirects to dashboard

### 3. **Check Backend Logs**
Backend terminal should show:
```
POST /api/auth/login 200
GET /api/visits 200
GET /api/bookings 200
```

---

## Running Both Services Together

### Windows PowerShell (Two Terminals)

**Terminal 1:**
```powershell
cd C:\Users\User\ahava-healthcare-1\apps\backend
pnpm dev
```

**Terminal 2:**
```powershell
cd C:\Users\User\ahava-healthcare-1\workspace
pnpm dev
```

### Using VS Code Terminal

1. Open VS Code
2. Open Terminal (Ctrl + `)
3. Click "+" to create new terminal
4. Split terminal (Ctrl + Shift + 5)
5. Run backend in one, frontend in other

---

## Quick Commands Reference

```bash
# Backend
cd apps/backend
pnpm dev              # Start backend
pnpm build            # Build for production
pnpm start            # Run production build

# Frontend
cd workspace
pnpm dev              # Start frontend
pnpm build            # Build for production
pnpm start            # Run production build

# Both (from root)
pnpm dev              # Start all services (if configured)
```

---

## Common Issues

### Port Already in Use

**Backend (4000):**
```bash
# Find process using port 4000
netstat -ano | findstr :4000

# Kill process (replace PID)
taskkill /PID <PID> /F
```

**Frontend (3000):**
```bash
# Find process using port 3000
netstat -ano | findstr :3000

# Kill process
taskkill /PID <PID> /F
```

### Database Not Connected

1. Check PostgreSQL is running
2. Verify `DATABASE_URL` in `apps/backend/.env`
3. Run migrations: `cd apps/backend && pnpm prisma:migrate`

### Redis Not Connected

1. Check Redis is running (optional - queues won't work without it)
2. Verify `REDIS_URL` in `apps/backend/.env`
3. Backend will still work without Redis, but background jobs won't run

---

## Success Indicators

✅ **Backend Running:**
- Terminal shows: "🚀 Ahava Healthcare API server running on port 4000"
- `http://localhost:4000/health` returns JSON

✅ **Frontend Running:**
- Terminal shows: "Ready in X.Xs"
- `http://localhost:3000` loads homepage

✅ **Connection Working:**
- Login/Register works
- No `ERR_CONNECTION_REFUSED` errors
- API calls return 200 status codes
- Dashboards load data

---

## Next Steps

Once both services are running:

1. ✅ Test authentication (login/register)
2. ✅ Test patient dashboard (biometrics, triage)
3. ✅ Test nurse dashboard (availability, visits)
4. ✅ Test doctor dashboard (pending reviews)
5. ✅ Test admin dashboard (user management)

**Happy coding! 🚀**

