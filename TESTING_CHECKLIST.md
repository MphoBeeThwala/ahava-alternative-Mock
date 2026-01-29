# 🧪 Ahava Healthcare - Testing Checklist

## Pre-Deployment Testing

### 🔐 Authentication Flow

#### Google OAuth Sign-In
- [ ] Click "Sign In" button on homepage
- [ ] Redirects to Google OAuth consent screen
- [ ] After Google approval, redirects back to app
- [ ] Session cookie is set correctly
- [ ] User is redirected to `/onboarding`

**Expected Behavior:**
- No `invalid_grant` errors in terminal
- No infinite redirect loops
- Session persists after page refresh

**How to Test:**
1. Clear browser cookies
2. Go to `http://localhost:5173`
3. Click "Get Started with Google"
4. Complete Google sign-in
5. Should land on onboarding page

---

### 👤 Onboarding Flow

#### Role Selection & Profile Creation
- [ ] Role selection screen shows 3 options (Patient, Nurse, Doctor)
- [ ] Can select a role
- [ ] Form fields appear based on role
- [ ] SANC ID field appears for Nurse role
- [ ] Can fill out all required fields
- [ ] Terms & conditions checkbox works
- [ ] Submit button enables when form is valid
- [ ] Profile saves to database
- [ ] Redirects to appropriate dashboard

**Test Cases:**

**Patient Onboarding:**
1. Select "Patient" role
2. Fill in: Full Name, Phone, Address
3. Accept terms
4. Click "Complete Profile"
5. Should redirect to `/dashboard`

**Nurse Onboarding:**
1. Select "Nurse" role
2. Fill in: Full Name, Phone, Address, SANC ID
3. Accept terms
4. Click "Complete Profile"
5. Should redirect to `/nurse-dashboard`

**Doctor Onboarding:**
1. Select "Doctor" role
2. Fill in: Full Name, Phone, Address
3. Accept terms
4. Click "Complete Profile"
5. Should redirect to `/doctor-dashboard`

---

### 🏥 Patient Dashboard

#### Core Features
- [ ] Dashboard loads without errors
- [ ] Navigation menu works
- [ ] Can access all menu items

#### Biometric Monitoring
- [ ] Can view biometric history
- [ ] Can add new biometric data
- [ ] Data saves correctly
- [ ] Charts/graphs display (if implemented)

#### Request Services
- [ ] Service request form loads
- [ ] Can select service type
- [ ] Can enter address/location
- [ ] Can add notes
- [ ] Request submits successfully
- [ ] Confirmation message appears

#### Diagnostic Analysis (AI)
- [ ] Can enter symptoms
- [ ] Can upload images (if R2 configured)
- [ ] AI analysis runs
- [ ] Results display correctly
- [ ] Recommendations show
- [ ] Estimated cost displays

#### Panic Button
- [ ] Panic button is visible
- [ ] Click shows confirmation dialog
- [ ] Can confirm or cancel
- [ ] Location detection works (if enabled)
- [ ] Alert sends successfully
- [ ] Status updates show

---

### 👩‍⚕️ Nurse Dashboard

#### Core Features
- [ ] Dashboard loads without errors
- [ ] Can view pending appointments
- [ ] Can accept appointments
- [ ] Can mark appointments as in-progress
- [ ] Can complete appointments
- [ ] Can view patient location (if provided)

#### Appointment Management
- [ ] List of appointments displays
- [ ] Can filter by status
- [ ] Can view appointment details
- [ ] Can add notes to appointments
- [ ] Status updates persist

---

### 👨‍⚕️ Doctor Dashboard

#### Core Features
- [ ] Dashboard loads without errors
- [ ] Can view pending diagnostic reports
- [ ] Can review AI diagnoses
- [ ] Can approve/reject diagnoses
- [ ] Can add doctor notes

#### Diagnostic Review
- [ ] List of reports displays
- [ ] Can view patient symptoms
- [ ] Can see uploaded images
- [ ] Can see AI recommendations
- [ ] Can approve with modifications
- [ ] Approval saves correctly

---

### 🔒 Security & Middleware

#### Authentication Middleware
- [ ] Protected routes require authentication
- [ ] Unauthenticated users redirect to home
- [ ] Session tokens validate correctly
- [ ] Expired sessions redirect to login

#### Rate Limiting
- [ ] Rapid API calls get rate limited
- [ ] 429 status returned when limit exceeded
- [ ] Rate limit resets after duration

#### Audit Logging
- [ ] Profile creation logs to audit_logs table
- [ ] Image uploads log to audit_logs table
- [ ] Diagnostic analysis logs to audit_logs table
- [ ] Logs include user_id, action, timestamp

**How to Test:**
```powershell
# Check audit logs
npx wrangler d1 execute DB --local --command "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10"
```

---

### 📤 API Endpoints

#### `/api/auth/session`
- [ ] Returns user data when authenticated
- [ ] Returns 401 when not authenticated
- [ ] Includes all user fields (id, email, name, emailVerified)

#### `/api/profile`
- [ ] GET returns profile for authenticated user
- [ ] POST creates new profile
- [ ] PUT updates existing profile
- [ ] Validates required fields
- [ ] Returns 401 without auth

#### `/api/diagnostic-analysis`
- [ ] Accepts symptoms text
- [ ] Accepts image URLs
- [ ] Returns AI analysis
- [ ] Saves to diagnostic_reports table
- [ ] Rate limiting works

#### `/api/image-upload`
- [ ] Accepts image file
- [ ] Uploads to R2 bucket (if configured)
- [ ] Returns public URL
- [ ] Validates file type
- [ ] Rate limiting works

---

### 🗄️ Database Operations

#### User Table
```powershell
npx wrangler d1 execute DB --local --command "SELECT * FROM user LIMIT 5"
```
- [ ] Users created on sign-in
- [ ] Email is unique
- [ ] emailVerified field updates

#### Session Table
```powershell
npx wrangler d1 execute DB --local --command "SELECT * FROM session LIMIT 5"
```
- [ ] Sessions created on login
- [ ] Token is unique
- [ ] expiresAt is set correctly
- [ ] Old sessions cleaned up

#### Profiles Table
```powershell
npx wrangler d1 execute DB --local --command "SELECT * FROM profiles LIMIT 5"
```
- [ ] Profile created on onboarding
- [ ] user_id matches user table
- [ ] Role is set correctly
- [ ] Terms acceptance recorded

---

### 🌐 Frontend Routing

#### Public Routes
- [ ] `/` - Homepage (accessible to all)
- [ ] `/auth/callback` - OAuth callback (accessible to all)

#### Protected Routes
- [ ] `/onboarding` - Requires auth
- [ ] `/dashboard` - Requires auth + patient role
- [ ] `/nurse-dashboard` - Requires auth + nurse role
- [ ] `/doctor-dashboard` - Requires auth + doctor role

#### 404 Handling
- [ ] Invalid routes show 404 page
- [ ] 404 page has link back to home

---

### 🐛 Error Handling

#### Network Errors
- [ ] API failures show user-friendly messages
- [ ] Loading states display correctly
- [ ] Retry logic works (where implemented)

#### Validation Errors
- [ ] Form validation messages display
- [ ] Invalid data rejected by API
- [ ] Zod validation errors are clear

#### Console Errors
- [ ] No console errors on homepage
- [ ] No console errors during sign-in
- [ ] No console errors during onboarding
- [ ] No console errors on dashboards

---

## 🎯 Critical Path Testing

**Minimum Viable Product (MVP) Flow:**

1. **New User Sign-Up**
   - [ ] Visit homepage
   - [ ] Click "Get Started with Google"
   - [ ] Complete Google OAuth
   - [ ] Land on onboarding
   - [ ] Select role (Patient)
   - [ ] Fill profile form
   - [ ] Accept terms
   - [ ] Submit profile
   - [ ] Redirect to dashboard

2. **Returning User Sign-In**
   - [ ] Visit homepage
   - [ ] Click "Sign In"
   - [ ] Complete Google OAuth
   - [ ] Redirect to dashboard (skip onboarding)

3. **Patient Request Service**
   - [ ] Sign in as patient
   - [ ] Go to "Request Services"
   - [ ] Fill service request form
   - [ ] Submit request
   - [ ] See confirmation

4. **Nurse Accept Appointment**
   - [ ] Sign in as nurse
   - [ ] View pending appointments
   - [ ] Click "Accept" on appointment
   - [ ] Status updates to "ACCEPTED"

5. **Doctor Review Diagnosis**
   - [ ] Sign in as doctor
   - [ ] View pending diagnostic reports
   - [ ] Review AI analysis
   - [ ] Approve diagnosis
   - [ ] Add doctor notes
   - [ ] Submit approval

---

## 📊 Performance Testing

### Load Times
- [ ] Homepage loads in < 2 seconds
- [ ] Dashboard loads in < 3 seconds
- [ ] API responses in < 1 second

### Bundle Size
- [ ] Client bundle < 500 KB
- [ ] Worker bundle < 1 MB
- [ ] Images optimized

---

## ✅ Pre-Production Checklist

Before deploying to production:

- [ ] All critical path tests pass
- [ ] No console errors
- [ ] All API endpoints working
- [ ] Database migrations complete
- [ ] OAuth redirect URIs configured
- [ ] Environment variables set
- [ ] R2 bucket configured (or skipped intentionally)
- [ ] Rate limiting tested
- [ ] Audit logging verified
- [ ] Security middleware working

---

## 🚀 Post-Deployment Testing

After deploying to production:

- [ ] Production URL accessible
- [ ] Google OAuth works with production URL
- [ ] Database operations work on remote D1
- [ ] R2 uploads work (if configured)
- [ ] All dashboards accessible
- [ ] No CORS errors
- [ ] HTTPS working (if custom domain)

---

**Testing Status:** Ready for manual testing ✅

**Next Steps:**
1. Follow OAuth fix guide to clear browser state
2. Test critical path flows
3. Verify database operations
4. Deploy to production

