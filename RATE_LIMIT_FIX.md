# 🔧 Rate Limit (429) Fix & Model Configuration

## Issues Identified

### 1. **429 Too Many Requests Error**
**Cause:** Hitting Gemini API rate limits (free tier: 15 requests/minute)

**Why it's happening:**
- Retry logic is working but may be exhausting quota
- Experimental models (`gemini-2.0-flash-exp`) may have stricter limits
- Multiple rapid requests from testing

### 2. **Model Configuration**
**Current:** Using `gemini-2.0-flash-exp` (experimental)
**Problem:** Experimental models may have stricter rate limits

**Solution:** Use stable `gemini-1.5-flash` as primary (better rate limits)

---

## Fixes Applied

### 1. **Changed Model Priority**
**Before:**
- Primary: `gemini-2.0-flash-exp` (experimental, strict limits)
- Fallback: `gemini-1.5-flash`

**After:**
- Primary: `gemini-1.5-flash` (stable, better rate limits)
- Fallback: `gemini-2.0-flash-exp` (if needed)
- Last resort: `gemini-1.5-pro`

**Why:** Stable models have more lenient rate limits and are more reliable.

### 2. **Improved Retry Delays for Rate Limits**
**Before:**
- All errors: 1s, 2s, 4s delays

**After:**
- **429 (Rate Limit):** 5s, 10s, 20s delays (longer waits)
- **Other errors:** 1s, 2s, 4s delays (faster retries)

**Why:** Rate limits need longer waits to reset, other errors can retry faster.

---

## About Gemini 3

**Question:** Are we using Gemini 3 as primary?

**Answer:** No, we're using:
- **Primary:** Gemini 1.5 Flash (stable)
- **Fallback:** Gemini 2.0 Flash Experimental
- **Last resort:** Gemini 1.5 Pro

**Note:** Gemini 3 models may not be available in the API yet, or may use different model names. The `gemini-2.0-flash-exp` might actually be Gemini 3 under the hood, but we can't verify without Google's documentation.

**Recommendation:** Stick with stable models (Gemini 1.5 Flash) for production to avoid rate limit issues.

---

## Rate Limit Strategy

### Current Limits (Free Tier):
- **15 requests per minute**
- **1,500 requests per day**

### How to Avoid 429 Errors:

1. **Use Stable Models:** `gemini-1.5-flash` has better limits
2. **Client-Side Cooldown:** 5-second cooldown prevents rapid requests
3. **Longer Retry Delays:** 5s, 10s, 20s for rate limits
4. **Monitor Usage:** Track requests to stay under limits

### If You Still Get 429:

1. **Wait 1 minute** before trying again
2. **Check your API quota** in Google AI Studio
3. **Consider upgrading** to paid tier if needed
4. **Reduce retry attempts** if hitting limits frequently

---

## Next Steps

1. **Test with stable model:** Should see fewer 429 errors
2. **Monitor logs:** Check which model is actually being used
3. **Adjust if needed:** Can switch back to 2.0 if 1.5 doesn't work well

---

## Summary

✅ **Changed to stable model** (Gemini 1.5 Flash) - better rate limits
✅ **Improved retry delays** for rate limits (5s, 10s, 20s)
✅ **Not using Gemini 3** - using stable Gemini 1.5/2.0

**The 429 errors should be reduced now!** 🎯

