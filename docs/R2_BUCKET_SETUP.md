# R2 Bucket Setup Guide

## Overview
Ahava Healthcare uses Cloudflare R2 for medical image storage (X-rays, CT scans, photos, etc.)

## Step 1: Create R2 Bucket

```bash
# Login to Cloudflare
npx wrangler login

# Create the bucket
npx wrangler r2 bucket create ahava-medical-images

# Verify it was created
npx wrangler r2 bucket list
```

## Step 2: Configure Public Access

### Option A: Using R2 Custom Domain (Recommended)
1. Go to Cloudflare Dashboard → R2
2. Click on `ahava-medical-images` bucket
3. Go to "Settings" tab
4. Under "Public Access", click "Allow Access"
5. Click "Add Custom Domain"
6. Enter your domain (e.g., `images.ahava.health`)
7. Follow DNS setup instructions

**Result**: Images will be accessible at `https://images.ahava.health/filename.jpg`

### Option B: Using R2.dev Subdomain (Quick Setup)
1. Go to Cloudflare Dashboard → R2
2. Click on `ahava-medical-images` bucket
3. Go to "Settings" tab
4. Click "Allow Access" under "R2.dev subdomain"
5. Copy the generated URL (e.g., `https://pub-xxxxx.r2.dev`)

**Result**: Images will be accessible at `https://pub-xxxxx.r2.dev/filename.jpg`

## Step 3: Update Environment Variables

### For Local Development (.dev.vars)
```bash
# Add to .dev.vars
PUBLIC_BUCKET_URL=https://pub-xxxxx.r2.dev
# OR
PUBLIC_BUCKET_URL=https://images.ahava.health
```

### For Production (Cloudflare Dashboard)
1. Go to Cloudflare Dashboard → Workers & Pages
2. Select your worker
3. Go to "Settings" → "Variables and Secrets"
4. Add environment variable:
   - Name: `PUBLIC_BUCKET_URL`
   - Value: `https://pub-xxxxx.r2.dev` (or your custom domain)
5. Click "Save"

## Step 4: Update wrangler.json (Already Done)

The R2 bucket binding is already configured in `wrangler.json`:

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

## Step 5: Test the Configuration

### Test Upload Locally
```bash
# Start dev server
npm run dev

# In another terminal, test upload
curl -X POST http://localhost:5173/api/upload-image \
  -H "Cookie: ahava_auth_session=YOUR_SESSION_TOKEN" \
  -F "file=@test-image.jpg"

# Should return:
# {
#   "url": "https://pub-xxxxx.r2.dev/medical/user-id/timestamp-uuid.jpg",
#   "filename": "medical/user-id/timestamp-uuid.jpg",
#   "size": 12345,
#   "type": "image/jpeg"
# }
```

### Test Upload in Production
1. Deploy to production: `npx wrangler deploy`
2. Sign in to your app
3. Upload a test image through the UI
4. Verify the image loads correctly

## Security Considerations

### CORS Configuration
If you're using a custom domain, you may need to configure CORS:

1. Go to R2 bucket settings
2. Add CORS policy:
```json
[
  {
    "AllowedOrigins": ["https://your-worker-domain.workers.dev", "https://yourdomain.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

### Access Control
- Images are publicly accessible via URL (by design for viewing in browser)
- URLs contain UUIDs making them hard to guess
- Sensitive images should have additional access controls (future enhancement)

### EXIF Data Stripping (Future Enhancement)
Medical images may contain patient metadata in EXIF data. Consider:
1. Stripping EXIF data before upload (privacy)
2. Using image processing service (Cloudflare Images)
3. Implementing access controls for sensitive images

## Cost Estimation

### Cloudflare R2 Pricing
- **Storage**: $0.015 per GB per month
- **Class A Operations** (writes): $4.50 per million requests
- **Class B Operations** (reads): $0.36 per million requests

### Example Cost (1000 patients)
Assumptions:
- Average 10 images per patient
- Average image size: 2MB
- 10,000 total images = 20GB storage

**Monthly Cost:**
- Storage: 20GB × $0.015 = **$0.30/month**
- Writes: 10,000 uploads × $4.50/1M = **$0.05/month**
- Reads: 50,000 views × $0.36/1M = **$0.02/month**

**Total: ~$0.40/month** (very affordable!)

## Troubleshooting

### Error: "MEDICAL_IMAGES_BUCKET not configured"
- Verify bucket exists: `npx wrangler r2 bucket list`
- Check wrangler.json has correct binding
- Restart dev server after changes

### Error: "PUBLIC_BUCKET_URL not configured"
- Add PUBLIC_BUCKET_URL to .dev.vars (local)
- Add PUBLIC_BUCKET_URL to Cloudflare dashboard (production)

### Images not loading (404)
- Verify public access is enabled on R2 bucket
- Check URL in browser directly
- Verify CORS policy if using custom domain

### Upload fails with 500 error
- Check worker logs: `npx wrangler tail`
- Verify R2 bucket permissions
- Check file size and type are valid

## Production Checklist

- [ ] R2 bucket created
- [ ] Public access enabled (custom domain or R2.dev)
- [ ] PUBLIC_BUCKET_URL configured in production
- [ ] Test upload works
- [ ] Test image loads in browser
- [ ] CORS configured (if using custom domain)
- [ ] Monitor storage usage in Cloudflare dashboard
- [ ] Set up billing alerts

## Next Steps

After R2 is configured:
1. Test image upload in your app
2. Verify images display correctly
3. Monitor storage usage
4. Consider adding image optimization (Cloudflare Images)
5. Plan for EXIF stripping if handling sensitive images

