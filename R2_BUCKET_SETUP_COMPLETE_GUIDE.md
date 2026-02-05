# 🪣 R2 Bucket Setup - Complete Guide for ahava-vault

## ✅ Step 1: Bucket Created (You're Here!)

You've successfully created the bucket **"ahava-vault"**. Great job! 

Now let's configure it for public access so medical images can be viewed.

---

## 🔓 Step 2: Enable Public Access

### Why?
Medical images (X-rays, wound photos, etc.) need to be accessible via public URLs so they can be displayed in the app and analyzed by Gemini AI.

### How to Enable:

1. **Click on the "Settings" tab** (you're currently on "Objects" tab)
   - You should see tabs: Objects | Metrics | Settings

2. **Scroll down to "Public Access" section**
   - You'll see it currently says "Disabled"

3. **Click "Allow Access" or "Enable Public Access"**
   - Cloudflare will show a warning about public access
   - Confirm that you want to allow public access

4. **Configure Public Access Settings:**
   - **Option 1: Custom Domain (Recommended for Production)**
     - Connect a custom domain (e.g., `images.ahava.co.za`)
     - More professional
     - Better for SEO
     - **Skip this for now if you want to launch quickly**
   
   - **Option 2: Cloudflare R2.dev Domain (Quick Setup)**
     - Cloudflare provides a free public URL
     - Format: `https://pub-[random-id].r2.dev`
     - **Choose this option for now**

5. **Enable the R2.dev subdomain:**
   - Look for "R2.dev subdomain" section
   - Click "Allow Access" or toggle the switch to ON
   - Cloudflare will generate a public URL like:
     ```
     https://pub-1234567890abcdef.r2.dev
     ```

6. **Copy the Public URL**
   - You'll see something like: `https://pub-1234567890abcdef.r2.dev`
   - **COPY THIS URL** - you'll need it in the next steps

---

## 🔧 Step 3: Update Your Project Configuration

### 3.1 Update wrangler.json

Your `wrangler.json` currently has the old bucket name. Let's update it:

**Open:** `wrangler.json`

**Find this section:**
```json
{
  "r2_buckets": [
    {
      "binding": "MEDICAL_IMAGES_BUCKET",
      "bucket_name": "ahava-medical-images"
    }
  ]
}
```

**Change to:**
```json
{
  "r2_buckets": [
    {
      "binding": "MEDICAL_IMAGES_BUCKET",
      "bucket_name": "ahava-vault"
    }
  ]
}
```

**Save the file.**

---

### 3.2 Update .dev.vars (Local Development)

**Open:** `.dev.vars`

**Find this line:**
```bash
PUBLIC_BUCKET_URL=https://pub-xxxxxxxxxxxxx.r2.dev
```

**Replace with your actual public URL from Step 2.6:**
```bash
PUBLIC_BUCKET_URL=https://pub-1234567890abcdef.r2.dev
```
*(Use your actual URL from Cloudflare dashboard)*

**Save the file.**

---

### 3.3 Set Production Secret (For Deployment)

**Run this command in your terminal:**
```powershell
npx wrangler secret put PUBLIC_BUCKET_URL
```

**When prompted, paste your R2 public URL:**
```
https://pub-1234567890abcdef.r2.dev
```

**Press Enter to save.**

---

## 🧪 Step 4: Test the Setup Locally

### 4.1 Restart Your Dev Server

```powershell
# Stop the current dev server (Ctrl+C if running)

# Start it again
npm run dev
```

### 4.2 Test Image Upload

1. **Open:** `http://localhost:5173`
2. **Sign in** with Google
3. **Go to Patient Dashboard**
4. **Click "Request AI Diagnosis"**
5. **Upload a test image** (any image file)
6. **Submit symptoms**

### 4.3 Verify Upload Worked

**Check the Cloudflare Dashboard:**
1. Go back to R2 → ahava-vault
2. Click "Objects" tab
3. You should see your uploaded image listed
4. The image should have a public URL like:
   ```
   https://pub-1234567890abcdef.r2.dev/medical-images/[filename]
   ```

---

## 🔒 Step 5: Security Configuration (Optional but Recommended)

### CORS Settings

To prevent unauthorized uploads from other websites:

1. **In Cloudflare Dashboard:** R2 → ahava-vault → Settings
2. **Scroll to "CORS Policy"**
3. **Add CORS rules:**

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "https://ahava-healthcare.YOUR-DOMAIN.workers.dev"
    ],
    "AllowedMethods": ["GET", "PUT", "POST"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

**Replace** `YOUR-DOMAIN` with your actual Workers domain after deployment.

---

## 📊 Step 6: Verify Everything is Working

### Checklist:

- [ ] R2 bucket "ahava-vault" created ✅ (You've done this!)
- [ ] Public access enabled
- [ ] Public URL obtained (https://pub-xxxxx.r2.dev)
- [ ] wrangler.json updated with "ahava-vault"
- [ ] .dev.vars updated with public URL
- [ ] Production secret set with `npx wrangler secret put`
- [ ] Dev server restarted
- [ ] Test image upload successful
- [ ] Image visible in R2 dashboard
- [ ] Image accessible via public URL

---

## 🐛 Troubleshooting

### Issue 1: "Bucket not found" error

**Solution:**
```powershell
# Verify bucket exists
npx wrangler r2 bucket list

# Should show "ahava-vault" in the list
```

### Issue 2: "403 Forbidden" when accessing images

**Solution:**
- Check that public access is enabled
- Verify the R2.dev subdomain is active
- Check CORS settings

### Issue 3: Image upload fails with "R2 binding not found"

**Solution:**
1. Check `wrangler.json` has the correct binding:
   ```json
   "binding": "MEDICAL_IMAGES_BUCKET",
   "bucket_name": "ahava-vault"
   ```
2. Restart dev server: `npm run dev`

### Issue 4: Can't find the public URL

**Solution:**
1. Go to R2 → ahava-vault → Settings
2. Look for "Public Access" or "R2.dev subdomain" section
3. If not visible, public access might not be enabled yet
4. Click "Allow Access" first, then the URL will appear

---

## 💰 Cost & Limits

### Free Tier:
- **Storage:** 10 GB free per month
- **Class A Operations (uploads):** 1 million free per month
- **Class B Operations (downloads):** 10 million free per month

### For Ahava Platform:
- Average medical image: 1-5 MB
- **10 GB = ~2,000 to 10,000 images**
- More than enough for initial launch!

### Paid Pricing (if you exceed free tier):
- Storage: $0.015 per GB/month (~R0.25/GB)
- Very affordable even at scale

---

## 🎯 Quick Commands Reference

```powershell
# List all R2 buckets
npx wrangler r2 bucket list

# View bucket info
npx wrangler r2 bucket info ahava-vault

# Upload a test file (optional)
npx wrangler r2 object put ahava-vault/test.txt --file=test.txt

# List objects in bucket
npx wrangler r2 object list ahava-vault

# Set production secret
npx wrangler secret put PUBLIC_BUCKET_URL

# Deploy with new R2 config
npm run build
npx wrangler deploy
```

---

## 📝 Summary: What You Need to Do

### Right Now (5 minutes):

1. ✅ Bucket created (done!)
2. ⏳ **Enable public access** (Settings tab → Allow Access)
3. ⏳ **Copy public URL** (looks like `https://pub-xxxxx.r2.dev`)
4. ⏳ **Update wrangler.json** (change bucket name to "ahava-vault")
5. ⏳ **Update .dev.vars** (paste your public URL)
6. ⏳ **Restart dev server** (`npm run dev`)
7. ⏳ **Test upload** (try uploading an image in the app)

### Before Production Deployment:

8. ⏳ **Set production secret** (`npx wrangler secret put PUBLIC_BUCKET_URL`)
9. ⏳ **Configure CORS** (optional but recommended)
10. ⏳ **Deploy** (`npx wrangler deploy`)

---

## 🎉 Next Steps After Setup

Once R2 is working:
1. Test diagnostic analysis with images
2. Verify images display correctly in reports
3. Check doctor dashboard can view patient images
4. Monitor R2 usage in Cloudflare dashboard

---

**Need help with any step? Let me know which part you're stuck on!**

