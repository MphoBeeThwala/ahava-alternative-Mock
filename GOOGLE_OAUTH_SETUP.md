# 🔑 Google OAuth Setup - Quick Guide

## Step 1: Create .dev.vars File (Development)

Create a file named `.dev.vars` in your project root (same folder as `package.json`).

**Copy this template and fill in your values:**

```bash
# Google OAuth (for Better Auth)
GOOGLE_CLIENT_ID=your_actual_client_id_here
GOOGLE_CLIENT_SECRET=your_actual_client_secret_here
APP_URL=http://localhost:5173

# Keep your existing keys (if you have them):
GEMINI_API_KEY=your_gemini_key_here
PUBLIC_BUCKET_URL=your_r2_url_here
VITE_AURA_API_URL=https://sandbox.aura.co.za/api/v1
VITE_AURA_API_KEY=your_aura_key_here
```

**Example (with real values):**
```bash
GOOGLE_CLIENT_ID=123456789-abcdefghijklmnop.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abcdefghijklmnopqrstuvwxyz
APP_URL=http://localhost:5173
```

---

## Step 2: Verify .dev.vars Location

Make sure `.dev.vars` is in the **root directory**:
```
Mocha build Ahava/
├── .dev.vars          ← HERE (same level as package.json)
├── package.json
├── src/
├── migrations/
└── ...
```

---

## Step 3: Verify Google OAuth Redirect URI

**IMPORTANT:** Make sure your Google OAuth app has this redirect URI configured:

1. Go to: https://console.cloud.google.com/apis/credentials
2. Click on your OAuth 2.0 Client ID
3. Under "Authorized redirect URIs", make sure you have:
   ```
   http://localhost:5173/api/auth/callback/google
   ```
4. If missing, click "ADD URI" and add it
5. Click "SAVE"

**For production later, also add:**
```
https://your-domain.com/api/auth/callback/google
```

---

## Step 4: Test Locally

```bash
# Start dev server
npm run dev

# Open browser
http://localhost:5173

# Click "Sign in with Google"
# Should redirect to Google OAuth
```

---

## Step 5: Set Production Secrets (When Deploying)

When you're ready to deploy to production:

```bash
# Set secrets in Cloudflare Workers
wrangler secret put GOOGLE_CLIENT_ID
# Paste your Client ID when prompted

wrangler secret put GOOGLE_CLIENT_SECRET
# Paste your Client Secret when prompted

# Verify secrets are set
wrangler secret list
```

---

## ✅ Quick Checklist

- [ ] Created `.dev.vars` file in project root
- [ ] Added `GOOGLE_CLIENT_ID` with your actual ID
- [ ] Added `GOOGLE_CLIENT_SECRET` with your actual secret
- [ ] Set `APP_URL=http://localhost:5173`
- [ ] Verified redirect URI in Google Console
- [ ] Tested login locally (`npm run dev`)
- [ ] (Later) Set production secrets with `wrangler secret put`

---

## 🔒 Security Notes

✅ **`.dev.vars` is already in `.gitignore`** - Your secrets won't be committed to git

✅ **Never commit secrets** - Always use environment variables

✅ **Different credentials for dev/prod** - Use different OAuth apps if possible

---

## 🆘 Troubleshooting

### "Invalid redirect URI" error
- Check Google Console → Authorized redirect URIs
- Must match exactly: `http://localhost:5173/api/auth/callback/google`

### "Client ID not found" error
- Check `.dev.vars` file exists
- Check variable names are correct (no typos)
- Restart dev server after creating `.dev.vars`

### "OAuth consent screen" error
- Go to Google Console → OAuth consent screen
- Make sure app is configured (even if in testing mode)

---

**That's it!** Once `.dev.vars` is set up, you're ready to test authentication! 🚀

