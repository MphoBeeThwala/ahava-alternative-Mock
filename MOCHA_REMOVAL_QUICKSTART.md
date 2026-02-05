# 🚀 Mocha Removal - Quick Start

## ✅ Done For You

I've already created everything you need:

### Files Created (Ready to Use)
- ✅ `src/lib/auth.ts` - Better Auth config
- ✅ `src/lib/auth-middleware.ts` - Auth middleware
- ✅ `src/react-app/lib/auth-context.tsx` - React hooks
- ✅ `migrations/10.sql` - Database tables
- ✅ `package.json` - Updated dependencies

### Documentation Created
- ✅ `docs/BETTER_AUTH_MIGRATION_GUIDE.md` - Full guide
- ✅ `docs/MOCHA_REMOVAL_GUIDE.md` - Why remove Mocha
- ✅ `docs/MOCHA_REMOVAL_SUMMARY.md` - Overview
- ✅ `env.example` - Updated with Google OAuth

---

## 📋 Your To-Do List (4-6 hours)

### ⏱️ Quick Setup (30 minutes)

```bash
# 1. Install dependencies (2 min)
npm install

# 2. Get Google OAuth (15 min)
# → https://console.cloud.google.com/apis/credentials
# → Create OAuth 2.0 Client ID
# → Add redirect: http://localhost:5173/api/auth/callback/google
# → Copy Client ID & Secret

# 3. Update .dev.vars (2 min)
GOOGLE_CLIENT_ID=your_id_here
GOOGLE_CLIENT_SECRET=your_secret_here
APP_URL=http://localhost:5173

# (Keep your existing GEMINI_API_KEY, etc.)

# 4. Run migration (2 min)
wrangler d1 execute DB --file=./migrations/10.sql
```

### ⏱️ Code Updates (2-3 hours)

Open `docs/BETTER_AUTH_MIGRATION_GUIDE.md` and follow Step 4.

**Files to update (find/replace imports):**

1. **src/worker/index.ts** (20 min)
   - Replace Mocha imports with Better Auth
   - Delete OAuth endpoints (lines 136-249)
   - Add Better Auth initialization

2. **src/react-app/App.tsx** (2 min)
   ```typescript
   // Change this line:
   import { AuthProvider } from "@getmocha/users-service/react";
   // To:
   import { AuthProvider } from "@/react-app/lib/auth-context";
   ```

3. **All dashboard pages** (30 min) - 8 files:
   - PatientDashboard.tsx
   - DoctorDashboard.tsx
   - NurseDashboard.tsx
   - AdminDashboard.tsx
   - DiagnosticVault.tsx
   - Home.tsx
   - AuthCallback.tsx
   - Onboarding.tsx (if uses useAuth)
   
   ```typescript
   // Change this line in each:
   import { useAuth } from "@getmocha/users-service/react";
   // To:
   import { useAuth } from "@/react-app/lib/auth-context";
   ```

4. **src/react-app/pages/Home.tsx** (10 min)
   - Update Google login button to use `loginWithGoogle()`

5. **vite.config.ts** (2 min)
   - Remove Mocha plugin import

### ⏱️ Testing (30 min)

```bash
npm run dev

# Test checklist:
✓ Click "Sign in with Google"
✓ Complete OAuth flow
✓ Redirected to dashboard
✓ Session persists on refresh
✓ Logout works
✓ Login again
✓ All protected routes work
```

### ⏱️ Deploy (30 min)

```bash
# Production secrets
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# Production migration
wrangler d1 execute DB --remote --file=./migrations/10.sql

# Deploy
npm run build
wrangler deploy
```

---

## 💰 Result

**Before:**
- Mocha: $10-50/month
- Limited features
- No control

**After:**
- Better Auth: **FREE**
- More features (email/password, 2FA, magic links)
- Full control (perfect for HIPAA)

**Annual Savings: $120-600!** 🎉

---

## 📞 Need Help?

**Full Guide:** `docs/BETTER_AUTH_MIGRATION_GUIDE.md`

**Time:** 4-6 hours total

**Difficulty:** ⭐⭐ Moderate (well documented)

---

**Ready? Start with Step 1 above!** 🚀

