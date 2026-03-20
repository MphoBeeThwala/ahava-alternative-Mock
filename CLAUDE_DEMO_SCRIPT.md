# AHAVA HEALTHCARE — CLAUDE DEMO APP BRIEF
**Version:** 1.0  
**Purpose:** Wire up a fully self-contained interactive demo app that demonstrates every real feature, service, and data flow of the Ahava Healthcare platform. No placeholders. Every button must do something real (or realistically simulated with mock data). This is for investor demos and technical stakeholder reviews.

---

## SECTION 1: BUSINESS CONTEXT

**Company:** Ahava Healthcare  
**Market:** South Africa  
**Problem:** South Africa has a severe healthcare access crisis. Rural and township communities lack access to medical professionals. The public healthcare system is overwhelmed. Emergency response infrastructure is unreliable.

**Solution:** Ahava is a **digital-first, on-demand home healthcare platform** that:
1. Connects patients with SANC-verified registered nurses who perform home visits
2. Uses dual AI (Claude Sonnet primary, Gemini Flash fallback) for preliminary symptom triage, grounded with StatPearls peer-reviewed medical knowledge from NCBI
3. Runs a continuous biometric early-warning engine (wearable + manual input) that detects cardiovascular disease risk BEFORE symptoms appear
4. Gives doctors remote oversight of AI triage decisions and nurse-led home visits
5. Includes a nurse field-safety system: a GPS panic button that notifies admins and emergency contacts instantly
6. Processes payments in South African Rand (ZAR) via Paystack, with full medical insurance/medical aid billing support
7. Is fully POPIA-compliant (South Africa's GDPR equivalent) with encrypted PII, audit trails, and data minimization

**Four User Roles:**
- **PATIENT** — books home visits, submits biometrics (wearable or manual), triggers AI triage, views diagnostic vault
- **NURSE** — toggles availability (goes online/offline), accepts/declines bookings via real-time WebSocket, updates GPS location, records visit biometrics and treatment, has a panic button
- **DOCTOR** — reviews AI triage cases (approve / override / refer), reviews completed nurse visits, releases diagnostic reports to patients
- **ADMIN** — full user management (CRUD), platform stats, active panic alert monitoring, appointment oversight

**Revenue Model:** Per-visit booking fees (ZAR), medical aid billing, enterprise health monitoring subscriptions

**Key differentiator vs. telemedicine:** Ahava sends a *physical nurse to the patient's home* + provides continuous biometric monitoring between visits + AI triage with mandatory doctor oversight — NOT a simple video call platform.

---

## SECTION 2: FULL TECHNICAL ARCHITECTURE

### Stack
| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TailwindCSS + Lucide Icons |
| Backend API | Node.js / Express (TypeScript) |
| Database ORM | Prisma + PostgreSQL |
| Real-time | WebSockets (ws library) — JWT-authenticated |
| ML Service | Python FastAPI (separate microservice) |
| Queue / Jobs | BullMQ + Redis (optional; falls back to direct execution) |
| Email | Resend (via BullMQ queue) |
| Payment | Paystack (ZAR currency) |
| AI Triage | Anthropic Claude claude-sonnet-4-20250514 (primary) + Google Gemini 2.0 Flash (fallback) |
| Medical Knowledge | NCBI StatPearls (scraped + injected as context into AI triage prompts) |
| Auth | JWT access tokens (15m) + refresh tokens (7d), bcrypt passwords |
| Security | Helmet, CORS, rate limiting, field-level AES encryption (addresses, SA ID numbers) |
| Compliance | POPIA (South Africa): audit logs with checksums, data minimization, encrypted PII |
| Deployment | Railway (production) — separate services for backend + ML + frontend |

### Monorepo Structure
```
ahava-healthcare/
├── apps/
│   ├── backend/          # Node.js/Express API
│   │   ├── src/
│   │   │   ├── routes/   # auth, bookings, visits, messages, payments, admin, triage, triageCases, nurse, patient, webhooks
│   │   │   ├── services/ # aiTriage, monitoring, websocket, notifications, queue, redis, email, statPearls, demoStream
│   │   │   ├── middleware/ # auth (JWT), rateLimiter, errorHandler
│   │   │   └── utils/    # encryption
│   │   └── prisma/
│   │       └── schema.prisma   # Full DB schema
│   └── ml-service/       # Python FastAPI
│       ├── main.py        # FastAPI routes
│       ├── engine.py      # EarlyWarningEngine class
│       └── models.py      # Pydantic models
└── src/react-app/        # React frontend
    ├── pages/            # PatientDashboard, DoctorDashboard, NurseDashboard, AdminDashboard, DiagnosticVault, Login, Signup, Onboarding, Payment
    └── components/       # SymptomAnalysisModal, RequestNurseModal, BaselineModal, PanicButton, MedicalDisclaimer, ErrorBoundary
```

---

## SECTION 3: DATABASE SCHEMA (Prisma/PostgreSQL)

```prisma
enum UserRole { PATIENT | NURSE | DOCTOR | ADMIN }
enum VisitStatus { SCHEDULED | EN_ROUTE | ARRIVED | IN_PROGRESS | COMPLETED | CANCELLED }
enum PaymentStatus { PENDING | PROCESSING | COMPLETED | FAILED | REFUNDED }
enum PaymentMethod { CARD | INSURANCE }
enum InsuranceStatus { PENDING_VERIFICATION | VERIFIED | REJECTED }
enum MessageType { TEXT | IMAGE | FILE | SYSTEM }
enum TriageCaseStatus { PENDING_REVIEW | APPROVED | DOCTOR_OVERRIDE | REFERRED }

model User {
  id                String       // CUID
  email             String       @unique
  phone             String?      @unique
  firstName / lastName String
  role              UserRole
  isActive          Boolean      // account enabled
  isVerified        Boolean      // SANC verified for nurses
  isAvailable       Boolean      // nurse online toggle
  profileImage      String?
  dateOfBirth       DateTime?
  gender            String?
  preferredLanguage String       @default("en-ZA")
  timezone          String       @default("Africa/Johannesburg")
  encryptedAddress  String?      // AES encrypted
  encryptedIdNumber String?      // AES encrypted SA ID
  lastKnownLat/Lng  Float?       // GPS for nurses
  lastLocationUpdate DateTime?
  pushTokens        String[]
  riskProfile       Json?        // { smoker, hypertension, cholesterolKnown, cholesterolValue } — for CVD algorithms
  passwordHash      String?
}

model Booking {
  patientId         String
  nurseId           String?
  encryptedAddress  String       // AES encrypted
  scheduledDate     DateTime
  estimatedDuration Int          // minutes
  paymentMethod     CARD | INSURANCE
  paymentStatus     PaymentStatus
  amountInCents     Int          // ZAR in cents
  insuranceProvider/MemberNumber String?
  insuranceStatus   InsuranceStatus?
  paystackReference String?
}

model Visit {
  bookingId         String       @unique
  nurseId / doctorId String
  status            VisitStatus
  scheduledStart    DateTime
  actualStart/End   DateTime?
  gpsCoordinates    Json?        // [{ lat, lng, timestamp }]
  biometrics        Json?        // [{ bloodPressure: {sys,dia}, heartRate, temp, SpO2, weight, height, glucose, timestamp }]
  treatment         Json?        // { medications: [{name, dosage, frequency}], procedures, notes, timestamp }
  nurseReport       String?      // Encrypted
  doctorReview      String?
  doctorRating      Int?         // 1-5 stars
}

model TriageCase {
  patientId         String
  doctorId          String?
  symptoms          String
  imageStorageRef   String?
  aiTriageLevel     Int          // 1-5 (1=critical/ER, 5=home care)
  aiRecommendedAction String
  aiPossibleConditions Json      // string[]
  aiReasoning       String
  status            TriageCaseStatus
  doctorNotes       String?
  finalDiagnosis    String?
  referredTo        String?
}

model BiometricReading {
  userId            String
  heartRate / heartRateResting Float?
  hrvRmssd          Float?       // Heart Rate Variability (ms)
  bloodPressureSystolic/Diastolic Float?
  oxygenSaturation  Float?       // SpO2 %
  temperature       Float?       // Celsius
  respiratoryRate   Float?       // breaths/min
  weight / height / glucose Float?
  stepCount         Int?
  activeCalories    Float?
  skinTempOffset    Float?       // deviation from baseline (wearable)
  sleepDurationHours Float?
  ecgRhythm         String?      // "regular" | "irregular" | "unknown"
  temperatureTrend  String?      // "normal" | "elevated_single_day" | "elevated_over_3_days"
  source            String       // "wearable" | "manual"
  deviceType        String?      // "apple_watch" | "fitbit" | "manual_entry"
  alertLevel        String?      // "GREEN" | "YELLOW" | "RED"
  anomalies         Json?        // string[] of detected anomaly descriptions
  readinessScore    Int?         // 0-100
}

model HealthAlert {
  userId            String
  alertLevel        String       // "YELLOW" | "RED"
  title             String
  message           String
  detectedAnomalies Json?
  acknowledged      Boolean
  resolved          Boolean
  biometricReadingId String?
  visitId           String?
}

model AuditLog {
  userId / userRole / action / resource / resourceId String
  metadata          Json?
  checksum          String       // SHA integrity verification
}
```

---

## SECTION 4: COMPLETE API REFERENCE

### Auth  (`/api/auth`)
| Method | Path | Description |
|---|---|---|
| POST | `/register` | Register: `{ email, password, firstName, lastName, role, phone?, dateOfBirth?, gender?, preferredLanguage? }` → `{ user, accessToken, refreshToken }` |
| POST | `/login` | Login: `{ email, password }` → `{ user, accessToken, refreshToken }` |
| POST | `/refresh` | Refresh: `{ refreshToken }` → `{ accessToken, refreshToken }` |
| POST | `/logout` | Logout: `{ refreshToken }` → invalidates token |
| GET | `/me` | Bearer auth → full user object |

### Patient (`/api/patient`) — Bearer auth required
| Method | Path | Description |
|---|---|---|
| POST | `/biometrics` | Submit reading: `{ heartRate, heartRateResting, hrvRmssd, bloodPressure:{systolic,diastolic}, oxygenSaturation, temperature, respiratoryRate, weight, height, glucose, stepCount, activeCalories, skinTempOffset, sleepDurationHours, ecgRhythm, temperatureTrend, source, deviceType }` → `{ alertLevel: GREEN/YELLOW/RED, anomalies[], readinessScore, recommendations[], earlyWarnings[] }` |
| GET | `/biometrics/history` | Paginated biometric history `?limit=30&offset=0` |
| GET | `/alerts` | Unresolved health alerts |
| GET | `/monitoring/summary` | `{ baselineEstablished, daysUntilBaseline, currentReadinessScore, recentAlerts, trend }` |
| GET | `/early-warning` | Full CVD dashboard: risk scores (Framingham, QRISK3, custom ML), fusion trajectory, clinical flags |
| PATCH | `/risk-profile` | `{ smoker?, hypertension?, cholesterolKnown?, cholesterolValue? }` |
| GET | `/baseline-info` | `{ daysEstablished, daysRequired: 14, isComplete }` |
| GET | `/anomaly-timeline` | Last 30 days anomaly timeline `?days=30` |
| POST | `/triage` | AI triage with optional biometric context: `{ symptoms, imageBase64?, biometrics? }` |
| POST | `/demo/start-stream` | Start demo biometric stream `?durationSeconds=300&intervalSeconds=30` |

### Bookings (`/api/bookings`) — Bearer auth
| Method | Path | Description |
|---|---|---|
| POST | `/` | Create booking `{ encryptedAddress, scheduledDate, estimatedDuration, paymentMethod, amountInCents, patientLat, patientLng, insuranceProvider?, insuranceMemberNumber? }` → broadcasts `NEW_BOOKING_AVAILABLE` to nurses within 10km via WebSocket |
| GET | `/` | Role-filtered bookings list `?limit=10&offset=0&status=` |
| GET | `/:id` | Single booking with visit and messages |
| PATCH | `/:id/cancel` | Patient cancels → sets `REFUNDED` status |

### Visits (`/api/visits`) — Bearer auth
| Method | Path | Description |
|---|---|---|
| POST | `/` | Create visit from booking `{ bookingId, nurseId }` |
| GET | `/` | User visits (role-filtered) |
| GET | `/:id` | Visit detail with messages, biometrics, treatment |
| PATCH | `/:id/status` | Update status `{ status: SCHEDULED|EN_ROUTE|ARRIVED|IN_PROGRESS|COMPLETED|CANCELLED }` |
| POST | `/:id/biometrics` | Record biometrics during visit |
| POST | `/:id/treatment` | Record `{ medications:[{name,dosage,frequency}], procedures:[], notes }` |
| POST | `/:id/nurse-report` | Submit encrypted nurse report |
| POST | `/:id/doctor-review` | Doctor reviews completed visit `{ review, rating }` |

### Triage (`/api/triage`) — Bearer auth + rate limited
| Method | Path | Description |
|---|---|---|
| POST | `/` | `{ symptoms, imageBase64? }` → Fetches StatPearls context from NCBI → calls Claude (or Gemini fallback) → `{ triageLevel:1-5, possibleConditions[], recommendedAction, reasoning }` + creates TriageCase for doctor review |

### Triage Cases (`/api/triage-cases`) — Doctor/Admin only
| Method | Path | Description |
|---|---|---|
| GET | `/` | Triage queue `?status=PENDING_REVIEW|mine` |
| POST | `/:id/approve` | Doctor agrees with AI `{ finalDiagnosis? }` → emails patient |
| POST | `/:id/override` | Doctor disagrees `{ doctorNotes?, finalDiagnosis? }` → emails patient |
| POST | `/:id/refer` | Refer to in-person `{ referredTo, doctorNotes? }` → emails patient |

### Nurse (`/api/nurse`) — Bearer auth
| Method | Path | Description |
|---|---|---|
| POST | `/availability` | Toggle online `{ lat, lng, isAvailable? }` |
| GET | `/nearby` | Find nurses near coords `?lat=&lng=&radiusKm=10` (Haversine distance) |

### Admin (`/api/admin`) — Admin role only
| Method | Path | Description |
|---|---|---|
| GET | `/stats` | `{ totalUsers }` |
| GET | `/users` | All users |
| POST | `/users` | Create user `{ email, password, firstName, lastName, role, phone?, preferredLanguage? }` |
| GET | `/users/:id` | Single user |
| PUT/PATCH | `/users/:id` | Update `{ firstName, lastName, role, isActive, isVerified, phone }` |
| DELETE | `/users/:id` | Delete user |

### Payments (`/api/payments`) — Bearer auth
| POST/GET/PUT/DELETE | Standard CRUD for payment records (Paystack ZAR) |

### Messages (`/api/messages`) — Bearer auth
| POST | `/` | Send encrypted in-visit message |
| GET | `/` | Get messages for visit |

### Webhooks (`/webhooks`)
| POST | `/paystack` | Paystack payment webhook (verifies HMAC signature, updates payment status) |

---

## SECTION 5: WEBSOCKET PROTOCOL

**Connection:** `ws://server?token=<JWT_ACCESS_TOKEN>`

**Client → Server messages:**
```json
{ "type": "NURSE_GO_ONLINE", "data": { "lat": -26.2041, "lng": 28.0473 } }
{ "type": "NURSE_GO_OFFLINE" }
{ "type": "ACCEPT_BOOKING", "data": { "bookingId": "..." } }
{ "type": "DECLINE_BOOKING", "data": { "bookingId": "..." } }
{ "type": "LOCATION_UPDATE", "data": { "lat": ..., "lng": ... } }
{ "type": "VISIT_STATUS_UPDATE", "data": { "visitId": "...", "status": "EN_ROUTE" } }
{ "type": "MESSAGE_TYPING", "data": { "recipientId": "...", "visitId": "...", "isTyping": true } }
```

**Server → Client messages:**
```json
{ "type": "NEW_BOOKING_AVAILABLE", "data": { "bookingId", "patientName", "scheduledDate", "estimatedDuration", "amountInCents", "distanceKm" } }
{ "type": "BOOKING_ACCEPTED", "data": { "bookingId", "visitId", "nurse": {id, firstName, lastName} } }
{ "type": "BOOKING_TAKEN", "data": { "bookingId" } }
{ "type": "ACCEPT_BOOKING_SUCCESS", "data": { "bookingId", "visitId", "patient" } }
{ "type": "NURSE_LOCATION_UPDATE", "data": { "visitId", "lat", "lng", "timestamp" } }
{ "type": "VISIT_STATUS_CHANGED", "data": { "visitId", "status", "timestamp" } }
{ "type": "TYPING_INDICATOR", "data": { "senderId", "visitId", "isTyping" } }
{ "type": "NURSE_ONLINE_SUCCESS" }
{ "type": "NURSE_OFFLINE_SUCCESS" }
```

---

## SECTION 6: ML SERVICE (Python FastAPI on port 8000)

### EarlyWarningEngine — How it works

**Input (BiometricData):**
```python
{
  timestamp: datetime,
  heart_rate_resting: float,  # bpm
  hrv_rmssd: float,           # Heart Rate Variability (ms) — KEY indicator
  spo2: float,                # Blood oxygen %
  skin_temp_offset: float,    # Deviation from personal baseline (wearable)
  respiratory_rate: float,    # breaths/min
  step_count: int,            # Context filter
  active_calories: float,     # Context filter
  sleep_duration_hours: float,
  ecg_rhythm: "regular"|"irregular"|"unknown",  # AFib detection
  temperature_trend: "normal"|"elevated_single_day"|"elevated_over_3_days"
}
```

**Processing pipeline:**
1. **Baseline Establishment**: Requires 14 days of data. Returns GREEN during calibration.
2. **Exercise Context Filter**: If step_count > 90th percentile of user history → suppress alerts (normal for exercise)
3. **Z-Score Anomaly Detection** on 4 metrics:
   - `heart_rate_resting` (alert if HIGH: z > 1.5σ)
   - `hrv_rmssd` (alert if LOW: z < -1.5σ — key stress/illness indicator)
   - `spo2` (alert if LOW: z < -1.5σ)
   - `respiratory_rate` (alert if HIGH: z > 1.5σ)
4. **Alert Level Fusion**: Score weighted by severity → YELLOW (1+) or RED (3+ significant deviations)
5. **CVD Risk Scoring** (3 independent algorithms):
   - **Framingham Adapted**: uses age, resting HR, hypertension flag, smoking flag → 10-year CVD risk %
   - **QRISK3 Adapted**: Framingham + HRV uplift + sleep < 6h uplift + step count uplift → 10-year CVD risk %
   - **Custom ML Model**: weighted heuristic (placeholder for South African cohort-trained model) → risk % + confidence
6. **Feature Extraction**: HR trend over 2 weeks (rising/stable/declining), HRV vs baseline (below/at/above), sleep pattern
7. **Fusion Trajectory**: Projects 2-year risk. Triggers alert if current ML risk ≥ 20% or trajectory ≥ 28% with rising trend
8. **Clinical Flags**: AFib suspected (ECG irregular), HRV below threshold, HR above personal baseline

**API Endpoints:**
```
POST /ingest?user_id=X          Body: BiometricData → { alert_level, anomalies[], message }
GET  /readiness-score/{user_id} → { score: 0-100, baseline_status, trend }
POST /early-warning/analyze?user_id=X  Body: { biometrics: BiometricData, context?: ContextualProfile }
                                → Full EarlyWarningSummary with risk scores + fusion
GET  /early-warning/summary/{user_id}  → Latest EarlyWarningSummary (404 if no data)
PUT  /early-warning/context/{user_id}  Body: ContextualProfile { age, smoker, hypertension, cholesterol_known }
```

---

## SECTION 7: AI TRIAGE SERVICE

**Primary AI:** Claude `claude-sonnet-4-20250514` via Anthropic API
**Fallback AI:** Google Gemini `gemini-2.0-flash`
**Medical Context:** NCBI StatPearls (scraped via cheerio, extracts peer-reviewed medical article sections)

**Full triage flow:**
1. Patient submits symptoms text + optional image (base64)
2. System extracts keyword query from symptoms, searches NCBI StatPearls
3. Fetches and parses top result article (sections: pathophysiology, presentation, diagnosis, treatment)
4. Injects StatPearls context into AI prompt
5. Calls Claude with multi-modal prompt (text + image + StatPearls context)
6. Parses JSON response:
```json
{
  "triageLevel": 1-5,
  "possibleConditions": ["Condition A", "Condition B"],
  "recommendedAction": "Seek immediate ER care" | "Home care, monitor symptoms" | etc,
  "reasoning": "Clinical reasoning explanation"
}
```
7. Creates `TriageCase` in DB with status `PENDING_REVIEW` → queues for doctor
8. Doctor sees it in their queue, can: **APPROVE** (agree with AI) | **OVERRIDE** (disagree) | **REFER** (in-person needed)
9. Each doctor action triggers an email notification to patient via BullMQ + Resend

**Triage Levels:**
- Level 1: Resuscitation (Call 911/10177 immediately)
- Level 2: Emergency (ER within 15 minutes)
- Level 3: Urgent (Medical attention within 30 minutes)
- Level 4: Less-urgent (Nurse home visit appropriate)
- Level 5: Non-urgent (Home care / self-management)

---

## SECTION 8: NOTIFICATIONS & QUEUE

**BullMQ Queues** (Redis-backed, falls back to direct execution without Redis):
- `email` — Resend email delivery, 3 retries with exponential backoff
- `pdf-export` — Report generation jobs
- `push-notification` — Mobile push tokens

**Email triggers:**
- Payment receipt (ZAR amount, Paystack reference)
- Triage approved by doctor (final diagnosis included)
- Triage overridden by doctor (doctor notes + diagnosis)
- Triage referred (referral destination + notes)
- Visit approved by doctor (review text)
- Prescription ready (summary + instructions)
- System alerts

---

## SECTION 9: SECURITY & COMPLIANCE

**POPIA Compliance (South Africa's GDPR):**
- All addresses and SA ID numbers stored AES-encrypted
- `riskProfile` stored as minimal JSON (not full medical record)
- `AuditLog` model with SHA checksum on every sensitive action
- `preferredLanguage` defaults to `en-ZA`
- Data minimization throughout schema
- Medical disclaimers on ALL AI outputs: "Not a medical diagnosis. Tool for decision support only."

**JWT Security:**
- Access tokens: 15 minutes (configurable)
- Refresh tokens: 7 days, stored in DB, single-use rotation
- WebSocket authentication via token in query param

**Rate Limiting:**
- Auth endpoints: strict rate limiter
- Triage: rate limited with client-side cooldown timer
- General API: standard rate limiter

---

## SECTION 10: WHAT TO BUILD — THE DEMO APP

Build a **single-page React application** (or multi-page with React Router) that serves as a fully interactive demo of the entire Ahava platform. Use **mock data** that simulates realistic South African healthcare scenarios. Every feature listed below must be clickable, interactive, and show real data flows.

### Tech stack for demo:
- React 18 + Vite
- TailwindCSS for styling
- Lucide React for icons
- Recharts or Chart.js for biometric trend charts
- Mock data via JavaScript objects (no real backend needed — but structure API calls so they could be wired to the real backend by just changing the base URL)

### Brand Colors:
- Primary blue: `#004aad`
- Nurse green: `#34d399` / `#10b981`
- Doctor purple: `#8b5cf6` / `#7c3aed`
- Admin gray/dark: standard gray palette
- Alert RED: `#dc2626`, YELLOW: `#d97706`, GREEN: `#16a34a`
- Logo URL: `https://019beed4-58f9-79ea-8acd-d59b2c121f81.mochausercontent.com/Ahava-on-88-logo.png`

---

## SECTION 11: DEMO SCENARIOS & MOCK DATA

### Pre-loaded demo users:
```javascript
const DEMO_USERS = {
  patient: {
    id: "patient-001",
    name: "Thabo Nkosi",
    role: "PATIENT",
    email: "thabo.nkosi@demo.co.za",
    dateOfBirth: "1982-06-15",  // age 42
    riskProfile: { smoker: false, hypertension: true, cholesterolKnown: true, cholesterolValue: 6.2 }
  },
  nurse: {
    id: "nurse-001",
    name: "Nomvula Dlamini",
    role: "NURSE",
    sancId: "SANC-2019-07892",
    isVerified: true,
    location: { lat: -26.2041, lng: 28.0473 }  // Johannesburg
  },
  doctor: {
    id: "doctor-001",
    name: "Dr. Sipho Mahlangu",
    role: "DOCTOR",
    mpNumber: "MP-0089234"
  },
  admin: {
    id: "admin-001",
    name: "Admin User",
    role: "ADMIN"
  }
};
```

### Pre-loaded biometric history (simulate 21 days of data for baseline completion):
```javascript
// Day 1-14: Normal baseline values (Thabo's personal norms)
// Day 15-20: Gradual deterioration (rising HR, falling HRV)  
// Day 21 (today): RED alert triggered

const BIOMETRIC_HISTORY = [
  // Days 1-14: baseline normal
  { day: 1, hr: 68, hrv: 52, spo2: 98, rr: 15, steps: 8200, sleep: 7.2 },
  { day: 2, hr: 70, hrv: 49, spo2: 97, rr: 14, steps: 9100, sleep: 7.5 },
  // ... etc for 14 days (baseline established)
  
  // Days 15-20: creeping deterioration
  { day: 15, hr: 74, hrv: 45, spo2: 97, rr: 16, steps: 5200, sleep: 6.8 },
  { day: 16, hr: 76, hrv: 41, spo2: 97, rr: 16, steps: 4800, sleep: 6.2 },
  { day: 17, hr: 79, hrv: 37, spo2: 96, rr: 17, steps: 4100, sleep: 5.9 },
  { day: 18, hr: 82, hrv: 33, spo2: 96, rr: 18, steps: 3900, sleep: 5.5 },
  { day: 19, hr: 85, hrv: 28, spo2: 95, rr: 19, steps: 3200, sleep: 5.1 },
  
  // Day 20-21: RED alert zone
  { day: 20, hr: 89, hrv: 21, spo2: 94, rr: 21, steps: 2800, sleep: 4.8, alertLevel: "RED" },
  { day: 21, hr: 92, hrv: 18, spo2: 93, rr: 22, steps: 2200, sleep: 4.5, alertLevel: "RED" }
];

// Computed ML results for day 21:
const CURRENT_EARLY_WARNING = {
  alert_level: "RED",
  anomalies: [
    "heart_rate_resting (92) is 2.8σ from baseline (70.1)",
    "hrv_rmssd (18) is -3.1σ from baseline (50.2)",
    "spo2 (93) is -2.6σ from baseline (97.4)",
    "respiratory_rate (22) is 2.9σ from baseline (14.8)"
  ],
  risk_scores: {
    framingham_10y_pct: 22.4,
    qrisk3_10y_pct: 26.1,
    ml_cvd_risk_pct: 28.7,
    ml_confidence: 0.81
  },
  fusion: {
    trajectory_risk_2y_pct: 34.7,
    alert_triggered: true,
    alert_message: "High cardiovascular risk detected. Recommend clinical follow-up."
  },
  clinical_flags: ["HRV below threshold", "Resting HR above personal baseline"],
  hr_trend_2w: "rising",
  hrv_vs_baseline: "below",
  sleep_pattern: "disrupted",
  recommendations: [
    "High cardiovascular risk detected. Recommend clinical follow-up.",
    "Increase sleep duration to improve recovery.",
    "Low HRV may indicate stress. Try guided breathing.",
    "🔴 Resting heart rate elevated (+15% from baseline)",
    "   → Reduce caffeine & stress, get 8 hours sleep"
  ]
};
```

### Pre-loaded triage cases:
```javascript
const TRIAGE_CASES = [
  {
    id: "triage-001",
    patientName: "Thabo Nkosi",
    symptoms: "Severe chest tightness, shortness of breath when climbing stairs, occasional dizziness for the past 3 days",
    aiTriageLevel: 2,
    aiRecommendedAction: "Urgent: Seek medical attention within 15 minutes. Symptoms suggestive of acute coronary syndrome.",
    aiPossibleConditions: ["Acute Coronary Syndrome", "Unstable Angina", "Pulmonary Embolism"],
    aiReasoning: "Patient presents with classic anginal symptoms. Given age (42), hypertension, and elevated cholesterol, ACS must be ruled out urgently.",
    status: "PENDING_REVIEW",
    createdAt: "2024-01-15T08:23:11Z"
  },
  {
    id: "triage-002",
    patientName: "Zanele Mokoena",
    symptoms: "Persistent cough for 2 weeks, mild fever 37.8°C, fatigue, no shortness of breath",
    aiTriageLevel: 4,
    aiRecommendedAction: "Nurse home visit recommended within 24 hours. Monitor for deterioration.",
    aiPossibleConditions: ["Upper Respiratory Tract Infection", "Bronchitis", "Early Pneumonia"],
    aiReasoning: "Symptom duration and mild presentation suggests bacterial or viral URTI. Low acuity but persistent fever warrants professional evaluation.",
    status: "PENDING_REVIEW",
    createdAt: "2024-01-15T09:45:33Z"
  },
  {
    id: "triage-003",
    patientName: "Sipho Dube",
    symptoms: "Mild headache, stress at work, no other symptoms",
    aiTriageLevel: 5,
    aiRecommendedAction: "Home care appropriate. Rest, hydration, OTC pain relief if needed. See GP if worsens.",
    aiPossibleConditions: ["Tension Headache", "Stress-related headache"],
    aiReasoning: "Low-acuity presentation. No red flag symptoms. No urgent intervention needed.",
    status: "APPROVED",
    doctorNotes: "Agreed with AI assessment. Recommend lifestyle review.",
    finalDiagnosis: "Tension-type headache, likely stress-induced",
    createdAt: "2024-01-14T14:12:00Z"
  }
];
```

### Pre-loaded visit:
```javascript
const ACTIVE_VISIT = {
  id: "visit-001",
  patient: { name: "Zanele Mokoena", address: "45 Vilakazi Street, Orlando West, Soweto" },
  nurse: { name: "Nomvula Dlamini", phone: "+27 82 555 0192" },
  status: "EN_ROUTE",
  scheduledStart: "2024-01-15T10:30:00Z",
  gpsCoordinates: [
    { lat: -26.2041, lng: 28.0473, timestamp: "10:20:00" },
    { lat: -26.2189, lng: 28.0421, timestamp: "10:25:00" },
    { lat: -26.2312, lng: 28.0389, timestamp: "10:29:00" }  // approaching patient
  ],
  distanceFromPatient: "1.2 km"
};
```

---

## SECTION 12: REQUIRED DEMO SCREENS & INTERACTIONS

### SCREEN 1: ROLE SWITCHER / HOME
- Landing page with Ahava logo and tagline: *"Healthcare at your doorstep, powered by AI"*
- Four large role cards: Patient | Nurse | Doctor | Admin
- Each card shows role description and key capabilities
- Click → enters that role's demo dashboard (pre-logged in, no actual auth needed)
- Include a "Platform Overview" section showing the full system diagram

### SCREEN 2: PATIENT DASHBOARD
Must display and function:

**A. Health Status Bar (top)**
- Live-style readiness score: **47/100** with animated ring
- Alert status badge: 🔴 **RED ALERT — Cardiovascular Risk Detected**
- Days of baseline data: **21 days (complete)**

**B. Biometric Cards (3-column grid)**
- Heart Rate: **92 bpm** (↑ +2.8σ above baseline)
- HRV: **18 ms** (↓ -3.1σ below baseline — CRITICAL)
- SpO2: **93%** (↓ -2.6σ below baseline)
- Respiratory Rate: **22 bpm** (↑ elevated)
- All show trend arrows and deviation from personal baseline

**C. Early Warning Panel**
- 3 CVD risk algorithms displayed side by side:
  - Framingham 10y: **22.4%** (with tooltip explaining the algorithm)
  - QRISK3 10y: **26.1%** (enhanced with wearable data)
  - Custom ML: **28.7%** (confidence: 81%)
- Fusion trajectory: **"If trends continue: 34.7% risk in 2 years"**
- Clinical flags chips: "HRV below threshold", "Resting HR above personal baseline"
- Recommendations list with color-coded severity

**D. 21-Day Biometric Chart**
- Line chart: Heart Rate + HRV + SpO2 over time
- Annotated: day 1-14 = "Baseline Period" (green background), day 15+ = "Monitoring Period"
- Red vertical line at day 20 = "First RED alert triggered"
- X-axis: dates, Y-axis: normalized values
- Toggle which metrics to show

**E. 30-Day Anomaly Timeline**
- Calendar-style or list view of alert days
- Color coding: GREEN = no alerts, YELLOW = warning, RED = critical

**F. Action Buttons (Quick Actions)**
1. **"AI Symptom Analysis"** → Opens `SymptomAnalysisModal`
2. **"Request a Nurse"** → Opens `RequestNurseModal`
3. **"Diagnostic Vault"** → Navigates to diagnostic vault screen
4. **"Update Risk Profile"** → Modal to toggle smoker/hypertension/cholesterol

**G. SymptomAnalysisModal — MUST BE FULLY FUNCTIONAL**
- Text area: enter symptoms description
- Image upload: drag-and-drop or click (accepts images, shows preview, max 5 images)
- Rate limit indicator: after submit, shows 60-second cooldown timer
- On submit: show loading state "Analyzing with AI..."
- Returns mocked triage result:
```
Triage Level: 2 — Emergency
Possible conditions: Acute Coronary Syndrome, Unstable Angina
Recommended action: Seek immediate medical attention within 15 minutes
Reasoning: Symptoms combined with biometric data (elevated HR, low HRV) indicate elevated cardiovascular risk...
Disclaimer: ⚠️ Not a medical diagnosis. This assessment has been queued for doctor review.
```
- Show "Sent to Dr. Mahlangu for review" confirmation

**H. RequestNurseModal — MUST BE FULLY FUNCTIONAL**
- Date/time picker for scheduling
- Address input (pre-filled with patient address)
- Service type dropdown: General Wellness Check | Blood Pressure Monitoring | Wound Care | Medication Administration | Post-Surgery Care
- Duration estimate: 30min / 60min / 90min / 120min
- Payment method: Card (Paystack) | Medical Aid/Insurance
- Amount display in ZAR (e.g., R450.00 for 60-min visit)
- If Medical Aid: show insurance provider + member number fields
- On confirm: show "Booking created! Notifying nurses within 10km of your location..."
- Then show "Nurse Nomvula Dlamini accepted your booking" notification

**I. Baseline Modal**
- Shows progress: 21/14 days completed (100% with checkmark)
- Baseline stats table:
  - Personal HR baseline: 70.1 bpm
  - Personal HRV baseline: 50.2 ms  
  - Personal SpO2 baseline: 97.4%
  - Personal RR baseline: 14.8 bpm
- Explanation: "Your AI uses these personal norms to detect unusual patterns — not generic population ranges"

---

### SCREEN 3: NURSE DASHBOARD

**A. Status Toggle**
- Large toggle: OFFLINE ↔ ONLINE
- When toggled ON: "You are now available for home visits in your area"
- Shows "Broadcasting location to dispatch..." animation
- SANC verification badge: ✓ VERIFIED (SANC-2019-07892)

**B. Map View (simulated)**
- South Africa map centered on Johannesburg
- Nurse dot (green) at current location: Sandton, JHB
- Show 10km radius circle
- Patient request dots appearing within radius

**C. Incoming Booking Card (when online)**
- Patient: Zanele Mokoena (anonymized until accepted)
- Service: Upper Respiratory Assessment
- Distance: 3.2 km away
- Scheduled: Today at 10:30 AM
- Fee: R450 (ZAR)
- Two buttons: **Accept** | **Decline**
- On Accept: card animates away, shows "Booking confirmed! Navigate to patient →"
- Shows Google Maps directions link (mock)

**D. Active Visit Tracker**
- Status buttons: EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED
- GPS breadcrumb trail showing route taken
- Each status change: "Notified patient and dispatch"

**E. Visit Biometrics Recording Form**
- During IN_PROGRESS: show biometrics form
  - Blood Pressure: systolic/diastolic inputs
  - Heart Rate, SpO2, Temperature, Weight, Glucose
  - Submit → "Biometrics recorded and sent to supervising doctor"

**F. Treatment Recording**
- Medications table: name + dosage + frequency (add/remove rows)
- Procedures checkboxes: Wound cleaning | Medication injection | Blood draw | ECG | IV line
- Notes textarea
- Submit nurse report (encrypted indicator: 🔒 "Encrypted before storage")

**G. Panic Button (top nav, always visible)**
- Red button: **Emergency**
- Click → confirmation modal showing what happens:
  - "Your current GPS coordinates will be logged"
  - "Emergency contacts will be notified"
  - "Admin dashboard shows active alert"
  - "Emergency services: **10111 (Police) • 10177 (Ambulance)**"
- Click "Trigger Alert" → shows success: "Emergency alert sent. Your location has been logged."
- Alert appears instantly in Admin dashboard

---

### SCREEN 4: DOCTOR DASHBOARD

**A. Triage Queue**
- Header: "3 cases pending review"
- List of triage cases with urgency color coding
- Each card shows: patient (anonymized), triage level badge, AI confidence, time since submitted
- Click to expand full case

**B. Full Triage Case Detail**
- Patient info + symptoms
- AI findings panel (blue background):
  - Triage Level: `2 — Emergency` (with color-coded badge)
  - Possible Conditions: listed
  - AI Reasoning: full text
  - StatPearls Reference: "Informed by: StatPearls — Acute Coronary Syndromes" (with link)
- Biometric context panel (if biometrics submitted with triage):
  - "Patient's wearable shows: HR 92bpm (↑), HRV 18ms (↓), SpO2 93% (↓)"
  - "3 abnormal readings noted"

**C. Doctor Review Actions**
Three clearly differentiated action buttons:
1. **✓ Approve AI Assessment** → Input: optional final diagnosis override → Confirm → "Approval saved. Patient notified by email."
2. **⚠️ Override AI Assessment** → Textarea: doctor's notes + alternative diagnosis → Confirm → "Override recorded. Patient notified."
3. **→ Refer Patient** → Text input: "Referred to: [e.g., Cardiology at Helen Joseph Hospital]" + notes → Confirm → "Referral logged. Patient notified."

**D. Completed Visit Review Panel**
- List of completed nurse visits awaiting doctor review
- Visit detail: nurse report, biometrics recorded, treatment given
- Doctor review form: notes + 1-5 star rating
- "Approve and release report to patient" button

**E. Prescription Module**
- After approving a visit: option to generate prescription
- Medication list with dosage/frequency
- "Send prescription to patient" → email notification triggered

---

### SCREEN 5: ADMIN DASHBOARD

**A. Stats Overview Cards (live mock)**
- Total Users: **127**
- Active Patients: **89**
- Verified Nurses: **23**  
- Active Doctors: **8**
- Pending Triage Cases: **3**
- Active Panic Alerts: **1** (RED dot pulsing)
- Today's Bookings: **14**
- Revenue Today: **R6,300**

**B. Active Panic Alert Panel**
- 🚨 ACTIVE EMERGENCY ALERT
- Nurse: Nomvula Dlamini
- Location: 45 Vilakazi Street, Soweto (with map pin)
- Time triggered: 5 minutes ago
- Coordinates: -26.2312, 28.0389
- Status: ACTIVE
- Actions: "Mark Resolved" | "Call Nurse" | "Dispatch Emergency"

**C. User Management Table**
- Columns: Name | Email | Role | Status | Verified | Joined | Actions
- Filter by role: All | Patients | Nurses | Doctors | Admins
- Search by name/email
- Actions per row:
  - **Verify Nurse** (toggle isVerified) — shows SANC ID
  - **Deactivate** (toggle isActive)
  - **Change Role** dropdown
  - **Delete** (with confirmation)
- **"+ Add User"** button → modal form with all registration fields

**D. Triage Analytics**
- Pie chart: Approved vs Overridden vs Referred vs Pending
- Line chart: triage volume over last 7 days
- AI accuracy metric: "Doctors agreed with AI in 78% of cases"

**E. Recent Activity Log**
- Table: timestamp | user | action | resource
- Examples:
  - "Dr. Mahlangu approved triage case #001"
  - "Nurse Dlamini triggered panic alert"
  - "Patient Nkosi submitted biometrics — RED alert triggered"
  - "Booking #B-0024 accepted by nurse"

---

### SCREEN 6: DIAGNOSTIC VAULT (Patient)
- Grid of diagnostic reports
- Each report card: title, date, status (Pending Doctor Review | Released by Doctor)
- Released report detail view:
  - AI findings section
  - Doctor's assessment section
  - Diagnosis
  - Recommendations / prescription
- Download PDF button (simulated)
- Filter: All | AI Analysis | Nurse Visit Reports | Lab Results

---

### SCREEN 7: REAL-TIME VISIT TRACKER (shared view)
A split-screen showing the live visit from both sides:
- **Left panel (Patient view):**
  - Nurse status: EN_ROUTE
  - "Nurse Nomvula is 1.2km away, estimated arrival: 8 minutes"
  - Animated map with nurse location pulsing
  - Message thread (encrypted indicator)
  
- **Right panel (Nurse view):**
  - Patient address and navigation
  - Status update buttons
  - Quick message input

- **"Simulate Live Visit"** button that:
  1. Changes status to ARRIVED (nurse dot snaps to patient location)
  2. 3 seconds later → IN_PROGRESS
  3. Shows biometrics form
  4. After submitting biometrics → shows ML analysis on patient screen: "Alert: Elevated BP recorded during visit"
  5. 5 seconds later → COMPLETED
  6. Shows "Visit complete. Report sent to doctor for review."

---

## SECTION 13: GLOBAL DEMO CONTROLS

Include a **floating demo control panel** (bottom-right corner) with:
- **"Start Auto-Demo"** button — runs the full demo scenario automatically (60 seconds):
  1. Patient submits biometrics → RED alert appears
  2. Nurse goes online
  3. Patient books visit
  4. Nurse gets booking notification → accepts
  5. Visit status progresses EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED
  6. Triage case appears in doctor queue
  7. Doctor approves → email notification shown
  8. Admin sees panic alert → resolves it
  9. Report appears in patient diagnostic vault

- **"Reset Demo"** button — resets all state to initial values
- **"Role: Patient ▼"** quick role switcher dropdown

---

## SECTION 14: IMPLEMENTATION NOTES FOR CLAUDE

### Architecture pattern:
Use a single React context (`DemoContext`) that holds all mock state and provides:
```typescript
interface DemoState {
  currentRole: 'PATIENT' | 'NURSE' | 'DOCTOR' | 'ADMIN';
  currentUser: DemoUser;
  biometricHistory: BiometricReading[];
  currentEarlyWarning: EarlyWarningSummary;
  triageCases: TriageCase[];
  activeVisit: Visit;
  panicAlerts: PanicAlert[];
  bookings: Booking[];
  users: User[];
  notifications: Notification[];
  websocketEvents: WebSocketEvent[];
}
```

### Simulated real-time:
Use `setInterval` to simulate WebSocket events:
- Every 5 seconds when nurse is online: emit a `LOCATION_UPDATE` event
- During "live visit" demo: use `setTimeout` chains to progress visit status
- Panic button trigger: immediately adds alert to admin panel state

### API call simulation:
Wrap all "API calls" in async functions with realistic 800-1500ms delays using `setTimeout`:
```typescript
async function mockPost(endpoint: string, body: any): Promise<any> {
  await new Promise(r => setTimeout(r, 800 + Math.random() * 700));
  // return mock response based on endpoint
}
```

### Charts:
Use Recharts for all charts. Include:
1. Line chart: 21-day biometric history (HR, HRV, SpO2 on same chart, different Y-axes)
2. Area chart: readiness score trend
3. Bar chart: anomaly frequency by week
4. Gauge/radial chart: current readiness score (47/100)
5. Pie chart: triage case outcomes

### South African context throughout:
- All amounts in ZAR (R symbol)
- Phone numbers use +27 format
- Emergency numbers: 10111 (Police), 10177 (Ambulance), 112 (general)
- Location references: Johannesburg, Soweto, Sandton, Cape Town etc.
- SANC (South African Nursing Council) references
- POPIA compliance badges
- Languages: English with Zulu/Xhosa/Sotho names for patients/nurses

### Medical accuracy:
- All thresholds must be clinically accurate
- Normal HR: 60-100 bpm (resting)
- Normal HRV: 20-50ms (varies by age and fitness)
- Normal SpO2: 95-100%
- Normal respiratory rate: 12-20 bpm
- Hypertension threshold: systolic >140 or diastolic >90 mmHg
- Medical disclaimer on every AI output panel

### Accessibility / UX:
- All alert colors meet WCAG contrast ratios
- Loading states on every async action
- Error states with recovery options
- Tooltips explaining medical terms (e.g., "HRV = Heart Rate Variability, a measure of stress and recovery")
- Responsive layout (works on tablet for nurses in the field)

---

## SECTION 15: SUCCESS CRITERIA

The demo is complete when a viewer can:

1. ✅ See a patient's real-time biometric early warning in RED alert state with CVD risk scores from 3 algorithms
2. ✅ Submit a symptom description and receive an AI triage result (levels 1-5)
3. ✅ Book a nurse visit and watch a nurse receive the notification and accept it
4. ✅ Watch a nurse GPS-track to patient, record biometrics during visit, complete visit
5. ✅ See a doctor review AI triage cases and approve/override/refer with email notification triggered
6. ✅ Trigger a nurse panic button and see it appear instantly in admin dashboard
7. ✅ See an admin manage users, verify nurses, and view platform statistics
8. ✅ See a patient's diagnostic vault with released doctor-reviewed reports
9. ✅ Understand the 14-day baseline establishment process
10. ✅ See the full 3-algorithm CVD risk scoring with fusion trajectory projection

---

*End of brief. Build the complete demo app from this specification. All 7 screens must be functional with realistic mock data. The app should be deployable standalone (no backend required) but should document exactly which real API endpoint each mock call simulates.*
