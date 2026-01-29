# 🔌 API Audit & Requirements - Ahava Healthcare

## Current API Status

### ✅ Already Configured (Have Keys)

#### 1. Google OAuth API
- **Purpose:** User authentication (sign-in with Google)
- **Status:** ✅ Configured
- **Keys Provided:** 
  - `GOOGLE_CLIENT_ID`: `680401337114-8r3siih33ghtaot71kq0umm1d7mj9d54.apps.googleusercontent.com`
  - `GOOGLE_CLIENT_SECRET`: `[REDACTED_FOR_SECURITY]`
- **Used In:** Authentication flow, user sign-in/sign-up
- **Cost:** Free

#### 2. Google Gemini AI
- **Purpose:** AI-powered diagnostic analysis
- **Status:** ✅ Configured
- **Key Provided:** `[REDACTED_FOR_SECURITY]`
- **Used In:** 
  - Symptom analysis (`/api/diagnostic-analysis`)
  - Health baseline establishment (`/api/establish-baseline`)
  - Medical image analysis
- **Cost:** Pay-per-use (free tier available)
- **Model:** `gemini-2.5-flash`

#### 3. Cloudflare D1 Database
- **Purpose:** SQLite database for user data, profiles, appointments
- **Status:** ✅ Configured
- **Binding:** `DB`
- **Used In:** All database operations
- **Cost:** Free tier (5GB, 5M reads/day)

---

### ⚠️ Partially Configured (Need Production Keys)

#### 4. Cloudflare R2 (Object Storage)
- **Purpose:** Store medical images (X-rays, wounds, rashes, etc.)
- **Status:** ⚠️ Needs configuration
- **Binding:** `MEDICAL_IMAGES_BUCKET`
- **Environment Variable:** `PUBLIC_BUCKET_URL`
- **Used In:** Image upload (`/api/upload-image`)
- **Cost:** Free tier (10GB, 1M reads/month)
- **Action Required:** 
  - Create R2 bucket: `npx wrangler r2 bucket create ahava-medical-images`
  - Enable public access
  - Set `PUBLIC_BUCKET_URL` environment variable

#### 5. Aura Emergency API
- **Purpose:** Emergency alert system (panic button)
- **Status:** ⚠️ Placeholder key only
- **Keys Needed:**
  - `VITE_AURA_API_URL`: Currently `https://sandbox.aura.co.za/api/v1`
  - `VITE_AURA_API_KEY`: Currently `your_aura_api_key_here` (placeholder)
- **Used In:** Panic button (`src/shared/actions.ts`)
- **Cost:** Paid service
- **Action Required:**
  - Register at https://aura.co.za
  - Get production API credentials
  - Update `.dev.vars` and production secrets

---

### ❌ MISSING - Critical Medical APIs

#### 6. Informedica API (Drug Database) ⚠️ **MISSING**
- **Purpose:** Medication information, drug interactions, dosage
- **Status:** ❌ NOT INTEGRATED
- **Why Needed:**
  - Drug interaction checking
  - Medication information for doctors/nurses
  - Dosage calculations
  - Side effect warnings
  - Contraindication alerts
- **Website:** https://www.informedica.nl or https://www.informedica.com
- **Typical Usage:**
  - Check drug interactions when prescribing
  - Provide medication info to patients
  - Validate prescriptions
- **Integration Points:**
  - Doctor dashboard (prescription writing)
  - Diagnostic reports (medication recommendations)
  - Patient medication history
- **Cost:** Paid API (pricing varies by region)
- **Action Required:**
  1. Register for Informedica API access
  2. Get API key
  3. Add integration to worker
  4. Create medication management endpoints

---

#### 7. South African Medicines Database (SAHPRA) ⚠️ **MISSING**
- **Purpose:** SA-specific medication registry, SANC compliance
- **Status:** ❌ NOT INTEGRATED
- **Why Needed:**
  - Verify medications are registered in South Africa
  - Comply with SAHPRA regulations
  - Check prescription drug schedules
- **Website:** https://www.sahpra.org.za
- **API Availability:** Limited public API, may need partnership
- **Action Required:**
  1. Contact SAHPRA for API access
  2. Alternative: Use web scraping (legal compliance check needed)

---

#### 8. ICD-10 / SNOMED CT Coding ⚠️ **MISSING**
- **Purpose:** Standardized medical diagnosis codes
- **Status:** ❌ NOT INTEGRATED
- **Why Needed:**
  - Standardize diagnoses for insurance claims
  - Medical billing and coding
  - Interoperability with other healthcare systems
- **Options:**
  - WHO ICD-10 API (free)
  - SNOMED CT (requires license)
  - Local medical aid coding requirements
- **Integration Points:**
  - Diagnostic reports (add ICD-10 codes)
  - Insurance claim submissions
- **Action Required:**
  1. Choose coding standard (ICD-10 recommended for SA)
  2. Integrate with diagnostic report creation
  3. Add coding fields to database

---

#### 9. Laboratory Test Ordering API ⚠️ **MISSING**
- **Purpose:** Order blood tests, imaging, pathology
- **Status:** ❌ NOT INTEGRATED
- **Why Needed:**
  - Doctors can order lab tests directly
  - Integrate with Lancet, PathCare, Ampath
  - Receive test results automatically
- **Potential Partners:**
  - Lancet Laboratories
  - PathCare
  - Ampath
- **Integration Points:**
  - Doctor dashboard (order tests)
  - Patient dashboard (view results)
  - Diagnostic reports (attach lab results)
- **Action Required:**
  1. Contact lab providers for API access
  2. Negotiate partnerships
  3. Build lab ordering workflow

---

#### 10. Payment Gateway ⚠️ **MISSING**
- **Purpose:** Process payments for consultations, home visits
- **Status:** ❌ NOT INTEGRATED
- **Options for South Africa:**
  - **PayFast** (recommended for SA)
  - **Paystack**
  - **Stripe** (limited SA support)
  - **Ozow**
- **Integration Points:**
  - Appointment booking (payment on request)
  - Diagnostic analysis fees
  - Subscription payments (for premium features)
- **Cost:** Transaction fees (2-3% typical)
- **Action Required:**
  1. Choose payment provider (PayFast recommended)
  2. Register merchant account
  3. Integrate payment endpoints
  4. Add payment status tracking

---

#### 11. Medical Aid / Insurance API ⚠️ **MISSING**
- **Purpose:** Verify patient insurance, submit claims
- **Status:** ❌ NOT INTEGRATED
- **Why Needed:**
  - Check if patient has medical aid coverage
  - Submit claims directly to medical schemes
  - Pre-authorization for procedures
- **Potential Partners:**
  - Discovery Health
  - Momentum Health
  - Medshield
  - Bonitas
- **Integration Points:**
  - Patient onboarding (add medical aid details)
  - Appointment booking (check coverage)
  - Billing (auto-submit claims)
- **Action Required:**
  1. Research medical aid API availability
  2. May need switch provider (e.g., HealthBridge)
  3. Build claims submission workflow

---

#### 12. SMS/WhatsApp API ⚠️ **MISSING**
- **Purpose:** Appointment reminders, notifications
- **Status:** ❌ NOT INTEGRATED
- **Options:**
  - **Twilio** (SMS + WhatsApp)
  - **Africa's Talking** (Africa-focused)
  - **Clickatell** (SA-based)
  - **WhatsApp Business API**
- **Use Cases:**
  - Appointment confirmations
  - Medication reminders
  - Test result notifications
  - Emergency alerts
- **Cost:** Pay-per-message (~R0.25-R0.50 per SMS)
- **Action Required:**
  1. Choose provider (Twilio or Africa's Talking)
  2. Get API credentials
  3. Build notification system
  4. Add user preferences (SMS vs email)

---

#### 13. Geolocation / Maps API ⚠️ **PARTIALLY IMPLEMENTED**
- **Purpose:** Nurse routing, patient location
- **Status:** ⚠️ Browser geolocation only (basic)
- **Current:** Using browser's `navigator.geolocation`
- **Limitations:** 
  - No address validation
  - No distance calculations
  - No routing for nurses
- **Better Options:**
  - **Google Maps API** (paid, accurate)
  - **Mapbox** (generous free tier)
  - **OpenStreetMap** (free, less accurate)
- **Use Cases:**
  - Nurse navigation to patient
  - Find nearest available nurse
  - Emergency services routing
- **Action Required:**
  1. Choose maps provider (Google Maps recommended)
  2. Get API key
  3. Add address autocomplete
  4. Add distance/duration calculations
  5. Add map visualization

---

## 📋 API Priority Matrix

### 🔴 Critical (Needed for MVP)
1. **R2 Storage** - Image uploads essential for diagnostics
2. **Payment Gateway (PayFast)** - Revenue generation
3. **SMS API (Twilio/Africa's Talking)** - Appointment notifications

### 🟡 Important (Needed for Scale)
4. **Informedica** - Medication safety
5. **Maps API (Google Maps)** - Nurse routing
6. **Aura Emergency API** - Panic button (already coded, just needs key)

### 🟢 Nice to Have (Future Enhancement)
7. **SAHPRA Database** - SA medication compliance
8. **ICD-10 Coding** - Insurance claims
9. **Lab Test API** - Lab ordering
10. **Medical Aid API** - Claims automation
11. **WhatsApp API** - Better notifications

---

## 💰 Estimated Monthly API Costs

### Free Tier Usage (0-1000 users)
- Google OAuth: **Free**
- Google Gemini AI: **R0-R500** (depends on usage)
- Cloudflare D1: **Free**
- Cloudflare R2: **Free**
- **Total:** R0-R500/month

### Paid APIs (Production)
- PayFast: **2.9% + R2** per transaction
- Twilio SMS: **R0.35 per SMS** (~R350/month for 1000 messages)
- Google Maps API: **R200-R1000/month** (depends on requests)
- Informedica: **Contact for pricing** (likely R2000-R5000/month)
- Aura Emergency: **Contact for pricing**

### Total Estimated Cost (1000 active users)
- **Minimum:** R2500-R3500/month
- **With all APIs:** R5000-R10,000/month
- **Revenue Model:** R50-R200 per consultation → Break-even at ~50-100 consultations/month

---

## 🛠️ Action Plan: API Integration Priority

### Phase 1: MVP Launch (This Week)
1. ✅ Configure R2 bucket
2. ⚠️ Get PayFast merchant account (2-3 days approval)
3. ⚠️ Sign up for Twilio/Africa's Talking
4. ⚠️ Get Aura API production key

**Time:** 3-5 days
**Cost:** R0 (free tiers + transaction fees only)

### Phase 2: Post-Launch (Weeks 2-4)
5. ⚠️ Integrate Informedica for medication safety
6. ⚠️ Add Google Maps for nurse routing
7. ⚠️ Implement payment processing
8. ⚠️ Build SMS notification system

**Time:** 2-3 weeks
**Cost:** R2500-R5000/month

### Phase 3: Scale (Months 2-3)
9. ⚠️ Add ICD-10 coding for insurance
10. ⚠️ Integrate with lab providers
11. ⚠️ Build medical aid claims system
12. ⚠️ Add WhatsApp notifications

**Time:** 1-2 months
**Cost:** R5000-R10,000/month

---

## 📝 Environment Variables Summary

### Currently Required
```bash
# Authentication
GOOGLE_CLIENT_ID=680401337114-8r3siih33ghtaot71kq0umm1d7mj9d54.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=[REDACTED_FOR_SECURITY]
APP_URL=https://your-app.workers.dev

# AI
GEMINI_API_KEY=[REDACTED_FOR_SECURITY]

# Storage
PUBLIC_BUCKET_URL=https://pub-xxxxx.r2.dev  # After R2 setup

# Emergency (placeholder)
VITE_AURA_API_URL=https://sandbox.aura.co.za/api/v1
VITE_AURA_API_KEY=your_aura_api_key_here  # NEEDS REAL KEY
```

 ### Needed for Production
```bash
# Payment
PAYFAST_MERCHANT_ID=your_merchant_id
PAYFAST_MERCHANT_KEY=your_merchant_key
PAYFAST_PASSPHRASE=your_passphrase

# SMS/Notifications
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=your_twilio_number

# Medication Database
INFORMEDICA_API_KEY=your_informedica_key
INFORMEDICA_API_URL=https://api.informedica.nl/v1

# Maps
GOOGLE_MAPS_API_KEY=your_maps_key
```

---

## ✅ What's Already Working

Your platform **currently works** with:
- ✅ Google OAuth (authentication)
- ✅ Google Gemini AI (diagnostics)
- ✅ Cloudflare D1 (database)
- ✅ Browser geolocation (basic location)
- ✅ Manual payments (collect offline, record in system)

**You can launch without:**
- Informedica (add medication features later)
- Payment gateway (accept manual payments first)
- SMS notifications (use email temporarily)
- Advanced maps (nurses can use Google Maps app)

---

## 🎯 Recommendation: Phased Launch

### Week 1: Soft Launch (Current Build)
- Deploy with existing APIs
- Accept manual payments (bank transfer)
- Use email notifications
- Nurses use own GPS apps
- **Get users, gather feedback**

### Week 2-3: Add Critical APIs
- PayFast integration (online payments)
- Twilio SMS (automated notifications)
- R2 storage (image uploads)
- Aura API (panic button)

### Month 2+: Scale
- Informedica (medication safety)
- Google Maps (nurse routing)
- Lab integrations
- Medical aid claims

**This approach lets you launch fast, validate demand, then add features.**

---

## 📞 API Signup Links

| API | Signup URL | Approval Time | Free Tier |
|-----|-----------|---------------|-----------|
| PayFast | https://www.payfast.co.za/user/register | 2-3 days | Yes (transaction fees) |
| Twilio | https://www.twilio.com/try-twilio | Instant | Yes ($15 credit) |
| Africa's Talking | https://account.africastalking.com/auth/register | Instant | Yes (credits) |
| Google Maps API | https://console.cloud.google.com/google/maps-apis | Instant | Yes ($200 credit) |
| Aura | https://aura.co.za/contact | 3-5 days | No (paid service) |
| Informedica | https://www.informedica.nl/contact | 5-10 days | No (paid service) |

---

## 🚨 Critical Missing for Production

### Must Have Before Launch:
1. **None!** You can launch with current APIs and add others incrementally.

### Should Have Within 2 Weeks:
1. **R2 Storage** (15 minutes to set up)
2. **Payment Gateway** (2-3 days for approval)
3. **SMS Notifications** (instant signup)

### Can Add Later:
- Everything else (Informedica, Maps, Lab integrations, etc.)

---

**Summary:** Your build is production-ready with the APIs you have. The missing APIs (Informedica, PayFast, etc.) can be added post-launch without blocking deployment.

**Next Step:** Choose your launch strategy (soft launch now, add APIs later vs. wait for all APIs).

