# 🚀 Ahava Healthcare - Production Deployment Guide

## ✅ Pre-Deployment Checklist - COMPLETED

### Infrastructure ✅
- [x] All 11 database migrations run successfully
- [x] TypeScript compilation passes
- [x] Vite build successful (326 KB client bundle)
- [x] Wrangler dry-run passes
- [x] Security features implemented (rate limiting, audit logs)
- [x] Input validation with Zod

### Code Quality ✅
- [x] Authentication system (Google OAuth with arctic)
- [x] Session management with D1
- [x] API routes protected with middleware
- [x] Error handling and logging
- [x] Environment variable management

## 🎯 Deployment Steps

### Step 1: Cloudflare Authentication

```powershell
npx wrangler login
```

This opens your browser to authenticate with Cloudflare.

### Step 2: Create Production R2 Bucket

```powershell
npx wrangler r2 bucket create ahava-medical-images
```

Then enable public access:
1. Go to https://dash.cloudflare.com → R2
2. Click on `ahava-medical-images`
3. Settings → Public Access → Allow Access
4. Copy the public URL (e.g., `https://pub-xxxxx.r2.dev`)

### Step 3: Configure Production Environment

Update `wrangler.json` with production values:

```json
{
  "vars": {
    "APP_URL": "https://ahava.YOUR-DOMAIN.workers.dev"
  }
}
```

**Important:** After deployment, you'll get the actual Workers URL. Update this and redeploy.

### Step 4: Set Production Secrets

```powershell
# Google OAuth
npx wrangler secret put GOOGLE_CLIENT_ID
# Paste: 680401337114-8r3siih33ghtaot71kq0umm1d7mj9d54.apps.googleusercontent.com

npx wrangler secret put GOOGLE_CLIENT_SECRET
# Paste: [REDACTED_FOR_SECURITY]

# Gemini AI
npx wrangler secret put GEMINI_API_KEY
# Paste: [REDACTED_FOR_SECURITY]

# R2 Public URL
npx wrangler secret put PUBLIC_BUCKET_URL
# Paste: https://pub-xxxxx.r2.dev (from Step 2)
```

### Step 5: Run Production Migrations

```powershell
# Run migrations on REMOTE database
npx wrangler d1 execute DB --remote --command "CREATE TABLE IF NOT EXISTS profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL UNIQUE, full_name TEXT, role TEXT NOT NULL CHECK(role IN ('PATIENT', 'NURSE', 'DOCTOR', 'ADMIN')), sanc_id TEXT, phone_number TEXT, address TEXT, latitude REAL, longitude REAL, is_verified INTEGER DEFAULT 0, is_online INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, has_accepted_terms INTEGER DEFAULT 0, terms_accepted_at DATETIME, medical_history TEXT, allergies TEXT, current_medications TEXT); CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id); CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role); CREATE INDEX IF NOT EXISTS idx_profiles_location ON profiles(latitude, longitude);"

# Continue with all other tables (biometrics, appointments, etc.)
# Or use the run-all-migrations.ps1 script with --remote flag
```

### Step 6: Update Google OAuth Redirect URIs

1. Go to https://console.cloud.google.com/apis/credentials
2. Click your OAuth 2.0 Client ID
3. Add to "Authorized redirect URIs":
   ```
   https://ahava.YOUR-DOMAIN.workers.dev/auth/callback
   ```
4. Keep the localhost URI for development:
   ```
   http://localhost:5173/auth/callback
   ```
5. Click "SAVE"

### Step 7: Deploy to Production

```powershell
npm run build
npx wrangler deploy
```

You'll see output like:
```
Published ahava-healthcare (X.XX sec)
  https://ahava-healthcare.YOUR-SUBDOMAIN.workers.dev
```

### Step 8: Update APP_URL and Redeploy

1. Copy the deployed URL from Step 7
2. Update `wrangler.json`:
   ```json
   {
     "vars": {
       "APP_URL": "https://ahava-healthcare.YOUR-SUBDOMAIN.workers.dev"
     }
   }
   ```
3. Redeploy:
   ```powershell
   npx wrangler deploy
   ```

### Step 9: Verify Deployment

1. Visit your production URL
2. Test Google sign-in
3. Complete onboarding flow
4. Test key features:
   - Profile creation
   - Image upload (if R2 configured)
   - Diagnostic analysis
   - Panic button

## 🔒 Security Checklist

- [x] Rate limiting enabled
- [x] Audit logging enabled
- [x] Input validation with Zod
- [x] Session tokens with httpOnly cookies
- [x] CORS properly configured
- [ ] Custom domain with HTTPS (recommended)
- [ ] Aura API integration (when ready)

## 📊 Post-Deployment Monitoring

### Check Logs
```powershell
npx wrangler tail
```

### Check Database
```powershell
npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) as user_count FROM user"
```

### Check R2 Usage
```powershell
npx wrangler r2 bucket list
```

## 🐛 Troubleshooting

### OAuth Errors
- Verify redirect URIs in Google Console match exactly
- Check APP_URL in wrangler.json matches deployed URL
- Clear browser cookies and try fresh sign-in

### Database Errors
- Verify migrations ran on remote DB (use --remote flag)
- Check D1 bindings in wrangler.json

### R2 Errors
- Verify bucket exists: `npx wrangler r2 bucket list`
- Check public access is enabled
- Verify PUBLIC_BUCKET_URL secret is set

## 🎉 Success Metrics

Your deployment is successful when:
- ✅ Users can sign in with Google
- ✅ Onboarding flow completes
- ✅ Profile data saves to D1
- ✅ No console errors on homepage
- ✅ API endpoints respond correctly

## 📈 Next Steps (Post-Launch)

1. **Custom Domain**
   - Set up custom domain in Cloudflare
   - Update APP_URL and Google OAuth URIs
   - Enable HTTPS

2. **Aura API Integration**
   - Get production Aura API credentials
   - Test emergency alert flow
   - Configure webhook endpoints

3. **Monitoring & Analytics**
   - Set up Cloudflare Analytics
   - Configure error tracking
   - Monitor D1 query performance

4. **Compliance**
   - Review audit logs regularly
   - Set up automated backups for D1
   - Document data retention policies

## 🆘 Support

If you encounter issues during deployment:
1. Check the terminal logs for specific errors
2. Review the troubleshooting section above
3. Verify all environment variables are set correctly
4. Test locally first with `npm run dev`

---

**Current Build Status:**
- Bundle Size: 326 KB (client)
- Worker Size: 870 KB
- TypeScript: ✅ Passing
- Build: ✅ Successful
- Dry Run: ✅ Passed

**Ready for production deployment!** 🚀

