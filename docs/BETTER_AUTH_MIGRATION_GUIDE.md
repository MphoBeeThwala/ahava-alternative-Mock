# Complete Mocha Removal - Step-by-Step Migration Guide

## 🎯 Overview

This guide will help you completely remove Mocha and replace it with Better Auth - a FREE, open-source authentication system that's better in every way.

**Benefits:**
- ✅ Save $120-600/year
- ✅ More features (email/password, magic links, 2FA, etc.)
- ✅ Full control for HIPAA compliance
- ✅ Better than Mocha

**Time Required:** 4-6 hours

---

## Step 1: Install Dependencies (5 minutes)

```bash
# Remove Mocha
npm uninstall @getmocha/users-service @getmocha/vite-plugins

# Install Better Auth
npm install better-auth arctic

# Install if needed
npm install
```

---

## Step 2: Update Environment Variables (5 minutes)

### Update .dev.vars (Development)

```bash
# Remove Mocha vars (DELETE THESE):
# MOCHA_USERS_SERVICE_API_URL=...
# MOCHA_USERS_SERVICE_API_KEY=...

# Add Better Auth vars:
APP_URL=http://localhost:5173
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Get Google OAuth credentials from:
# https://console.cloud.google.com/apis/credentials
```

### Update env.example

Replace Mocha section with:
```bash
# ============================================
# Google OAuth (for Better Auth)
# ============================================
# Get credentials from: https://console.cloud.google.com/apis/credentials
# Used for: Google Sign-In authentication
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
APP_URL=http://localhost:5173
```

---

## Step 3: Run Database Migration (2 minutes)

```bash
# Create Better Auth tables
wrangler d1 execute DB --file=./migrations/10.sql

# Verify tables created
wrangler d1 execute DB --command "SELECT name FROM sqlite_master WHERE type='table'"

# Should see: user, session, account, verification
```

---

## Step 4: Replace Backend Auth (30 minutes)

### Files Already Created:
- ✅ `src/lib/auth.ts` - Better Auth configuration
- ✅ `src/lib/auth-middleware.ts` - Auth middleware
- ✅ `migrations/10.sql` - Database tables

### Update src/worker/index.ts

**Find and replace these imports:**

```typescript
// ❌ DELETE THIS:
import {
  exchangeCodeForSessionToken,
  getOAuthRedirectUrl,
  authMiddleware,
  deleteSession,
  MOCHA_SESSION_TOKEN_COOKIE_NAME,
} from "@getmocha/users-service/backend";
import { getCookie, setCookie } from "hono/cookie";

// ✅ REPLACE WITH:
import { createAuth } from "@/lib/auth";
import { authMiddleware, requireRole } from "@/lib/auth-middleware";
```

**Initialize Better Auth (add after app creation):**

```typescript
const app = new Hono<{ Bindings: Env }>();

// ✅ ADD THIS:
// Initialize Better Auth
app.use("*", async (c, next) => {
  const auth = createAuth(c.env.DB, c.env);
  c.set("auth", auth);
  await next();
});

// Better Auth handles all /api/auth/** routes
app.on(["POST", "GET"], "/api/auth/**", async (c) => {
  const auth = c.get("auth");
  return auth.handler(c.req.raw);
});
```

**Delete Mocha OAuth endpoints (lines 136-249):**

```typescript
// ❌ DELETE ALL OF THESE:
// OAuth redirect URL
app.get("/api/oauth/google/redirect_url", async (c) => { ... });

// Exchange code for session token
app.post("/api/sessions", async (c) => { ... });

// Get current user  
app.get("/api/users/me", authMiddleware, async (c) => { ... });

// Logout
app.get("/api/logout", async (c) => { ... });
```

These are now handled by Better Auth automatically!

---

## Step 5: Update Frontend Components (1-2 hours)

### Files Already Created:
- ✅ `src/react-app/lib/auth-context.tsx` - Auth provider and hooks

### Update src/react-app/App.tsx

```typescript
// ❌ DELETE THIS:
import { AuthProvider } from "@getmocha/users-service/react";

// ✅ REPLACE WITH:
import { AuthProvider } from "@/react-app/lib/auth-context";

// Keep the rest the same - AuthProvider works identically!
```

### Update All Dashboard Pages

**Files to update:**
- src/react-app/pages/PatientDashboard.tsx
- src/react-app/pages/DoctorDashboard.tsx
- src/react-app/pages/NurseDashboard.tsx
- src/react-app/pages/AdminDashboard.tsx
- src/react-app/pages/DiagnosticVault.tsx
- src/react-app/pages/Home.tsx

**Find and replace in each file:**

```typescript
// ❌ DELETE THIS:
import { useAuth } from "@getmocha/users-service/react";

// ✅ REPLACE WITH:
import { useAuth } from "@/react-app/lib/auth-context";

// Everything else stays the same!
// useAuth() works identically
```

### Update src/react-app/pages/AuthCallback.tsx

**Replace entire file with:**

```typescript
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/lib/auth-context";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Better Auth handles callback automatically
        // Just refresh user and redirect
        await refreshUser();
        navigate("/onboarding");
      } catch (error) {
        console.error("Authentication failed:", error);
        navigate("/");
      }
    };

    handleCallback();
  }, [navigate, refreshUser]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-[#004aad] mx-auto mb-4"></div>
        <p className="text-gray-600">Completing sign in...</p>
      </div>
    </div>
  );
}
```

### Update src/react-app/pages/Home.tsx (Login Page)

Update the Google login button:

```typescript
// ❌ OLD:
const redirectToGoogle = async () => {
  const response = await fetch("/api/oauth/google/redirect_url");
  const data = await response.json();
  window.location.href = data.redirectUrl;
};

// ✅ NEW:
const { loginWithGoogle } = useAuth();

<button
  onClick={loginWithGoogle}
  className="..."
>
  Sign in with Google
</button>
```

---

## Step 6: Update vite.config.ts (2 minutes)

```typescript
// ❌ DELETE THIS:
import { mochaPlugins } from "@getmocha/vite-plugins";

// Update plugins array:
plugins: [
  react(),
  cloudflare(),
  // ❌ DELETE: ...mochaPlugins(),
],
```

---

## Step 7: Get Google OAuth Credentials (15 minutes)

### Create OAuth App

1. Go to https://console.cloud.google.com/apis/credentials
2. Create new project (or select existing)
3. Click "Create Credentials" → "OAuth 2.0 Client ID"
4. Application type: "Web application"
5. Name: "Ahava Healthcare"
6. Authorized redirect URIs:
   ```
   http://localhost:5173/api/auth/callback/google
   https://your-domain.com/api/auth/callback/google
   ```
7. Click "Create"
8. Copy Client ID and Client Secret
9. Add to `.dev.vars`:
   ```bash
   GOOGLE_CLIENT_ID=your_id_here
   GOOGLE_CLIENT_SECRET=your_secret_here
   ```

---

## Step 8: Test Everything (30 minutes)

### Start Dev Server

```bash
npm run dev
```

### Test Checklist

- [ ] Visit http://localhost:5173
- [ ] Click "Sign in with Google"
- [ ] Complete Google OAuth flow
- [ ] Redirected to /onboarding
- [ ] Create profile
- [ ] Access dashboard (patient/doctor/nurse)
- [ ] Logout works
- [ ] Login again
- [ ] Session persists on refresh
- [ ] Protected routes work

### Common Issues

**"auth.handler is not a function"**
- Check Better Auth is initialized in worker
- Verify `createAuth` is called correctly

**"Google OAuth error"**
- Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
- Verify redirect URI in Google Console

**"Database error"**
- Run migration 10: `wrangler d1 execute DB --file=./migrations/10.sql`

**"User data not loading"**
- Check `user` table exists
- Verify `profiles` table has records

---

## Step 9: Deploy to Production (30 minutes)

### Set Production Environment Variables

```bash
# Cloudflare Workers secrets
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# Cloudflare Pages (if using):
# Dashboard → Pages → Settings → Environment Variables
# Add: APP_URL=https://your-domain.com
```

### Update Google OAuth

Add production redirect URI:
```
https://your-domain.com/api/auth/callback/google
```

### Run Migration on Production

```bash
wrangler d1 execute DB --remote --file=./migrations/10.sql
```

### Deploy

```bash
npm run build
wrangler deploy
```

### Verify Production

- [ ] Login works
- [ ] OAuth callback works
- [ ] Sessions persist
- [ ] All protected routes work

---

## Step 10: Cleanup (5 minutes)

### Remove Mocha References

```bash
# Search for remaining Mocha references
grep -r "mocha" . --exclude-dir=node_modules

# Update any documentation
# Remove Mocha from:
# - README.md
# - docs/PRODUCTION_READINESS_ASSESSMENT.md
# - docs/DEPLOYMENT_GUIDE.md
# - QUICK_START_CHECKLIST.md
```

### Update Cost Estimates

Remove Mocha ($10-50/month) from all cost calculations!

---

## Comparison: Before & After

### Before (Mocha)

```typescript
// Backend
import { authMiddleware } from "@getmocha/users-service/backend";

// Frontend
import { useAuth } from "@getmocha/users-service/react";
const { logout } = useAuth();

// Cost: $10-50/month
// Features: Google OAuth only
// Control: Limited
```

### After (Better Auth)

```typescript
// Backend
import { authMiddleware } from "@/lib/auth-middleware";

// Frontend  
import { useAuth } from "@/react-app/lib/auth-context";
const { logout } = useAuth();

// Cost: $0/month (FREE!)
// Features: Google OAuth + Email/Password + Magic Links + More
// Control: Full (perfect for HIPAA)
```

---

## Troubleshooting Guide

### Issue: "Cannot find module '@/lib/auth'"

**Solution:**
```bash
# Check tsconfig.json has path mapping:
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### Issue: "User session not persisting"

**Solution:**
- Check cookies are being set
- Verify `session` table has records
- Check `expiresIn` in auth config

### Issue: "OAuth redirect not working"

**Solution:**
- Verify redirect URI in Google Console matches exactly
- Check APP_URL environment variable
- Ensure Better Auth routes are registered

---

## Rollback Plan (if needed)

If something goes wrong:

```bash
# 1. Reinstall Mocha
npm install @getmocha/users-service @getmocha/vite-plugins

# 2. Restore old code from git
git checkout HEAD -- src/worker/index.ts
git checkout HEAD -- src/react-app/

# 3. Rollback database
wrangler d1 execute DB --file=./migrations/10/down.sql
```

---

## Post-Migration Checklist

After successful migration:

- [ ] All users can login
- [ ] Google OAuth works
- [ ] Sessions persist correctly
- [ ] Protected routes work
- [ ] No console errors
- [ ] Production deployed
- [ ] Documentation updated
- [ ] Cost savings confirmed ($120-600/year!)
- [ ] Team trained on new system
- [ ] Mocha dependency removed from package.json

---

## Support

**Questions?**
- Review this guide again
- Check Better Auth docs: https://better-auth.com
- Test in development first
- Ask for help if stuck

---

**Migration Status:** Ready to Execute

**Estimated Time:** 4-6 hours total

**Cost Savings:** $120-600/year

**Result:** Better auth system + Full HIPAA control + $0 monthly cost

---

**Ready to start?** Follow steps 1-10 in order. Test thoroughly at each step. Deploy to production last.

**Last Updated:** January 25, 2026

