# Deployment Guide - Ahava Healthcare Platform

Quick reference guide for deploying the Ahava Healthcare platform to production.

---

## Prerequisites

### Required Accounts
1. **Cloudflare Account** (Workers, D1, R2)
2. **Google Cloud Account** (for Gemini API)
3. **Mocha Platform Account** (for user authentication)

### Required Tools
```bash
node >= 18.0.0
npm >= 9.0.0
wrangler >= 4.33.0
```

---

## Step 1: Environment Configuration

### 1.1 Create `.dev.vars` for Development
```bash
# .dev.vars (DO NOT COMMIT TO GIT)
GEMINI_API_KEY=your_actual_gemini_api_key_here
MOCHA_USERS_SERVICE_API_URL=https://api.getmocha.com
MOCHA_USERS_SERVICE_API_KEY=your_mocha_api_key_here
PUBLIC_BUCKET_URL=https://your-r2-bucket.r2.dev
```

### 1.2 Set Production Secrets
```bash
# Set secrets in Cloudflare Workers (production)
wrangler secret put GEMINI_API_KEY
# Enter your actual Gemini API key when prompted

wrangler secret put MOCHA_USERS_SERVICE_API_KEY
# Enter your Mocha API key when prompted

wrangler secret put PUBLIC_BUCKET_URL
# Enter your R2 bucket public URL when prompted
```

### 1.3 Get API Keys

#### Google Gemini API Key
1. Go to https://ai.google.dev/
2. Click "Get API Key"
3. Create a new project or select existing
4. Enable "Gemini API"
5. Create API credentials
6. Copy API key

**Gemini Pricing** (as of Jan 2026):
- Gemini 2.5 Flash Text: $0.075 per 1M input tokens
- Gemini 2.5 Flash Vision: $0.15 per 1M input tokens
- Free tier: Limited requests per day

#### Mocha Users Service
1. Go to https://getmocha.com
2. Create account / login
3. Navigate to dashboard
4. Copy API key from settings

---

## Step 2: Cloudflare R2 Setup

### 2.1 Create R2 Bucket
```bash
# Create bucket via CLI
wrangler r2 bucket create medical-images-ahava

# Or via Cloudflare Dashboard:
# 1. Go to https://dash.cloudflare.com
# 2. Select R2 from sidebar
# 3. Click "Create bucket"
# 4. Name: medical-images-ahava
```

### 2.2 Configure Public Access
```bash
# Enable public access for the bucket
# Via Cloudflare Dashboard:
# 1. Go to your R2 bucket
# 2. Settings -> Public Access
# 3. Enable "Allow public access"
# 4. Copy public URL (e.g., https://pub-xxxxx.r2.dev)

# Update wrangler.json with your bucket name:
# "r2_buckets": [
#   {
#     "binding": "MEDICAL_IMAGES_BUCKET",
#     "bucket_name": "medical-images-ahava"
#   }
# ]
```

### 2.3 Set Bucket Binding
Edit `wrangler.json`:
```json
{
  "r2_buckets": [
    {
      "binding": "MEDICAL_IMAGES_BUCKET",
      "bucket_name": "medical-images-ahava"
    }
  ]
}
```

### 2.4 Configure CORS (if needed)
```bash
# Create cors.json
{
  "AllowedOrigins": ["https://your-domain.com"],
  "AllowedMethods": ["GET", "PUT"],
  "AllowedHeaders": ["*"],
  "MaxAgeSeconds": 3600
}

# Apply CORS policy
wrangler r2 bucket cors put medical-images-ahava --cors-file=cors.json
```

---

## Step 3: Database Migration

### 3.1 Verify Database Configuration
Check `wrangler.json`:
```json
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "019beed4-58f9-79ea-8acd-d59b2c121f81",
      "database_id": "019beed4-58f9-79ea-8acd-d59b2c121f81"
    }
  ]
}
```

### 3.2 Run Migrations
```bash
# Run all migrations in order
wrangler d1 execute DB --file=./migrations/1.sql
wrangler d1 execute DB --file=./migrations/2.sql
wrangler d1 execute DB --file=./migrations/3.sql
wrangler d1 execute DB --file=./migrations/4.sql
wrangler d1 execute DB --file=./migrations/5.sql
wrangler d1 execute DB --file=./migrations/6.sql
wrangler d1 execute DB --file=./migrations/7.sql
wrangler d1 execute DB --file=./migrations/8.sql
wrangler d1 execute DB --file=./migrations/9.sql

# Or run bash script
chmod +x scripts/migrate.sh
./scripts/migrate.sh
```

### 3.3 Verify Migrations
```bash
# List all tables
wrangler d1 execute DB --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"

# Should show:
# - appointments
# - biometrics
# - diagnostic_reports
# - health_alerts
# - panic_alerts
# - patient_baselines
# - profiles

# Check diagnostic_reports has new columns
wrangler d1 execute DB --command "PRAGMA table_info(diagnostic_reports)"

# Should include: image_urls, image_analysis, assigned_specialty, priority, etc.
```

---

## Step 4: Fix Critical Code Issues

### 4.1 Remove Placeholder R2 Code
Edit `src/worker/index.ts` around line 211:

**BEFORE:**
```typescript
const publicUrl = `${c.env.PUBLIC_BUCKET_URL || 'https://your-bucket-url.com'}/${filename}`;
return c.json({ 
  url: `https://placeholder-medical-images.com/${filename}`,
  warning: "R2 bucket not configured - using placeholder URL"
}, 200);
```

**AFTER:**
```typescript
if (!c.env.MEDICAL_IMAGES_BUCKET || !c.env.PUBLIC_BUCKET_URL) {
  return c.json({ error: "Image storage not configured" }, 500);
}

const publicUrl = `${c.env.PUBLIC_BUCKET_URL}/${filename}`;
return c.json({ url: publicUrl }, 200);
```

### 4.2 Add Rate Limiting (Recommended)
Install rate limiting package:
```bash
npm install --save @upstash/ratelimit @upstash/redis
```

Add to API endpoints:
```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// In critical endpoints
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "10 s"), // 10 requests per 10 seconds
});

app.post("/api/diagnostic-analysis", authMiddleware, async (c) => {
  const user = c.get("user");
  const { success } = await ratelimit.limit(user.id);
  if (!success) {
    return c.json({ error: "Too many requests" }, 429);
  }
  // ... rest of handler
});
```

---

## Step 5: Build & Test

### 5.1 Install Dependencies
```bash
npm install
```

### 5.2 Run Development Server
```bash
npm run dev
# Visit http://localhost:5173
```

### 5.3 Test Critical Workflows
- [ ] User registration (patient, nurse, doctor)
- [ ] Patient symptom submission (text only)
- [ ] Patient symptom submission with images
- [ ] Doctor reviewing and releasing report
- [ ] Image upload to R2
- [ ] Specialty routing accuracy
- [ ] Cost calculation
- [ ] Escalation request

### 5.4 Build Production Bundle
```bash
npm run build

# Verify build output
ls dist/
```

### 5.5 Dry Run Deployment
```bash
npm run check
# or
wrangler deploy --dry-run
```

---

## Step 6: Deploy to Production

### 6.1 Deploy Workers
```bash
wrangler deploy
```

Output should show:
```
✨ Built successfully!
🌍 Deploying to Cloudflare Workers...
✅ Deployed successfully!
🔗 https://019beed4-58f9-79ea-8acd-d59b2c121f81.workers.dev
```

### 6.2 Configure Custom Domain (Optional)
```bash
# Via Cloudflare Dashboard:
# 1. Go to Workers & Pages
# 2. Select your worker
# 3. Settings -> Domains & Routes
# 4. Add custom domain (e.g., app.ahavahealthcare.com)
# 5. DNS records auto-configured
```

### 6.3 Verify Deployment
```bash
# Test health endpoint (create one first - see Monitoring section)
curl https://your-worker-url.workers.dev/api/health

# Test authentication
curl https://your-worker-url.workers.dev/api/users/me
# Should return 401 Unauthorized

# Check Cloudflare Dashboard
# - Workers & Pages -> Your Worker
# - View logs and metrics
```

---

## Step 7: Post-Deployment Verification

### 7.1 Create Test Accounts
1. Register as Patient
2. Register as Doctor  
3. Register as Nurse
4. Admin: Create admin account via database

```bash
# Create admin user (replace with real user_id from Mocha)
wrangler d1 execute DB --command "
INSERT INTO profiles (user_id, full_name, role, is_verified) 
VALUES ('admin-user-id-here', 'Admin User', 'ADMIN', 1)
"
```

### 7.2 Test End-to-End Workflow
1. **Patient submits symptoms with image**
   - Upload test image (dermato photo)
   - Describe symptoms
   - Submit for analysis
   - Verify AI response
   - Check specialty routing

2. **Doctor reviews report**
   - Login as doctor
   - View pending reports
   - Add diagnosis and notes
   - Release to patient

3. **Patient views report**
   - Login as patient
   - Navigate to Diagnostic Vault
   - View released report

### 7.3 Verify Image Storage
```bash
# List objects in R2 bucket
wrangler r2 object list medical-images-ahava

# Should show uploaded images
# medical-images/{user_id}/{timestamp}-{random}.jpg
```

### 7.4 Monitor for 24 Hours
- Check Cloudflare Workers metrics
- Monitor error rates
- Check AI API usage (Gemini dashboard)
- Verify costs are as expected
- Watch for any failed requests

---

## Step 8: Monitoring & Maintenance

### 8.1 Set Up Monitoring
```bash
# Cloudflare Workers Analytics
# Dashboard -> Workers & Pages -> Your Worker -> Metrics

# Key Metrics to Watch:
# - Request count
# - Error rate (< 1% target)
# - Response time (< 1s target)
# - CPU usage
```

### 8.2 Set Up Alerts
Via Cloudflare Dashboard:
1. Go to Notifications
2. Create alert for:
   - Error rate spike (> 5%)
   - Request volume spike
   - Worker health check failure

### 8.3 Cost Monitoring
- **Cloudflare**: Dashboard -> Billing
- **Gemini API**: Google Cloud Console -> Billing
- **Mocha**: Platform dashboard

Set spending alerts!

### 8.4 Database Backups
```bash
# Export database (regularly)
wrangler d1 export DB --output=backup-$(date +%Y%m%d).sql

# Schedule via cron
# 0 2 * * * cd /path/to/project && wrangler d1 export DB --output=backup-$(date +\%Y\%m\%d).sql
```

---

## Step 9: Rollback Procedures

### If Deployment Fails
```bash
# Rollback to previous version
wrangler rollback

# Or deploy specific version
wrangler versions deploy <version-id>
```

### If Database Migration Fails
```bash
# Rollback migration (use down.sql files)
wrangler d1 execute DB --file=./migrations/9/down.sql
wrangler d1 execute DB --file=./migrations/8/down.sql
# etc.
```

### Emergency Procedures
1. **Workers Down**: Check Cloudflare status page
2. **Database Corruption**: Restore from backup
3. **AI Service Down**: Queue requests or show maintenance page
4. **R2 Issues**: Check bucket permissions and status

---

## Step 10: Security Hardening

### 10.1 Add Audit Logging
Create migration 10 (or add to 9):
```sql
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
```

### 10.2 Configure Security Headers
Add to worker response:
```typescript
app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('X-Frame-Options', 'DENY');
  c.res.headers.set('X-XSS-Protection', '1; mode=block');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});
```

### 10.3 Enable HTTPS Only
Cloudflare automatically handles HTTPS. Verify:
- SSL/TLS mode: Full (strict)
- Always Use HTTPS: On
- Minimum TLS Version: 1.2

---

## Troubleshooting

### Common Issues

#### "GEMINI_API_KEY not found"
```bash
# Verify secret is set
wrangler secret list

# If missing, set it
wrangler secret put GEMINI_API_KEY
```

#### "R2 bucket not found"
Check `wrangler.json`:
- Binding name matches code (`MEDICAL_IMAGES_BUCKET`)
- Bucket name is correct
- Bucket exists in R2 dashboard

#### "Database table not found"
```bash
# Run migrations again
wrangler d1 execute DB --file=./migrations/1.sql
# ... through 9.sql
```

#### "401 Unauthorized" on all endpoints
- Verify Mocha Users Service credentials
- Check session cookie is being set
- Test OAuth flow from beginning

#### Images not uploading
- Check R2 bucket permissions
- Verify PUBLIC_BUCKET_URL is set
- Check CORS configuration
- Verify file size limits (10MB max)

---

## Performance Optimization

### After Stable Operation

1. **Enable Caching**
   ```typescript
   // Cache AI responses for identical symptoms
   const cacheKey = hashSymptoms(symptoms);
   const cached = await c.env.CACHE.get(cacheKey);
   if (cached) return JSON.parse(cached);
   ```

2. **Image Optimization**
   ```bash
   # Use Cloudflare Images (transforms on-the-fly)
   # Replace R2 with Cloudflare Images service
   ```

3. **Database Optimization**
   ```sql
   -- Add composite indexes for common queries
   CREATE INDEX idx_reports_patient_released 
   ON diagnostic_reports(patient_id, is_released);
   ```

4. **Code Splitting**
   - Already handled by Vite
   - Consider lazy loading heavy components

---

## Maintenance Schedule

### Daily
- Check error logs
- Monitor request volume
- Verify AI API quota

### Weekly  
- Review user feedback
- Check cost metrics
- Security log review
- Performance metrics

### Monthly
- Database backup verification
- Dependency updates
- Security patches
- Cost optimization review

### Quarterly
- Full security audit
- Performance review
- User satisfaction survey
- Roadmap planning

---

## Support Contacts

### Technical Issues
- **Cloudflare**: https://dash.cloudflare.com/support
- **Google Gemini**: https://ai.google.dev/support
- **Mocha Platform**: https://getmocha.com/support

### Documentation
- Platform docs: `docs/AI_DIAGNOSIS_SYSTEM.md`
- Readiness assessment: `docs/PRODUCTION_READINESS_ASSESSMENT.md`
- Healthcare guide: `docs/HEALTHCARE_WORKER_GUIDE.md`

---

## Success Criteria

Deployment is successful when:
- ✅ All API endpoints responding (< 500ms)
- ✅ Error rate < 1%
- ✅ AI analysis generating valid responses
- ✅ Images uploading to R2 successfully
- ✅ Healthcare workers can review reports
- ✅ Patients can view released reports
- ✅ Costs within budget
- ✅ No security vulnerabilities detected
- ✅ 24-hour stable operation

---

**Deployment prepared by:** Development Team  
**Last updated:** January 2026  
**Version:** 1.0.0

**Ready to deploy? Follow this guide step-by-step and verify each section before proceeding to the next.**

