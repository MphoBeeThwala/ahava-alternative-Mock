# 🧪 Ahava Healthcare - Testing & Demonstration Guide

## Quick Start Testing

### Prerequisites
```bash
# Ensure you have:
- Node.js 18+ (check: node -v)
- PostgreSQL running (Docker or local)
- pnpm installed (check: pnpm -v)
- Backend .env configured with API keys
```

### 1. Start the Platform (5 minutes)

**Terminal 1 - Backend:**
```bash
cd apps/backend
pnpm install
pnpm run dev

# Expected output:
# ✓ Server running on port 4000
# ✓ Database connected
# ✓ Redis optional (can skip)
```

**Terminal 2 - Frontend:**
```bash
cd workspace
pnpm install
pnpm run dev

# Expected output:
# ✓ Next.js app running on port 3000
# Open http://localhost:3000
```

---

## End-to-End Testing Scenarios

### Scenario 1: Complete Patient Journey (30 minutes)

#### Step 1.1: Patient Registration
```bash
# In browser: http://localhost:3000/auth/signup

Form Fields:
├─ Email: patient@example.com
├─ Password: TestPass123!
├─ First Name: John
├─ Last Name: Doe
├─ Type: PATIENT
└─ Phone: +27 (optional, can skip)

Expected: Redirects to /patient/dashboard
```

**Verification:**
```bash
# Check database:
psql $DATABASE_URL -c "SELECT id, email, role, isActive FROM users WHERE email='patient@example.com';"

# Expected output:
# id                  | email              | role   | isActive
# ----                | -----              | ----   | --------
# uuid-string         | patient@example... | PATIENT| true
```

#### Step 1.2: View Dashboard
- Should show 4 cards: AI Doctor, Bookings, Monitoring, Health Alerts
- All should be interactive
- No console errors

#### Step 1.3: Submit Triage (AI Diagnosis)
```
Navigate to: /patient/ai-doctor

1. Fill symptoms:
   "I have a persistent dry cough for 3 days and chest pain when I breathe"

2. Click "Analyze symptoms"

3. Expected Response (10-30 seconds):
   {
     "triageLevel": 2,
     "possibleConditions": ["Pneumonia", "Bronchitis", "Pleurisy"],
     "recommendedAction": "See immediate care - Go to hospital",
     "reasoning": "REFERENCE: Pneumonia typically presents with cough, fever, 
                  chest pain... [StatPearls medical context]
                  Your symptoms strongly suggest acute respiratory infection..."
   }
```

**Verification:**
```bash
# Check database for stored triage case:
psql $DATABASE_URL -c "
  SELECT id, patientId, aiTriageLevel, status 
  FROM \"TriageCase\" 
  ORDER BY createdAt DESC 
  LIMIT 1;"

# Expected:
# id        | patientId | aiTriageLevel | status
# --------  | --------- | ------------- | -----
# uuid      | patient   | 2             | PENDING_REVIEW
```

**Check Logs for AI Service Performance:**
```bash
# From backend terminal, should see:
✓ [StatPearls] Fetched 3 articles for query: "cough chest pain pneumonia"
✓ [Claude] Analysis complete in 1200ms
✓ [TriageCase] Created: id=uuid, level=2, conditions=Pneumonia,Bronchitis,Pleurisy
```

#### Step 1.4: Submit Biometrics
```
Navigate to: /patient/monitoring

Submit readings:
├─ Heart Rate: 98 bpm
├─ Blood Pressure: 140/90 mmHg (elevated)
├─ Oxygen: 96%
├─ Temperature: 37.2°C
└─ Submit

Expected: "Reading recorded ✓"
```

**Verification:**
```bash
# Check biometric stored:
psql $DATABASE_URL -c "
  SELECT id, userId, heartRate, bloodPressure 
  FROM \"BiometricReading\" 
  WHERE userId='patient-uuid' 
  ORDER BY createdAt DESC LIMIT 1;"

# Expected: Entry with your values
```

#### Step 1.5: Check Health Alerts
```
Navigate to: /patient/dashboard

Should display alerts (if readings were abnormal):
- YELLOW alert: "Elevated Blood Pressure - 140/90"
- Recommendation: "Monitor closely, consider doctor visit"
```

---

### Scenario 2: Test Token Refresh (15 minutes)

**Purpose:** Verify the logout fix works

#### Steps:
```
1. Log in as patient
2. Open DevTools (F12) → Application → Local Storage
3. Note: token, refreshToken values
4. Wait 16 minutes (or manually edit token to invalid value)
5. Try to use AI Doctor without refreshing browser
6. Expected: Works silently (token auto-refreshed)
```

**In Console, watch for:**
```javascript
// Before fix (BAD):
[401 Error] Immediate redirect to login

// After fix (GOOD):
[API] Attempting to refresh token...
[API] Token refreshed successfully
[Success] AI Analysis complete
```

**Automate Token Expiration (For Testing):**
```javascript
// In browser console:
// Set token to expire in 5 seconds (instead of 15 minutes)
const fakeToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjd9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
localStorage.setItem('token', fakeToken);

// Now try AI Doctor → should prompt refresh
```

---

### Scenario 3: AI Service Fallback (5 minutes)

**Purpose:** Verify system doesn't break if primary AI fails

#### Test Claude Fallback:
```bash
1. Add invalid Claude key to backend:
   export ANTHROPIC_API_KEY=invalid-key

2. Restart backend

3. Try AI Diagnosis
   Expected: Falls back to Gemini automatically
   
4. Check logs:
   ✓ [Claude] Rate limited, trying Gemini fallback
   ✓ [Gemini] Analysis complete
```

**Verify Both AI Models Work:**
```bash
# Terminal 1: Test Claude directly
curl -X POST http://localhost:4000/api/triage \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "symptoms": "severe headache and fever"
  }'

# Terminal 2: Disable Claude, verify Gemini works
export ANTHROPIC_API_KEY=""
# Repeat curl above
# Expected: Different response (Gemini uses different format)
```

---

### Scenario 4: MCP/StatPearls Integration (10 minutes)

#### Test Medical Context Injection:

**Step 1: Run with Default Settings (NCBI Direct)**
```bash
# Backend should have blank STATPEARLS_SERVICE_URL
echo $STATPEARLS_SERVICE_URL
# (empty or unset)

# Submit triage with uncommon symptom:
# "Paroxysmal nocturnal hemoglobinuria"

# Check response:
{
  "aiReasoning": "REFERENCE: Paroxysmal nocturnal hemoglobinuria (PNH) is... 
  [StatPearls article content]"
}

# If "REFERENCE:" appears → MCP working ✓
```

**Step 2: Monitor StatPearls Performance**
```bash
# In backend terminal, grep for timing:
grep "StatPearls\|medical context" logs.txt

# Expected output:
✓ [StatPearls] Fetched 5 articles in 450ms
✓ [Medical Context] Injected: 8,000 chars into prompt
✓ [Claude] Processing with context...
```

**Step 3: Test with External MCP (Optional)**
```bash
# If you have external MCP server running at port 4444:

export STATPEARLS_SERVICE_URL=http://localhost:4444
npm run dev

# Submit triage
# Logs should show:
✓ [StatPearls] Using external MCP service
✓ [MCP] /disease-info?query=symptom_query
✓ [MCP Response] 200 OK, fetched context
```

**Step 4: Test Graceful Degradation**
```bash
# Break StatPearls (simulate service down):
export STATPEARLS_SERVICE_URL=http://invalid-service:9999

npm run dev

# Submit triage
# Expected:
✓ [StatPearls] Connection failed, falling back to direct NCBI
✓ [AI] Analysis complete (with basic medical context)

# Should still work! ✓
```

---

### Scenario 5: Database Integrity (10 minutes)

#### Test Transaction Safety:
```bash
# Simulate booking + payment process

1. Create booking via API:
curl -X POST http://localhost:4000/api/bookings \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scheduledDate": "2026-03-20T10:00:00Z",
    "address": "123 Main St",
    "amountInCents": 5000
  }'

2. Check database state:
psql $DATABASE_URL -c "
  SELECT id, status, paymentStatus 
  FROM \"Booking\" 
  ORDER BY createdAt DESC LIMIT 1;"

Expected: Booking exists with status=PENDING, paymentStatus=PENDING
```

#### Test Data Consistency:
```bash
# Check for orphaned records (should be none):
psql $DATABASE_URL -c "
  SELECT b.id 
  FROM \"Booking\" b 
  LEFT JOIN \"Visit\" v ON b.id = v.bookingId 
  LEFT JOIN \"Payment\" p ON b.id = p.bookingId
  WHERE b.status='COMPLETED' AND p.status IS NULL;
  -- Should return: (0 rows)
"
```

---

## Performance Testing

### Load Test: 100 Concurrent Users (30 seconds each)

**Using Apache Bench:**
```bash
# Test endpoint: AI Diagnosis
ab -n 100 -c 10 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -p triage-payload.json \
  http://localhost:4000/api/triage

# triage-payload.json:
{
  "symptoms": "chest pain"
}

# Expected:
# Requests per second: 5-10 (depends on AI model latency)
# Failed requests: 0
# Average response time: 1200ms
```

**Using k6 (Better Tool):**
```bash
# Install: brew install k6

# Create test script: test-load.js
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  vus: 50,           // 50 concurrent users
  duration: '1m',    // 1 minute test
};

export default function() {
  let response = http.post('http://localhost:4000/api/triage', {
    symptoms: 'mild cough',
  }, {
    headers: {
      'Authorization': `Bearer YOUR_TOKEN`,
    }
  });

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response in <2s': (r) => r.timings.duration < 2000,
  });
}

# Run:
k6 run test-load.js

# Expected:
# ✓ 95%+ checks passed
# ✓ Response time <2s
# ✓ No errors
```

---

## Security Testing

### 1. Authentication Bypass Attempts
```bash
# Try to access patient endpoint without token:
curl -X GET http://localhost:4000/api/patient/bookings

# Expected: 401 Unauthorized
# Actual: (should be 401, not 200)

echo $? # Exit code should be non-zero
```

### 2. Token Validation
```bash
# Try with invalid token:
curl -X GET http://localhost:4000/api/patient/bookings \
  -H "Authorization: Bearer invalid.token.here"

# Expected: 401 Invalid token
```

### 3. Role-Based Access Control
```bash
# Login as PATIENT
TOKEN_PATIENT=$(... login response ...)

# Try to access DOCTOR endpoint:
curl -X GET http://localhost:4000/api/doctor/triage-cases \
  -H "Authorization: Bearer $TOKEN_PATIENT"

# Expected: 403 Forbidden (insufficient permissions)
```

### 4. SQL Injection Prevention
```bash
# Try SQL injection in email field:
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com\" OR \"1\"=\"1",
    "password": "test"
  }'

# Expected: 400 Bad request or invalid credentials
# Actual: Should NOT execute SQL or return user data
```

### 5. Rate Limiting
```bash
# Rapid login attempts:
for i in {1..10}; do
  curl -X POST http://localhost:4000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email": "test@example.com", "password": "wrong"}'
done

# Expected: Last attempts return 429 Too Many Request
```

---

## System Health Checks

### Backend Health
```bash
# Quick status check:
curl http://localhost:4000/api/health

# Expected:
{
  "status": "ok",
  "database": "connected",
  "redis": "optional",
  "timestamp": "2026-03-10T12:34:56Z"
}
```

### Database Connection
```bash
# Test connection:
psql $DATABASE_URL -c "SELECT NOW();"

# Expected: (displays current timestamp)
```

### Redis Connection (if configured)
```bash
# Test connection:
redis-cli ping

# Expected: PONG
```

### External Services
```bash
# Test Claude connectivity:
curl -X GET https://api.anthropic.com/v1/models \
  -H "x-api-key: $ANTHROPIC_API_KEY"

# Expected: 200 OK (list of models)
```

---

## Browser DevTools Debugging

### Network Tab Analysis

**1. Check Authorization Headers**
```
Visit any patient endpoint in Network tab
Click request → Headers tab

Request Headers should include:
Authorization: Bearer eyJhbGc...
```

**2. Monitor Token Refresh**
```
Wait 16 minutes, then make a request
Network tab should show:
1. POST /api/triage → 401 (expired token)
2. POST /api/auth/refresh → 200 (refresh successful)
3. POST /api/triage → 200 (retry successful)
```

**3. Check Response Times**
```
AI Diagnosis should take: 1000-3000ms
(depending on Claude/Gemini latency)

If >5000ms: May indicate rate limiting or service issues
If <500ms: Possible caching or error response
```

### Console Tab Analysis

**1. Check for Errors**
```javascript
// In console, filter by Error level
// Should see: (0 errors for normal operation)

// Expected warnings (OK to have):
// [API] Token refresh attempted
// [ML Service] Optional service not configured
```

**2. Monitor State Updates**
```javascript
// Add debugging:
localStorage.getItem('token');      // Should have value
localStorage.getItem('user');       // Should have JSON object
localStorage.getItem('refreshToken');  // Should have value
```

---

## Demonstration Walkthrough (For Stakeholders)

### 5-Minute Demo Script

```
1. START STATE: Logged out
   → Show login page at http://localhost:3000

2. REGISTER (30 sec):
   "Let's create a patient account"
   → Fill form with demo data
   → "Notice it auto-logs us in"

3. DASHBOARD (20 sec):
   "Here's the patient dashboard with 4 main features"
   → Point to: AI Doctor, Bookings, Monitoring, Alerts

4. AI DIAGNOSIS (120 sec):
   "The core feature: AI-powered symptom triage"
   → Click "AI Doctor Assistant"
   → Type: "I have a sore throat and slight fever"
   → "Notice the real-time response from Claude AI"
   → Show results: triage level, conditions, recommendations

5. BIOMETRICS (30 sec):
   "Patient can log health readings"
   → Go to Monitoring
   → "If readings are abnormal (like this BP), 
      the system alerts the patient"

6. TOKEN PERSISTENCE (30 sec):
   Optional: Open DevTools → Local Storage
   "Even if the browser tabs closes, user stays logged in 
    for up to 7 days thanks to refresh tokens"

END: Q&A
```

---

## Troubleshooting Common Issues

### Issue: "Token refreshed but still logged out"

**Diagnosis:**
```bash
1. Check if refreshToken is stored:
   browser console: localStorage.getItem('refreshToken')
   
2. Should return a token string
   If null: Run Step 3 of logout fix again
```

**Fix:**
```bash
# Update AuthContext.tsx to save refreshToken
# See: LOGOUT_ISSUE_QUICK_FIX.md
```

### Issue: "AI Diagnosis returns generic response (no medical context)"

**Diagnosis:**
```bash
# Check if StatPearls fetch succeeded:
# Backend logs should show:
✓ [StatPearls] Fetched X articles

# If missing:
✗ [StatPearls] Fetch failed, using fallback
```

**Fix:**
```bash
# Verify internet connection
ping pubmed.ncbi.nlm.nih.gov

# Or use external MCP server:
export STATPEARLS_SERVICE_URL=http://mcp:4444
```

### Issue: "Rate limiter blocking legitimate requests"

**Diagnosis:**
```bash
# Check current limits (in rateLimiter.ts):
# Dev: 10,000 requests/15 min = 11/sec
# Prod: 100 requests/15 min = 0.1/sec
```

**Fix:**
```bash
# Increase rate limit in development:
export LOAD_TEST=1

# Then restart backend
# Now: 50,000 requests/15 min
```

---

## Production Testing Checklist

Before deploying to production:

- [ ] Token refresh works (wait 16 min, make request)
- [ ] AI diagnosis always returns results (test 10 times)
- [ ] Fallback from Claude to Gemini works
- [ ] Error messages are user-friendly
- [ ] Database stays consistent after errors
- [ ] Rate limiting works (test 429 response)
- [ ] Payment redirect works (if configured)
- [ ] Health alerts trigger on abnormal readings
- [ ] No console errors in browser
- [ ] No sensitive data in logs
- [ ] Performance <3s per request average
- [ ] Load test passes (100 concurrent)

---

## Next Steps

1. **Run End-to-End Test**: Complete Scenario 1 (30 min)
2. **Fix Token Refresh**: Implement logout fix (30 min)
3. **Test Failover**: Run Scenario 3 (5 min)
4. **Run Load Test**: Use k6 (10 min)
5. **Review Logs**: Ensure all services healthy

**Total estimated time: 90 minutes**

After completing these tests, your system is ready for:
- ✅ Beta testing with real users
- ✅ Production deployment
- ✅ Security audit
- ✅ Performance optimization
