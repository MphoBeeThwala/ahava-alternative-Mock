# 🚀 Quick Start Checklist - Ahava Healthcare Platform

## ✅ Before You Begin

- [ ] Node.js 18+ installed (`node --version`)
- [ ] npm 9+ installed (`npm --version`)
- [ ] Wrangler CLI installed (`wrangler --version`)
- [ ] Cloudflare account created
- [ ] Google Cloud account (for Gemini API)
- [ ] Mocha platform account

---

## 📋 Required API Keys

### 1️⃣ Google Gemini API Key
- [ ] Go to https://ai.google.dev/
- [ ] Create/select project
- [ ] Enable Gemini API
- [ ] Create API credentials
- [ ] Copy API key
- **Status**: ❌ **CRITICAL - Required for AI analysis**

### 2️⃣ Mocha Users Service
- [ ] Go to https://getmocha.com
- [ ] Login/create account
- [ ] Navigate to dashboard
- [ ] Copy API key from settings
- **Status**: ❌ **CRITICAL - Required for authentication**

### 3️⃣ Cloudflare R2 Bucket
- [ ] Create bucket: `wrangler r2 bucket create medical-images-ahava`
- [ ] Enable public access in R2 dashboard
- [ ] Copy public URL (e.g., https://pub-xxxxx.r2.dev)
- [ ] Update `wrangler.json` with bucket name
- **Status**: ❌ **CRITICAL - Required for image uploads**

---

## ⚙️ Configuration Steps

### Step 1: Environment Setup
- [ ] Clone repository
- [ ] Run `npm install`
- [ ] Copy `.env.example` to `.dev.vars`
- [ ] Fill in all API keys in `.dev.vars`
- [ ] Verify `.dev.vars` is in `.gitignore`

### Step 2: Database Setup
Run migrations in order:
- [ ] `wrangler d1 execute DB --file=./migrations/1.sql`
- [ ] `wrangler d1 execute DB --file=./migrations/2.sql`
- [ ] `wrangler d1 execute DB --file=./migrations/3.sql`
- [ ] `wrangler d1 execute DB --file=./migrations/4.sql`
- [ ] `wrangler d1 execute DB --file=./migrations/5.sql`
- [ ] `wrangler d1 execute DB --file=./migrations/6.sql`
- [ ] `wrangler d1 execute DB --file=./migrations/7.sql`
- [ ] `wrangler d1 execute DB --file=./migrations/8.sql`
- [ ] `wrangler d1 execute DB --file=./migrations/9.sql` ⭐ **NEW**
- [ ] Verify: `wrangler d1 execute DB --command "SELECT name FROM sqlite_master WHERE type='table'"`

### Step 3: Code Fixes (CRITICAL)
- [ ] Edit `src/worker/index.ts` line 211-218
- [ ] Remove placeholder R2 URL code
- [ ] Replace with proper error handling
- [ ] Verify `c.env.PUBLIC_BUCKET_URL` is used

**Current code** (MUST CHANGE):
```typescript
const publicUrl = `${c.env.PUBLIC_BUCKET_URL || 'https://your-bucket-url.com'}/${filename}`;
return c.json({ 
  url: `https://placeholder-medical-images.com/${filename}`,
  warning: "R2 bucket not configured - using placeholder URL"
}, 200);
```

**Replace with**:
```typescript
if (!c.env.MEDICAL_IMAGES_BUCKET || !c.env.PUBLIC_BUCKET_URL) {
  return c.json({ error: "Image storage not configured" }, 500);
}
const publicUrl = `${c.env.PUBLIC_BUCKET_URL}/${filename}`;
return c.json({ url: publicUrl }, 200);
```

---

## 🧪 Testing

### Local Development
- [ ] Run `npm run dev`
- [ ] Open http://localhost:5173
- [ ] Test user registration
- [ ] Test symptom submission (text only)
- [ ] Test symptom submission with image
- [ ] Verify AI analysis works
- [ ] Check image uploads to R2
- [ ] Test doctor review workflow

### Pre-Production Testing
- [ ] Run `npm run build`
- [ ] Run `npm run check` (dry-run deployment)
- [ ] Test with real medical images
- [ ] Verify specialty routing accuracy
- [ ] Test cost calculations
- [ ] Test escalation workflow
- [ ] Load test (simulate 50+ users)

---

## 🚀 Deployment

### Production Secrets
Set secrets in Cloudflare:
- [ ] `wrangler secret put GEMINI_API_KEY`
- [ ] `wrangler secret put MOCHA_USERS_SERVICE_API_KEY`
- [ ] `wrangler secret put PUBLIC_BUCKET_URL`
- [ ] Verify: `wrangler secret list`

### Deploy
- [ ] `wrangler deploy`
- [ ] Verify deployment URL works
- [ ] Test authentication flow
- [ ] Submit test diagnostic analysis
- [ ] Check Cloudflare Workers metrics
- [ ] Monitor for 24 hours

### Custom Domain (Optional)
- [ ] Cloudflare Dashboard → Workers & Pages
- [ ] Select your worker
- [ ] Settings → Domains & Routes
- [ ] Add custom domain
- [ ] Verify DNS propagation

---

## 🔒 Security Checklist

### Must Do Before Production
- [ ] Remove all placeholder/fallback code
- [ ] Add audit logging table (see docs)
- [ ] Implement rate limiting
- [ ] Strip EXIF data from uploaded images
- [ ] Configure security headers
- [ ] Review error messages (no sensitive data leaked)
- [ ] Test authentication thoroughly
- [ ] Verify patients can only see their own data

### Compliance (HIPAA/POPIA)
- [ ] Sign BAA with Cloudflare
- [ ] Sign BAA with Google (Gemini)
- [ ] Create privacy policy
- [ ] Create terms of service
- [ ] Document data retention policy
- [ ] Create incident response plan
- [ ] Set up audit logging

---

## 📊 Monitoring

### Set Up Alerts
- [ ] Cloudflare error rate alert (>5%)
- [ ] Request volume spike alert
- [ ] Cost alert (set budget limit)
- [ ] Worker health check failure alert

### Regular Monitoring
- [ ] Cloudflare Workers metrics
- [ ] Gemini API usage and quota
- [ ] R2 storage usage
- [ ] Database size and performance
- [ ] User feedback and error reports

---

## 📚 Documentation Read

- [ ] `README.md` - Project overview
- [ ] `docs/AI_DIAGNOSIS_SYSTEM.md` - Technical documentation
- [ ] `docs/PRODUCTION_READINESS_ASSESSMENT.md` - **READ THIS FIRST**
- [ ] `docs/DEPLOYMENT_GUIDE.md` - Step-by-step deployment
- [ ] `docs/HEALTHCARE_WORKER_GUIDE.md` - For doctors/nurses

---

## ⚠️ Known Issues to Fix

### High Priority (Before Production)
- [ ] **R2 Placeholder Code** - Remove fallback URLs
- [ ] **Audit Logging** - Add PHI access tracking
- [ ] **Rate Limiting** - Prevent API abuse
- [ ] **EXIF Stripping** - Remove metadata from images
- [ ] **Input Validation** - Enforce Zod schemas on all endpoints

### Medium Priority (Within 1 Month)
- [ ] Add pagination to list endpoints
- [ ] Parallel image uploads (performance)
- [ ] Replace console.error with proper logging
- [ ] Add comprehensive test suite
- [ ] Cache AI responses for identical queries

---

## 💰 Cost Estimates

### Monthly (1000 active patients)
- **Cloudflare Workers**: $5-10
- **D1 Database**: $5-10
- **R2 Storage**: $5-10
- **Gemini AI**: $20-30
- **Mocha Users**: $10-50
- **Total**: ~$50-110/month

### Set Spending Alerts
- [ ] Cloudflare billing alerts
- [ ] Google Cloud billing alerts
- [ ] Mocha platform alerts

---

## 🎯 Success Criteria

Deployment is successful when:
- ✅ All API keys configured (no placeholders)
- ✅ All 9 database migrations applied
- ✅ R2 bucket properly configured
- ✅ AI analysis generating valid responses
- ✅ Images uploading successfully
- ✅ Error rate < 1%
- ✅ Response time < 1s
- ✅ 24-hour stable operation
- ✅ Security vulnerabilities addressed
- ✅ Costs within budget

---

## 🆘 Need Help?

### Technical Support
- **Cloudflare**: https://dash.cloudflare.com/support
- **Google Gemini**: https://ai.google.dev/support
- **Mocha**: https://getmocha.com/support

### Documentation
- Technical questions → `docs/AI_DIAGNOSIS_SYSTEM.md`
- Deployment issues → `docs/DEPLOYMENT_GUIDE.md`
- Production readiness → `docs/PRODUCTION_READINESS_ASSESSMENT.md`
- Healthcare workers → `docs/HEALTHCARE_WORKER_GUIDE.md`

### Common Issues
1. **"GEMINI_API_KEY not found"** → Run `wrangler secret put GEMINI_API_KEY`
2. **"R2 bucket not found"** → Check `wrangler.json` and bucket name
3. **"Table not found"** → Run database migrations
4. **"401 Unauthorized"** → Check Mocha credentials
5. **Images not uploading** → Verify R2 permissions and PUBLIC_BUCKET_URL

---

## 🎓 Getting Started Workflow

**If this is your first time:**

1. ✅ Check all boxes in "Before You Begin"
2. 📋 Get all 3 required API keys
3. ⚙️ Complete Configuration Steps 1-3
4. 🧪 Test locally
5. 🔒 Review Security Checklist
6. 🚀 Deploy to production
7. 📊 Set up monitoring
8. 🎉 Start onboarding users!

**Estimated Time:**
- With API keys ready: 2-3 hours
- Without API keys: 1 day (waiting for approvals)

---

## ✅ Final Pre-Launch Checklist

Before announcing to users:
- [ ] All critical issues fixed (see Production Readiness Assessment)
- [ ] 24-hour stable operation verified
- [ ] Test accounts created (patient, doctor, nurse, admin)
- [ ] End-to-end workflow tested
- [ ] Monitoring and alerts configured
- [ ] Rollback procedure tested
- [ ] On-call rotation established
- [ ] User documentation prepared
- [ ] Terms of service accepted by all users
- [ ] Incident response plan documented

---

**Platform Status**: ⚠️ **75% Production Ready**

**Critical Gap**: Missing real API keys and R2 configuration

**Recommendation**: Complete configuration steps above, then proceed to controlled pilot with 10-20 users. Full launch after 2-4 weeks of stable operation.

**Questions?** Review `docs/PRODUCTION_READINESS_ASSESSMENT.md` for comprehensive analysis.

---

**Last Updated**: January 25, 2026  
**Version**: 1.0.0

