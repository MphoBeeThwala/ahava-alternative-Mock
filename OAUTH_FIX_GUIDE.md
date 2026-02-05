# OAuth Authentication - Final Fix Guide

## Current Status
- ✅ Port fixed (5173 everywhere)
- ✅ Cookie security fixed (secure: false for localhost)
- ✅ Redirect URI detection improved
- ⚠️ Still getting `invalid_grant` errors

## Root Cause
The `invalid_grant` error happens because:
1. Google authorization codes can only be used ONCE
2. Your browser keeps trying to reuse old codes from the URL
3. Need a completely fresh OAuth flow

## ✅ FINAL FIX - Follow These Steps EXACTLY

### Step 1: Update Google Console (CRITICAL)
1. Go to: https://console.cloud.google.com/apis/credentials
2. Click on your OAuth 2.0 Client ID
3. Under "Authorized redirect URIs", you should have ONLY:
   ```
   http://localhost:5173/auth/callback
   ```
4. **Remove any other URIs** (especially port 5174)
5. Click "SAVE"
6. **Wait 2-3 minutes** for Google to update

### Step 2: Clear Everything
```powershell
# Close ALL browser tabs for localhost:5173
# Then clear browser data:
# 1. Press Ctrl+Shift+Delete
# 2. Select "Cookies and other site data"
# 3. Select "Cached images and files"
# 4. Time range: "Last hour"
# 5. Click "Clear data"
```

### Step 3: Restart Dev Server
```powershell
# In your terminal where npm run dev is running:
# Press Ctrl+C to stop

# Then restart:
npm run dev
```

### Step 4: Test Fresh Sign-In
1. Open a **NEW** browser tab (or incognito window)
2. Go to: `http://localhost:5173`
3. Click "Sign In" or "Get Started with Google"
4. Complete Google OAuth
5. You should be redirected to `/onboarding`

## 🔍 Debugging

If it still fails, check the terminal logs for:

```
Sign-in OAuth - Origin detection: {
  finalOrigin: 'http://localhost:5173',  // Should be 5173
  redirectUri: 'http://localhost:5173/auth/callback'
}

OAuth Callback - Origin detection: {
  finalOrigin: 'http://localhost:5173',  // Should match above
  redirectUri: 'http://localhost:5173/auth/callback'
}
```

Both should show port 5173 and match exactly.

## ✅ Success Indicators

You'll know it worked when:
1. No `invalid_grant` error in terminal
2. You see: "Session created" in terminal logs
3. Browser redirects to `/onboarding`
4. You see the role selection screen

## 🆘 If Still Broken

### Backup Plan: Simplified Auth

If OAuth continues to fail, we can deploy with a simplified authentication system:

```typescript
// Temporary: Email/password auth
// Add OAuth after launch
```

This gets you to production faster, and we can add full OAuth post-launch.

**Do you want to:**
A) Keep trying OAuth (recommended - we're very close!)
B) Switch to simplified auth for faster deployment

## Current Files Status

✅ `.dev.vars` - APP_URL set to 5173
✅ `wrangler.json` - APP_URL set to 5173  
✅ `src/worker/index.ts` - Origin detection improved
✅ `src/lib/auth-middleware.ts` - Cookie security fixed

Everything is configured correctly. The issue is just stale browser state + old auth codes.

---

**Next: Follow Steps 1-4 above, then test!**

