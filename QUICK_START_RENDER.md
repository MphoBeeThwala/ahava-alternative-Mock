# ⚡ Quick Start: Deploy to Render (Free & Paid Options)

## 🎯 Can You Deploy for Free?

**YES!** Render offers **free tier** with limitations:

### Free Tier Includes:
- ✅ **1 Free Web Service** (auto-sleeps after 15 mins inactivity)
- ✅ **1 Free PostgreSQL DB** (limited storage)
- ✅ **1 Free Redis** (limited storage)
- ❌ Multiple web services cost money ($7/month each starter plan)

### Paid Tier (Recommended for Production):
- **Starter Plans**: $7/month per service
- **PostgreSQL (starter)**: $7/month
- **Redis (starter)**: $7/month
- **Total**: ~$35-50/month for full stack

---

## 📋 Free Deployment Steps

### Step 1: Prepare GitHub
```bash
# Make sure all changes are committed
git add .
git commit -m "Configure for Render deployment"
git push origin main
```

### Step 2: Create Render Account
1. Go to [render.com](https://render.com)
2. Click **"Sign up"**
3. Select **"Sign up with GitHub"**
4. Authorize Render to access your repos

### Step 3: Deploy via Blueprint (1-Click)
1. Go to [Render Blueprints](https://render.com/blueprints)
2. Click **"New Blueprint"**
3. Select your `MphoBeeThwala/ahava-alternative-Mock` repo
4. Click **"Connect"**
5. Render will auto-detect your `render.yaml`
6. Click **"Apply Blueprint"**

### Step 4: Set Environment Variables
After Blueprint is applied, set these for each service:

**For `ahava-api` (Backend):**
```
NODE_ENV=production
PORT=10000
DATABASE_URL=<copy from PostgreSQL database created>
REDIS_URL=<copy from Redis created>
JWT_SECRET=your-secret-key-at-least-32-chars
ENCRYPTION_KEY=base64-encoded-32-byte-key
ENCRYPTION_IV_SALT=another-salt-value
PAYSTACK_SECRET_KEY=sk_live_your_actual_key
PAYSTACK_WEBHOOK_SECRET=whsec_your_webhook_secret
FRONTEND_URL=https://ahava-frontend.onrender.com
TIMEZONE=Africa/Johannesburg
```

**For `ahava-frontend` (Frontend):**
```
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://ahava-api.onrender.com
```

**For `ahava-worker` (Background Jobs):**
```
NODE_ENV=production
REDIS_URL=<copy from Redis>
```

### Step 5: Get Database URLs
1. Render Dashboard → **Databases**
2. Click **`ahava-postgres`** → Copy **External Database URL** → Add to `DATABASE_URL`
3. Click **`ahava-redis`** → Copy **Internal URL** → Add to `REDIS_URL`

### Step 6: Trigger Deployment
```bash
# Push any change to trigger deployment
git commit --allow-empty -m "Trigger Render deployment"
git push origin main
```

### Step 7: Monitor Deployment
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click on each service
3. Watch logs for errors
4. Wait for **"Live"** status (green)

### Step 8: Test
```bash
# Test API
curl https://ahava-api.onrender.com/health

# Visit Frontend
Open browser → https://ahava-frontend.onrender.com
```

---

## 💡 Free vs Paid Comparison

| Feature | Free | Starter ($7) | Pro ($25) |
|---------|------|--------------|-----------|
| **Web Service** | 1 (sleeps) | Unlimited | Unlimited |
| **Auto-sleep** | Yes ⚠️ | No ✅ | No ✅ |
| **CPU/RAM** | Limited | Standard | High |
| **Database** | 100MB PostgreSQL | 1GB PostgreSQL | 10GB+ |
| **Redis** | 25MB | 100MB | 1GB+ |
| **Uptime SLA** | None | 99.5% | 99.95% |
| **Cost/month** | Free | $7 | $25 |

---

## ⚠️ Important Notes for Free Tier

### Auto-Sleep Issue
- Free web services **sleep after 15 minutes of inactivity**
- First request after sleep takes **30-60 seconds** to respond
- **Fix**: Upgrade to Starter plan ($7/month) to disable sleep

### Database Storage Limits
- Free PostgreSQL: **100MB max** (may not be enough for production)
- Free Redis: **25MB max** (very limited)
- **Fix**: Use Starter plans ($7/month each) for reliable storage

### Performance
- Free services run on **shared hardware**
- May experience slowdowns during peak hours
- **Fix**: Use Starter/Pro plans for dedicated resources

---

## 🚀 Recommended Setup (Budget-Friendly)

**Cheapest Paid Option (~$28/month):**
```
Frontend (Starter):   $7/month   (next.js on Render)
API Backend (Starter): $7/month  (Express on Render)
PostgreSQL (Starter): $7/month   (Render managed)
Redis (Free):         Free       (use Free tier)
Total:                $21/month
```

**Better for Production (~$50/month):**
```
Frontend (Starter):   $7/month
API Backend (Starter): $7/month
PostgreSQL (Starter): $7/month
Redis (Starter):      $7/month
Total:                $28/month
```

---

## 🔧 Troubleshooting

### "Service keeps spinning" (building forever)
- **Cause**: Build process hanging
- **Fix**: Check logs, ensure `npm ci` works locally
- Run: `npm install` locally to verify

### "Database connection failed"
- **Cause**: Wrong `DATABASE_URL`
- **Fix**: Copy exact URL from Render dashboard
- Verify format: `postgresql://user:pass@host:5432/db`

### "CORS errors in browser console"
- **Cause**: Frontend can't reach API
- **Fix**: Set `NEXT_PUBLIC_API_URL=https://ahava-api.onrender.com`
- Verify backend CORS includes `https://ahava-frontend.onrender.com`

### "Free tier service sleeping"
- **Cause**: Service inactive > 15 mins
- **Fix**: Upgrade to Starter plan ($7)
- Or: Set up monitoring to ping service regularly

### "Prisma migrations failing"
- **Check**: Logs in Render dashboard
- **Fix**: Run manually in Render shell:
  ```bash
  npx prisma migrate deploy
  ```

---

## 📊 Next Steps

1. ✅ Deploy to Render (follow steps above)
2. ✅ Test `/health` endpoint
3. ✅ Test frontend UI
4. ✅ Monitor logs for errors
5. ⬜ Set up custom domain (optional)
6. ⬜ Configure email/Paystack webhooks
7. ⬜ Enable monitoring alerts

---

## 🆘 Still Need Help?

- **Render Docs**: https://render.com/docs
- **This Repo Guide**: See `RENDER_DEPLOYMENT_GUIDE.md`
- **Issues**: Create GitHub issue in this repo

---

**Happy deploying! 🚀**
