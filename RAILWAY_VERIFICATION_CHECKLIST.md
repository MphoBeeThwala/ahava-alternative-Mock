# Railway Production Verification Checklist

After you redeploy on Railway, use this checklist to verify all fixes are working.

## **Step 1: Railway Environment Variables** ✓
Update these in Railway Backend → Settings → Environment:

```
JWT_EXPIRES_IN=15m
ML_SERVICE_URL=http://ml-service:8000
REDIS_URL=rediss://default:<PASSWORD>@<HOST>:6379
NODE_ENV=production
```

**Make sure REDIS_URL has NO quotes around it**

## **Step 2: Trigger Redeploy**
- Go to Backend service → Deployments
- Click "Trigger Deploy" OR push a new commit to main
- Wait for deployment to complete (2-3 minutes)

## **Step 3: Verify Production Logs ARE CLEAN**

Open Railway → Backend → Logs and check:

### ❌ Should NOT see:
- `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`
- `Redis connection error`
- `ENOENT %20--tls`
- `multiple lockfiles`
- `ValidationError: The 'X-Forwarded-For' header`

### ✅ Should see:
- `Server running on http://0.0.0.0:4000`
- `Database connected`
- `Redis subscribed to jobs`
- Clean startup messages
- API requests returning `200`/`401`/`429` (not validation errors)

## **Step 4: Test Production Endpoint**

```bash
# Health check
curl https://backend-production-XXXX.up.railway.app/health

# Should return 200 with no errors
```

## **Step 5: Test Rate Limiter (no X-Forwarded-For errors)**

```bash
# Make 10 quick requests (should work fine)
for i in {1..10}; do 
  curl https://backend-production-XXXX.up.railway.app/api/patient/me \
    -H "Authorization: Bearer YOUR_TOKEN"
done

# Should see 200 responses, NOT validation errors in logs
```

## **Step 6: Test Authentication**

1. Visit frontend: `https://frontend-production-XXXX.up.railway.app`
2. Log in with: `patient_0001@mock.ahava.test` / `MockPatient1!`
3. Check browser DevTools → Network → Headers for Authorization token
4. **IMPORTANT**: Sit idle for 16+ minutes
5. Make another request (view patient page) - should work without logout
   - If it works: Token refresh happened silently ✅
   - If logged out: Token refresh failed ❌

## **Step 7: Test ML Early Warning (if available)**

1. After logging in, navigate to Early Warning feature
2. Check that risk scores display (Framingham, QRISK3, ML)
3. Verify no database errors in Railway logs

## **Expected Results Summary**

| Issue | Before Fix | After Fix |
|-------|-----------|-----------|
| X-Forwarded-For validation | ❌ ERR_ERL_UNEXPECTED_X_FORWARDED_FOR | ✅ No errors, proper IP extraction |
| Redis connection | ❌ ENOENT %20--tls error | ✅ Connected immediately |
| Lockfile warnings | ❌ Multiple lockfiles detected | ✅ No warnings |
| Token expiry | ✅ Expected (15min, then refresh) | ✅ Works as designed |
| Rate limiting | ⚠️ Warnings behind proxy | ✅ Clean, no warnings |

## **If Issues Persist**

### Still seeing X-Forwarded-For errors?
- Check rateLimiter.ts was deployed (should have keyGenerator function)
- Verify trust proxy is set in index.ts

### Still seeing Redis errors?
- Check REDIS_URL has no quotes
- Verify URL format: `rediss://default:PASSWORD@HOST:6379`
- Check connection string is correct in Railway console

### Lockfile warnings still present?
- Check next.config.ts has experimental config
- Clear Railway cache and redeploy

## **Log Inspection Command**

Share logs with this command (get last 50 lines):

```bash
# In Railway CLI:
railway logs --service backend --tail 50
```

Look for these patterns:
- `INFO: Server running` = ✅ Good
- `ERROR` or `ValidationError` = ❌ Check what happened
- `connected` = ✅ Database/Redis OK
- `subscription` = ✅ Job queue active

## **Success Criteria**

✅ ALL of these must be true:
1. Backend starts with NO validation errors
2. No X-Forwarded-For warnings in logs
3. Redis connects successfully on startup
4. Rate limiting works (no proxy validation errors)
5. Token refresh works (idle 16+ min, still logged in)
6. API requests return proper status codes (200/401/429)

---

**Next Steps**:
1. Update Railway environment variables
2. Trigger redeploy
3. Wait 2-3 minutes for deployment
4. Open Railway → Backend → Logs
5. Run through verification checklist above
6. Share logs here if any issues persist
