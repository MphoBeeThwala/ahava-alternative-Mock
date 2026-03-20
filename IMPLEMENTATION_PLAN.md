# AHAVA HEALTHCARE — TECHNICAL REMEDIATION & GROWTH PLAN
**Author perspective:** Senior Developer (30yr), AI/Data Specialist, Healthcare Software Architect  
**Date:** March 2026  
**Scope:** Close all investor-identified gaps and build to Series A readiness

---

## EXECUTIVE ENGINEERING SUMMARY

Nine critical gaps were identified. They fall into three categories:

| Category | Gaps | Severity |
|---|---|---|
| **Platform Breaking** | In-memory ML storage, no wearable integration | P0 — fix before any live demo |
| **Value Proposition** | 14-day cold-start, SA-specific AI context, StatPearls fragility | P1 — fix before customer acquisition |
| **Scale Blockers** | Doctor oversight model, SANC verification, medical aid billing, marketplace cold-start, regulatory/legal | P2 — fix before Series A |

---

## PHASE 0: CRITICAL FIXES (Days 0–21)
*Platform is currently unshowable to real patients. Fix these first.*

---

### FIX 1: Replace In-Memory ML Store with TimescaleDB

**The Problem:**  
`engine.py` line 11: `DATA_STORE: Dict[str, List[BiometricData]] = {}` — all biometric baselines are lost on every server restart. A health monitoring platform that forgets its patients is not a health monitoring platform.

**Why TimescaleDB (not InfluxDB):**  
You already run PostgreSQL via Prisma. TimescaleDB is a PostgreSQL extension — same connection string, same DB instance, adds time-series hypertable superpowers. Zero new infrastructure. InfluxDB is a separate service, separate query language, operational overhead you don't need at this stage.

**Implementation:**

**Step 1 — Enable TimescaleDB on your PostgreSQL instance (Railway)**
```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

**Step 2 — Create the hypertable (run as a raw migration)**
```sql
CREATE TABLE biometric_time_series (
    time         TIMESTAMPTZ NOT NULL,
    user_id      TEXT NOT NULL,
    hr_resting   DOUBLE PRECISION,
    hrv_rmssd    DOUBLE PRECISION,
    spo2         DOUBLE PRECISION,
    resp_rate    DOUBLE PRECISION,
    step_count   INTEGER,
    active_cals  DOUBLE PRECISION,
    sleep_hrs    DOUBLE PRECISION,
    skin_temp    DOUBLE PRECISION,
    ecg_rhythm   TEXT DEFAULT 'unknown',
    temp_trend   TEXT DEFAULT 'normal',
    alert_level  TEXT DEFAULT 'GREEN',
    anomalies    JSONB DEFAULT '[]',
    source       TEXT DEFAULT 'manual'
);

SELECT create_hypertable('biometric_time_series', 'time');
CREATE INDEX ON biometric_time_series (user_id, time DESC);

-- Auto-compress chunks older than 30 days
SELECT add_compression_policy('biometric_time_series', INTERVAL '30 days');
```

**Step 3 — Replace engine.py data layer**

In `apps/ml-service/engine.py`, replace the in-memory store with a DB adapter:

```python
# apps/ml-service/db.py  — NEW FILE
import os
import psycopg2
import psycopg2.extras
from typing import List, Optional
from models import BiometricData, ContextualProfile
from datetime import datetime

DATABASE_URL = os.getenv("DATABASE_URL")

def get_conn():
    return psycopg2.connect(DATABASE_URL)

def save_biometric(user_id: str, data: BiometricData, alert_level: str, anomalies: list):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO biometric_time_series 
                (time, user_id, hr_resting, hrv_rmssd, spo2, resp_rate, 
                 step_count, active_cals, sleep_hrs, skin_temp, ecg_rhythm,
                 temp_trend, alert_level, anomalies)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                data.timestamp, user_id,
                data.heart_rate_resting, data.hrv_rmssd, data.spo2,
                data.respiratory_rate, data.step_count, data.active_calories,
                data.sleep_duration_hours, data.skin_temp_offset,
                data.ecg_rhythm, data.temperature_trend,
                alert_level, psycopg2.extras.Json(anomalies)
            ))

def load_biometrics(user_id: str, days: int = 30) -> List[dict]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM biometric_time_series
                WHERE user_id = %s 
                  AND time > NOW() - INTERVAL '%s days'
                ORDER BY time ASC
            """, (user_id, days))
            return cur.fetchall()

def save_context(user_id: str, ctx: ContextualProfile):
    # Store in Prisma User.riskProfile JSON field via backend API call
    # ML service calls backend PUT /api/patient/risk-profile — keeps data in one DB
    pass

def load_context(user_id: str) -> Optional[dict]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                'SELECT "riskProfile" FROM "User" WHERE id = %s', (user_id,)
            )
            row = cur.fetchone()
            return row["riskProfile"] if row else None
```

**Step 4 — Refactor engine.py to use DB layer**

Replace all `DATA_STORE[user_id]` and `CONTEXT_STORE[user_id]` references:
```python
# engine.py — ingest method (before)
DATA_STORE.setdefault(user_id, []).append(data)

# engine.py — ingest method (after)
from db import save_biometric, load_biometrics
save_biometric(user_id, data, alert_level.value, anomalies)

# engine.py — baseline calculation (before)  
records = DATA_STORE.get(user_id, [])

# engine.py — baseline calculation (after)
records = load_biometrics(user_id, days=21)
```

**Add to `apps/ml-service/requirements.txt`:**
```
psycopg2-binary==2.9.9
```

**Estimated effort:** 1 developer, 3 days  
**Risk:** Low — same DB, surgical refactor

---

### FIX 2: Make StatPearls Resilient

**The Problem:**  
`statPearls.ts` scrapes NCBI HTML with cheerio. NCBI changes their HTML structure approximately every 6-12 months. When it breaks, all AI triage loses its medical context — silently, with no alert. The triage still runs, but on the AI's training data only.

**Solution: 3-tier fallback chain + cache**

```typescript
// apps/backend/src/services/statPearls.ts — refactored

import * as cheerio from "cheerio";
import Redis from "ioredis";

const CACHE_TTL_SECONDS = 86400; // 24 hours
let redis: Redis | null = null;

// Lazy Redis connection (only if REDIS_URL set)
function getRedis(): Redis | null {
  if (!redis && process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL);
  }
  return redis;
}

export async function getMedicalContext(symptoms: string): Promise<string | null> {
  const query = extractSearchQuery(symptoms);
  if (!query) return null;

  // Tier 1: Redis cache
  const r = getRedis();
  const cacheKey = `statpearls:${query.slice(0, 50)}`;
  if (r) {
    const cached = await r.get(cacheKey).catch(() => null);
    if (cached) return cached;
  }

  // Tier 2: External StatPearls proxy service (if configured)
  if (process.env.STATPEARLS_SERVICE_URL) {
    const result = await fetchFromStatPearlsService(process.env.STATPEARLS_SERVICE_URL, query);
    if (result) {
      await r?.setex(cacheKey, CACHE_TTL_SECONDS, result).catch(() => null);
      return result;
    }
  }

  // Tier 3: Direct NCBI scrape
  try {
    const result = await fetchFromNcbi(symptoms);
    if (result) {
      await r?.setex(cacheKey, CACHE_TTL_SECONDS, result).catch(() => null);
      return result;
    }
  } catch (err) {
    console.warn("[statPearls] NCBI scrape failed:", err);
  }

  // Tier 4: SA-specific local fallback context
  return getSAFallbackContext(query);
}

// SA-specific fallback — hardcoded high-frequency SA conditions
function getSAFallbackContext(query: string): string | null {
  const q = query.toLowerCase();
  const saContextMap: Record<string, string> = {
    "chest pain": "## Chest Pain — SA Clinical Context\nIn South Africa, ACS risk is elevated due to high hypertension prevalence (46% of adults). Rheumatic heart disease remains prevalent in under-35s. Rule out TB pericarditis in HIV-positive patients presenting with chest pain.",
    "respiratory": "## Respiratory — SA Clinical Context\nSA has the world's highest TB burden (322/100k). Differential for productive cough includes TB, CAP, bronchitis. HIV co-infection elevates pneumocystis risk. COVID-19 remains endemic.",
    "fever": "## Fever — SA Clinical Context\nIn SA febrile patients, malaria must be excluded in Limpopo/Mpumalanga/KZN. Typhoid, rickettsia, and tick-bite fever are endemic. HIV viral illness is common.",
    "headache": "## Headache — SA Clinical Context\nCryptococcal meningitis presents with headache in immunocompromised patients (CD4 <100). TB meningitis is endemic. Tension-type and migraine are most common in healthy patients.",
  };

  for (const [key, context] of Object.entries(saContextMap)) {
    if (q.includes(key)) return context;
  }
  return null;
}
```

**Estimated effort:** 1 developer, 1 day  
**Impact:** Eliminates silent triage degradation, adds SA clinical context layer

---

## PHASE 1: VALUE PROPOSITION HARDENING (Days 22–75)
*Make the platform genuinely valuable from Day 1 for real users.*

---

### BUILD 1: Day-1 Value — Progressive Baseline

**The Problem:**  
New patients wait 14 days with no early-warning value. In consumer health, this equals 100% churn before the product proves itself.

**Solution: 4-stage progressive confidence model**

```
Day 1-3:   PROVISIONAL baseline (demographic averages + age/gender adjustment)
Day 4-7:   CALIBRATING baseline (50% personal data + 50% demographic)
Day 8-13:  PERSONALISING baseline (90% personal data, narrow CI)
Day 14+:   PERSONAL baseline (fully personalised, 100% your data)
```

**Database changes — add to Prisma schema:**
```prisma
model UserBaseline {
  id              String   @id @default(cuid())
  userId          String   @unique
  
  // Personal baselines (populated progressively)
  hrMean          Float?
  hrStd           Float?
  hrvMean         Float?
  hrvStd          Float?
  spo2Mean        Float?
  spo2Std         Float?
  rrMean          Float?
  rrStd           Float?
  
  // Demographic seed baseline (used until personal data is sufficient)
  demographicSeed Json?    // { age_group, gender, fitness_level → preset values }
  
  // Confidence metadata
  dataPointCount  Int      @default(0)
  confidencePct   Int      @default(0)   // 0-100
  stage           String   @default("PROVISIONAL") // PROVISIONAL|CALIBRATING|PERSONALISING|PERSONAL
  lastCalculated  DateTime?
  
  user            User     @relation(fields: [userId], references: [id])
}
```

**Demographic seed values table (based on WHO/SA NDoH data):**
```typescript
// apps/backend/src/services/baselineSeed.ts

interface DemographicSeed {
  hrMean: number; hrStd: number;
  hrvMean: number; hrvStd: number;
  spo2Mean: number; spo2Std: number;
  rrMean: number; rrStd: number;
}

export function getDemographicBaseline(age: number, gender: string): DemographicSeed {
  // SA-adjusted reference values (sub-Saharan African cohort norms)
  const base: DemographicSeed = { hrMean: 72, hrStd: 10, hrvMean: 42, hrvStd: 15, spo2Mean: 97.5, spo2Std: 1.2, rrMean: 15, rrStd: 3 };
  
  if (age > 50) { base.hrMean += 3; base.hrvMean -= 8; }
  if (age > 65) { base.hrMean += 5; base.hrvMean -= 12; base.spo2Mean -= 0.5; }
  if (gender === 'FEMALE') { base.hrMean += 3; base.hrvMean -= 5; }
  return base;
}

// Blend function: mix personal + demographic based on days of data
export function blendBaseline(personal: DemographicSeed, demographic: DemographicSeed, personalWeight: number): DemographicSeed {
  const w = Math.min(1, personalWeight); // 0.0-1.0
  return {
    hrMean: personal.hrMean * w + demographic.hrMean * (1 - w),
    hrStd: personal.hrStd * w + demographic.hrStd * (1 - w),
    hrvMean: personal.hrvMean * w + demographic.hrvMean * (1 - w),
    hrvStd: personal.hrvStd * w + demographic.hrvStd * (1 - w),
    spo2Mean: personal.spo2Mean * w + demographic.spo2Mean * (1 - w),
    spo2Std: personal.spo2Std * w + demographic.spo2Std * (1 - w),
    rrMean: personal.rrMean * w + demographic.rrMean * (1 - w),
    rrStd: personal.rrStd * w + demographic.rrStd * (1 - w),
  };
}
```

**Update ML engine to use blended baseline:**
```python
# engine.py — calculate_baseline() method update

def calculate_baseline(self, user_id: str) -> dict:
    records = load_biometrics(user_id, days=21)
    data_points = len(records)
    
    if data_points == 0:
        # Day 1: full demographic seed — pulled from backend API
        return self._get_demographic_seed(user_id)
    
    # Personal weight: 0 at day 0, 1.0 at day 14+
    personal_weight = min(1.0, data_points / 14.0)
    
    df = pd.DataFrame(records)
    personal = {col: {"mean": df[col].mean(), "std": df[col].std()} 
                for col in BASELINE_METRICS if col in df}
    
    seed = self._get_demographic_seed(user_id)
    
    blended = {}
    for metric in BASELINE_METRICS:
        if metric in personal and not np.isnan(personal[metric]["mean"]):
            blended[metric] = {
                "mean": personal[metric]["mean"] * personal_weight + seed[metric]["mean"] * (1 - personal_weight),
                "std": max(personal[metric]["std"] * personal_weight + seed[metric]["std"] * (1 - personal_weight), 0.1),
            }
        else:
            blended[metric] = seed[metric]
    
    confidence = int(min(100, (data_points / 14.0) * 100))
    stage = "PROVISIONAL" if data_points < 4 else "CALIBRATING" if data_points < 8 else "PERSONALISING" if data_points < 14 else "PERSONAL"
    
    return {"blended": blended, "confidence": confidence, "stage": stage, "data_points": data_points}
```

**Frontend change — replace "No data" empty states:**
```typescript
// Instead of: "Connect your wearable to start tracking"
// Show:       Readiness score from Day 1 with confidence badge

<div className="flex items-center gap-2">
  <span className="text-3xl font-bold">{readinessScore}</span>
  <div className="flex flex-col">
    <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
      {stage === "PROVISIONAL" ? "Population baseline" : 
       stage === "CALIBRATING" ? `${confidence}% personalised` :
       stage === "PERSONALISING" ? `${confidence}% personalised` : "Your personal baseline"}
    </span>
    <span className="text-xs text-gray-400">{dataPoints} readings</span>
  </div>
</div>
```

**Estimated effort:** 2 developers, 8 days  
**Impact:** Eliminates the 14-day cliff. Users see meaningful health data from the first biometric reading.

---

### BUILD 2: Wearable Integration via Terra API

**Why Terra API:**  
Terra (tryterra.co) is a single OAuth2 integration that covers 50+ wearable devices: Apple Health, Fitbit, Garmin, Samsung Health, Oura Ring, Polar, Withings, Whoop, Google Fit. One integration replaces six separate SDK implementations. SA-appropriate pricing (~$0.02/user/month at scale).

**Architecture:**
```
Wearable Device → Terra Cloud → Webhook → Backend /webhooks/terra → BiometricReading DB → ML Service
```

**Step 1 — New Terra webhook route:**
```typescript
// apps/backend/src/routes/webhooks.ts — add Terra handler

import crypto from 'crypto';

router.post('/terra', express.raw({ type: 'application/json' }), async (req, res) => {
  // Verify Terra webhook signature
  const signature = req.headers['terra-signature'] as string;
  const expectedSig = crypto
    .createHmac('sha256', process.env.TERRA_WEBHOOK_SECRET!)
    .update(req.body)
    .digest('hex');
  
  if (signature !== expectedSig) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = JSON.parse(req.body.toString());
  const { type, user, data } = payload;

  // Find Ahava user linked to this Terra user
  const linkedUser = await prisma.user.findFirst({
    where: { terraUserId: user.user_id }
  });
  if (!linkedUser) return res.status(200).json({ received: true }); // Not our user

  if (type === 'DAILY' && data?.length > 0) {
    await processTerraDaily(linkedUser.id, data[0]);
  } else if (type === 'BODY' && data?.length > 0) {
    await processTerraBody(linkedUser.id, data[0]);
  } else if (type === 'SLEEP' && data?.length > 0) {
    await processTerraSleep(linkedUser.id, data[0]);
  }

  res.status(200).json({ received: true });
});

async function processTerraDaily(userId: string, day: any) {
  // Terra DAILY payload → Ahava BiometricReading
  const reading = {
    userId,
    heartRate: day.heart_rate_data?.summary?.avg_hr_bpm,
    heartRateResting: day.heart_rate_data?.summary?.resting_hr_bpm,
    hrvRmssd: day.heart_rate_data?.summary?.hrv_rmssd_sdnn, // Terra provides this
    oxygenSaturation: day.oxygen_data?.avg_saturation_percentage,
    respiratoryRate: day.respiration_data?.avg_breaths_per_min,
    stepCount: day.distance_data?.steps,
    activeCalories: day.calories_data?.net_activity_calories,
    source: 'wearable',
    deviceType: day.metadata?.device_type || 'unknown',
    recordedAt: new Date(day.metadata?.end_time),
  };

  // Save to BiometricReading and send to ML service
  await prisma.biometricReading.create({ data: reading });
  
  // Fire-and-forget to ML service
  axios.post(`${process.env.ML_SERVICE_URL}/ingest?user_id=${userId}`, {
    timestamp: reading.recordedAt,
    heart_rate_resting: reading.heartRateResting,
    hrv_rmssd: reading.hrvRmssd,
    spo2: reading.oxygenSaturation,
    respiratory_rate: reading.respiratoryRate,
    step_count: reading.stepCount,
    active_calories: reading.activeCalories,
    skin_temp_offset: 0,
    sleep_duration_hours: 0, // Comes from SLEEP payload
    ecg_rhythm: 'unknown',
    temperature_trend: 'normal',
  }).catch(err => console.warn('[terra] ML ingest failed:', err.message));
}
```

**Step 2 — Add to Prisma schema:**
```prisma
model User {
  ...
  terraUserId    String?   @unique  // Terra user_id for webhook linking
  connectedDevices String[] @default([])  // ["apple_health", "fitbit", "garmin"]
}
```

**Step 3 — Patient Dashboard: Device Connection Flow:**
```typescript
// New component: ConnectWearableModal.tsx
// 1. User clicks "Connect Wearable"
// 2. Call GET /api/patient/terra/auth-url → backend calls Terra API for OAuth URL
// 3. Redirect to Terra OAuth (user selects Apple Health / Fitbit / etc.)
// 4. Terra redirects back to /auth/terra/callback?code=xxx
// 5. Backend exchanges code, saves terraUserId on user record
// 6. From that point: Terra sends daily webhooks automatically

// Backend: GET /api/patient/terra/auth-url
router.get('/terra/auth-url', authMiddleware, async (req, res) => {
  const response = await axios.post('https://api.tryterra.co/v2/auth/generateWidgetSession', {
    reference_id: req.user!.id,  // Links Terra user back to our user
    language: 'en',
  }, { 
    headers: { 'dev-id': process.env.TERRA_DEV_ID, 'x-api-key': process.env.TERRA_API_KEY } 
  });
  res.json({ url: response.data.url });
});
```

**Add to `.env`:**
```
TERRA_DEV_ID=your_terra_dev_id
TERRA_API_KEY=your_terra_api_key
TERRA_WEBHOOK_SECRET=your_terra_webhook_secret
```

**Estimated effort:** 2 developers, 6 days  
**Cost:** Terra API ~$99/month for up to 5,000 users (starter plan)  
**Impact:** Passive wearable data — the flagship monitoring feature now actually works hands-free.

---

## PHASE 2: OPERATIONAL MODEL (Days 76–150)
*Make the platform commercially operable — address the people and process gaps.*

---

### BUILD 3: Doctor Oversight Operational System

**The Problem:**  
The triage queue has no SLA enforcement, no doctor scheduling, no escalation, no compensation model. It's a queue going nowhere.

**Database additions:**
```prisma
model DoctorSession {
  id          String   @id @default(cuid())
  doctorId    String
  startsAt    DateTime
  endsAt      DateTime
  maxCases    Int      @default(20)  // Session capacity
  isActive    Boolean  @default(true)
  casesReviewed Int    @default(0)
  doctor      User     @relation(fields: [doctorId], references: [id])
}

model TriageCase {
  ...
  slaDeadline     DateTime?   // Set on creation based on urgency level
  escalatedAt     DateTime?   // Set if SLA missed
  escalationLevel Int         @default(0)  // 0=normal, 1=escalated, 2=critical
  reviewedWithinSla Boolean?
  
  // Compensation tracking
  doctorFeeCents  Int?        // ZAR cents paid to reviewing doctor
  feePaid         Boolean     @default(false)
}
```

**SLA rules by triage level:**
```typescript
// apps/backend/src/services/triageSLA.ts

export const TRIAGE_SLA_MINUTES: Record<number, number> = {
  1: 5,    // Level 1 (Resuscitation) — alert admin immediately, 5min SLA
  2: 30,   // Level 2 (Emergency) — 30 minutes
  3: 60,   // Level 3 (Urgent) — 1 hour
  4: 240,  // Level 4 (Less urgent) — 4 hours
  5: 480,  // Level 5 (Non-urgent) — 8 hours
};

export const DOCTOR_FEE_CENTS: Record<number, number> = {
  1: 15000,  // R150 — critical case review
  2: 10000,  // R100
  3: 7500,   // R75
  4: 5000,   // R50
  5: 3000,   // R30
};
```

**Escalation cron job (runs every 5 minutes):**
```typescript
// apps/backend/src/jobs/triageEscalation.ts

import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { notifySystem } from '../services/notifications';

const prisma = new PrismaClient();

export function startTriageEscalationJob() {
  cron.schedule('*/5 * * * *', async () => {
    const now = new Date();
    
    // Find overdue cases
    const overdue = await prisma.triageCase.findMany({
      where: {
        status: 'PENDING_REVIEW',
        slaDeadline: { lt: now },
        escalationLevel: { lt: 2 },
      },
      include: { patient: { select: { email: true, firstName: true } } }
    });

    for (const tc of overdue) {
      const newLevel = tc.escalationLevel + 1;
      
      await prisma.triageCase.update({
        where: { id: tc.id },
        data: { escalationLevel: newLevel, escalatedAt: now },
      });

      // Notify all available doctors + admin
      const adminEmails = await prisma.user.findMany({
        where: { role: 'ADMIN', isActive: true },
        select: { email: true }
      });
      
      for (const admin of adminEmails) {
        await notifySystem({
          to: admin.email,
          subject: `⚠️ Triage SLA Breach — Level ${tc.aiTriageLevel} case`,
          message: `Triage case ${tc.id} has breached SLA (Level ${tc.aiTriageLevel}). Escalation level: ${newLevel}. Patient: ${tc.patient.firstName}`,
        });
      }
    }
  });
}
```

**Doctor recruitment operational model:**

| Doctor Type | Engagement Model | Compensation | Volume |
|---|---|---|---|
| Part-time GP (SA-registered) | Per-session contract (2hr blocks) | R75-150/case + R500 session base | 10-30 cases/session |
| Specialist (cardiology, GP-with-interest) | On-call for Level 1-2 only | R150-300/case | <5/day |
| Registrar (supervised) | During daylight hours | R40-60/case | High volume |

**Partner targets:** Intercare, Clicks Clinics, Dis-Chem Pharmacy Health Clinics, Netcare Medicross — all have GPs who could take on-call shifts for supplement income.

**Estimated effort:** 2 developers + 1 ops person, 3 weeks  
**Cost:** ~R15-50/triage case in doctor fees — build into visit pricing

---

### BUILD 4: SANC Verification System

**The Problem:**  
Nurse `isVerified` flag is set manually by admin toggling a field. If a fraudulent nurse causes patient harm, this is a liability gap with no audit trail.

**Solution: Download-and-match SANC register**

SANC publishes its full nurse register as a downloadable dataset (updated quarterly). We import and query it locally — no dependence on SANC's slow systems.

```typescript
// apps/backend/src/services/sancVerification.ts

interface SANCRecord {
  registrationNumber: string;
  firstName: string;
  lastName: string;
  category: string;       // "Professional Nurse", "Enrolled Nurse", etc.
  registrationStatus: string;  // "Active", "Suspended", "Cancelled"
  expiryDate: Date;
}

// Database table for SANC register
// Prisma model:
// model SancRegister {
//   id                 String @id @default(cuid())
//   registrationNumber String @unique
//   firstName          String
//   lastName           String
//   category           String
//   status             String
//   expiryDate         DateTime?
//   importedAt         DateTime @default(now())
// }

export async function verifySANCRegistration(
  sancId: string, 
  firstName: string, 
  lastName: string
): Promise<{
  verified: boolean;
  status: string;
  category: string | null;
  message: string;
}> {
  const record = await prisma.sancRegister.findUnique({
    where: { registrationNumber: sancId.toUpperCase() }
  });

  if (!record) {
    return { verified: false, status: 'NOT_FOUND', category: null, message: 'SANC number not found in register' };
  }

  if (record.status !== 'Active') {
    return { verified: false, status: record.status, category: null, message: `Registration is ${record.status}` };
  }

  if (record.expiryDate && record.expiryDate < new Date()) {
    return { verified: false, status: 'EXPIRED', category: null, message: 'Registration has expired' };
  }

  // Fuzzy name match (handle name order variations and SA name transcription differences)
  const nameMatch = fuzzyNameMatch(
    `${firstName} ${lastName}`,
    `${record.firstName} ${record.lastName}`
  );

  if (!nameMatch) {
    return { verified: false, status: 'NAME_MISMATCH', category: null, message: 'Name does not match SANC records' };
  }

  return { verified: true, status: 'Active', category: record.category, message: 'Verified against SANC register' };
}

// Run weekly via cron to refresh the register
export async function importSANCRegister(csvPath: string) {
  // Parse SANC CSV export, upsert into SancRegister table
  // Log the import with record count for audit trail
}
```

**Webhook trigger on nurse registration:**
```typescript
// In auth.ts register route — after user creation for NURSE role:
if (role === 'NURSE' && req.body.sancId) {
  const verification = await verifySANCRegistration(
    req.body.sancId, firstName, lastName
  );
  
  await prisma.user.update({
    where: { id: user.id },
    data: {
      sancId: req.body.sancId,
      isVerified: verification.verified,
      sancVerificationStatus: verification.status,
      sancVerificationDate: new Date(),
      sancCategory: verification.category,
    }
  });
}
```

**Add to admin dashboard:** Auto-verification status + "Manually Override" button with mandatory audit log entry.

**Estimated effort:** 1 developer, 4 days  
**Legal note:** Confirm with SANC that local register import is permitted under their data terms — typically yes for licensed platforms.

---

## PHASE 3: REVENUE INFRASTRUCTURE (Days 151–300)

---

### BUILD 5: Medical Aid Billing via Healthbridge

**Why Healthbridge:**  
Healthbridge is South Africa's dominant healthcare EDI clearinghouse — 600,000+ claims processed daily, integrated with Discovery Health, Medihelp, Bonitas, Momentum Health, Fedhealth, GEMS. This is not a nice-to-have; this is access to the R234 billion South African medical scheme market.

**Prerequisites (must complete before technical build):**
1. Register as a healthcare service provider with HPCSA (or partner with an existing registered entity)
2. Obtain a Practice Number from HPCSA
3. Apply for Healthbridge trading partner status (~4-8 weeks)
4. Obtain ICD-10 training for clinical staff and coders

**Database additions:**
```prisma
model Visit {
  ...
  icd10Codes          String[]     // ["J06.9", "Z71.1"] — SA NDoH ICD-10
  bhfTariffCode       String?      // BHF tariff code for home nursing visit
  claimReference      String?      // Healthbridge claim reference
  preAuthNumber       String?      // Medical aid pre-auth number
  claimStatus         String?      // SUBMITTED|ACKNOWLEDGED|PAID|REJECTED
  claimAmountCents    Int?         // Amount claimed in ZAR cents
  paidAmountCents     Int?         // Amount actually paid by scheme
  rejectionReason     String?
  claimSubmittedAt    DateTime?
  claimPaidAt         DateTime?
}
```

**Healthbridge integration service:**
```typescript
// apps/backend/src/services/healthbridge.ts

interface ClaimSubmission {
  practiceNumber: string;
  patientMemberNumber: string;
  schemeCode: string;          // "DIS" for Discovery, "MED" for Medihelp, etc.
  principalMember: string;
  icd10Codes: string[];
  tariffCode: string;          // e.g. "0190" for home nursing consultation
  serviceDate: Date;
  amountCents: number;
  attendingPractitionerNumber: string;  // Doctor's HPCSA practice number
  serviceType: string;         // "09" = home visit
}

export async function submitClaim(claim: ClaimSubmission): Promise<{
  success: boolean;
  reference: string | null;
  message: string;
}> {
  // Healthbridge accepts HL7 FHIR R4 or their proprietary HBXML format
  // Use FHIR R4 Claim resource (more future-proof)
  const fhirClaim = buildFHIRClaim(claim);
  
  const response = await axios.post(
    `${process.env.HEALTHBRIDGE_URL}/fhir/Claim`,
    fhirClaim,
    {
      headers: {
        'Authorization': `Bearer ${await getHealthbridgeToken()}`,
        'Content-Type': 'application/fhir+json',
      }
    }
  );
  
  return {
    success: response.data.outcome === 'complete',
    reference: response.data.id,
    message: response.data.text?.div || 'Claim submitted',
  };
}

// Common BHF tariff codes for Ahava services
export const BHF_TARIFFS = {
  HOME_NURSING_VISIT_30MIN: '0190',
  HOME_NURSING_VISIT_60MIN: '0191',
  BLOOD_PRESSURE_MONITORING: '0164',
  WOUND_CARE: '0163',
  MEDICATION_ADMINISTRATION: '0165',
  ECG: '0332',
  GLUCOSE_MONITORING: '3001',
};
```

**Auto-submission flow:**
```typescript
// After visit status set to COMPLETED:
if (visit.paymentMethod === 'INSURANCE' && visit.insuranceMemberNumber) {
  const claimResult = await submitClaim({
    practiceNumber: process.env.HPCSA_PRACTICE_NUMBER!,
    patientMemberNumber: booking.insuranceMemberNumber,
    schemeCode: getSchemeCode(booking.insuranceProvider),
    icd10Codes: visit.icd10Codes,
    tariffCode: BHF_TARIFFS[visit.serviceType] || BHF_TARIFFS.HOME_NURSING_VISIT_60MIN,
    serviceDate: visit.actualEnd,
    amountCents: booking.amountInCents,
    attendingPractitionerNumber: nurse.hpcsa_number,
    serviceType: '09',
  });
  
  await prisma.visit.update({
    where: { id: visit.id },
    data: {
      claimReference: claimResult.reference,
      claimStatus: claimResult.success ? 'SUBMITTED' : 'FAILED',
      claimSubmittedAt: new Date(),
    }
  });
}
```

**Timeline reality check:** Plan 18 months from now for medical aid revenue to flow. Use this time to build relationships with scheme managed care teams (Discovery Health's WholeView, Medihelp's Managed Care) — enterprise partnerships are faster than member billing.

---

### BUILD 6: South African AI Context Layer

**The Problem:**  
StatPearls is predominantly American clinical content. South Africa's leading causes of morbidity and mortality differ significantly (TB, HIV, rheumatic heart disease, high trauma burden, malnutrition, load-shedding-related medication non-compliance for insulin-dependent diabetics).

**Solution: SA Clinical Prompt Engineering + Local Knowledge Base**

```typescript
// apps/backend/src/services/aiTriage.ts — update system prompt

const SA_CLINICAL_CONTEXT = `
You are a clinical decision support assistant operating in South Africa.

SOUTH AFRICAN DISEASE BURDEN CONTEXT:
- TB incidence: 322/100,000 (highest globally). Always include TB in respiratory differentials.
- HIV prevalence: 13.7% of adults. HIV must be considered in ALL immunocompromised presentations.
- Rheumatic heart disease: remains prevalent in patients under 40 (unlike high-income countries).
- Malaria: endemic in Limpopo, Mpumalanga, KwaZulu-Natal lowlands. Ask about travel.
- Tick-bite fever (Rickettsia): common cause of fever+rash in SA.
- Cryptococcal meningitis: common in HIV+ patients with CD4 <100. Presents as headache.
- Non-communicable diseases: hypertension 46% adult prevalence, diabetes 13%, obesity 28%.
- Socioeconomic factors: food insecurity affects 25% — consider malnutrition in children.
- Medication access: public sector supply interruptions common — assess adherence context.

TRIAGE LEVEL DEFINITIONS (SATS - South African Triage Scale):
- Level 1 (Red/Immediate): Airway compromise, GCS<9, systolic BP<80, SpO2<85%
- Level 2 (Orange/Very urgent): Severe pain, SpO2 85-92%, systolic 80-90, fitting
- Level 3 (Yellow/Urgent): Moderate distress, SpO2 93-95%, abnormal vitals not critical  
- Level 4 (Green/Less urgent): Minor illness, stable vitals, ambulatory
- Level 5 (Blue/Non-urgent): Administrative, prescription refill, chronic stable

USE SATS LEVELS, NOT MANCHESTER TRIAGE SYSTEM.

IMPORTANT DISCLAIMERS:
- Always note: "This assessment is a clinical decision support tool only."
- Always note: "A registered healthcare professional must examine the patient before diagnosis."
- For Level 1-2: explicitly instruct: "Call 10177 (ambulance) immediately."
`;
```

**Build a local SA medical knowledge store:**
```typescript
// apps/backend/src/services/saKnowledgeBase.ts
// Curate from:
// - SA National Department of Health clinical guidelines (public domain)
// - NICD (National Institute for Communicable Diseases) guidelines
// - SAMJ (South African Medical Journal) open-access articles
// - SA HIV Clinicians Society guidelines

const SA_CONDITION_PROTOCOLS: Record<string, string> = {
  "TB": `Standard First-Line: RHZE for 2 months, then RH for 4 months. 
         TB/HIV co-infection: start ART within 2-4 weeks of TB treatment.
         Drug-resistant: refer to MDR-TB unit.`,
  "HIV_OPPORTUNISTIC": `Opportunistic infections by CD4 count:
         <200: PCP prophylaxis (cotrimoxazole), watch for toxoplasmosis
         <100: Cryptococcal screen (CrAg), MAC prophylaxis
         <50: CMV retinitis screening`,
  // etc.
};
```

---

### BUILD 7: Regulatory & Legal Compliance Framework

This is not purely technical — it requires legal and operational work running in parallel with development.

**HPCSA Telemedicine Compliance Checklist:**

| Requirement | Status | Action Required |
|---|---|---|
| AI output clearly labelled as "decision support only" | ✅ Disclaimer exists | Verify placement on all outputs |
| Informed consent for AI-assisted triage | ❌ Missing | Add consent checkbox + audit log on first triage |
| Patient identity verification before clinical advice | ❌ Missing | Add ID verification step for triage |
| Doctor-patient relationship established before diagnosis | ✅ Doctor reviews all cases | Document this workflow in ToS |
| Emergency referral pathway always provided | ✅ In disclaimers | Add to triage UI as sticky element |
| Data stored in SA (POPIA territorial requirement) | ❓ Verify Railway SA region | Confirm Railway uses AWS af-south-1 (Cape Town) |
| POPI Act registration with Information Regulator | ❌ Missing | Register at inforegulator.org.za |

**Informed consent implementation:**
```typescript
// New Prisma model
model PatientConsent {
  id          String   @id @default(cuid())
  userId      String
  consentType String   // "AI_TRIAGE" | "BIOMETRIC_MONITORING" | "DATA_SHARING" | "MARKETING"
  version     String   // "1.0" — increment when T&Cs change
  givenAt     DateTime @default(now())
  ipAddress   String?
  userAgent   String?
  withdrawn   Boolean  @default(false)
  withdrawnAt DateTime?
  
  user        User     @relation(fields: [userId], references: [id])
  @@unique([userId, consentType, version])
}
```

```typescript
// Middleware: require triage consent before AI triage
export async function requireTriageConsent(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const consent = await prisma.patientConsent.findFirst({
    where: { userId: req.user!.id, consentType: 'AI_TRIAGE', withdrawn: false }
  });
  
  if (!consent) {
    return res.status(403).json({
      error: 'CONSENT_REQUIRED',
      message: 'Patient consent for AI-assisted triage is required',
      consentUrl: '/api/patient/consent/ai-triage',
    });
  }
  next();
}
```

**Professional indemnity insurance:**  
Contact **Centriq** or **Renasa** (SA specialist liability insurers) for a healthcare technology platform policy. Budget R80,000-R200,000/year depending on user volume. This is non-negotiable before launch.

---

## PHASE 4: MARKETPLACE GROWTH (Days 150–365)

---

### BUILD 8: Cold-Start Marketplace Strategy

**The supply problem (nurses):**

Classic chicken-and-egg. Nurses won't join if there are no bookings. Patients won't book if there are no nurses. You need to solve supply first because supply enables demand conversion.

**Nurse supply seeding strategy:**

| Channel | Approach | Cost | Timeline |
|---|---|---|---|
| Nursing agencies | Partner with Medistaff, CureHire, Stafflink — they have rostered nurses looking for additional income | Revenue share 10-15% to agency | Month 1-3 |
| Nursing schools | Penultimate-year students doing community placements (under supervision) | Platform fee only | Month 2-4 |
| Community Health Workers (CHWs) | DOH-employed CHWs already doing home visits — integrate them as lower-cost visit tier | Government partnership | Month 4-6 |
| Social media recruitment | Facebook/WhatsApp groups for SA nurses (large communities) — targeted ads | R5,000-15,000/month | Ongoing |
| Guaranteed earnings | Offer R2,500/week guaranteed for first 8 weeks to first 50 nurses who complete onboarding | R100k one-time — seed round cost | Month 1 |

**Geographic focus — Johannesburg first:**

Do not launch in 9 provinces simultaneously. Launch in **Johannesburg South** (Soweto/Eldorado Park) or **Cape Town South** (Mitchell's Plain/Khayelitsha) first — high-density, unmet need, reachable for early nurses.

Specific density target: **20 verified nurses active within any 25km radius** before patient acquisition marketing starts in that geography.

**Patient acquisition channels:**

| Channel | SA Cost | Quality | Notes |
|---|---|---|---|
| Employer wellness programs (HR departments) | R50-200/lead | High | 1 enterprise deal = 500+ potential patients |
| Medical aid brokers | R100-300/patient | High | Brokers already talk to members about health benefits |
| Community pharmacies (Dis-Chem, Clicks) | R30-80/patient | Medium | In-store promotional partnerships |
| WhatsApp community referrals | R0-20/patient | High | SA's primary communication channel, viral potential |
| Facebook (SA urban) | R80-200/patient | Medium | Works for 35-60 age group |

---

## ARCHITECTURE UPGRADE SUMMARY

All changes layered on the existing codebase — no rewrites:

```
BEFORE                              AFTER
──────────────────────────────────────────────────────────
ML Service: In-memory dict      →   TimescaleDB hypertable
ML Baseline: 14-day cliff       →   Day-1 provisional baseline (blended)
Biometrics: Manual entry only   →   Terra API (50+ wearables) + webhook
StatPearls: Fragile NCBI scrape →   3-tier fallback + Redis cache + SA content
AI Triage: US clinical context  →   SA-specific system prompt + SATS scale
SANC: Admin toggle              →   Local register verification + audit log
Doctor queue: No SLA            →   SLA engine + escalation cron + doctor compensation
Payments: Card only             →   Card + Healthbridge medical aid claims (Phase 3)
Consent: None                   →   POPIA consent model + middleware
Regulatory: Disclaimer only     →   HPCSA telemedicine compliance checklist
```

---

## REVISED TIMELINE

| Phase | Duration | Key Deliverable | Investor Milestone |
|---|---|---|---|
| **Phase 0: Critical Fixes** | Weeks 1-3 | TimescaleDB live, StatPearls resilient | Platform stable |
| **Phase 1: Value Hardening** | Weeks 4-11 | Day-1 baseline, Terra wearables live | Demo-ready |
| **Phase 2: Operations** | Weeks 12-22 | Doctor pool, SANC verify, SLA engine | 50 paid visits |
| **Phase 3: Revenue Infra** | Weeks 22-44 | Healthbridge integration, SA AI context | Medical aid LOI |
| **Phase 4: Growth** | Weeks 44-52 | JHB market density, 500 patients | Series A readiness |

---

## REVISED UNIT ECONOMICS (with fixes applied)

| Item | Before Fixes | After Fixes |
|---|---|---|
| Visit fee (card) | R450 | R450 |
| Visit fee (medical aid) | R0 (not built) | R650 (BHF tariff) |
| Nurse payout | R225 | R225 |
| Doctor oversight | R0 (not costed) | R50 (per triage case, ~1/3 of visits need it) |
| Platform + infra | R50 | R55 (Terra API added) |
| **Gross margin (card)** | R175 (39%) | R158 (35%) |
| **Gross margin (medical aid)** | N/A | R320 (49%) |
| **Blended gross margin (60% card, 40% medical aid)** | N/A | **R223 (42%)** |

At 500 visits/month: **R111,500 gross profit/month**  
At 2,000 visits/month: **R446,000 gross profit/month** (~R5.35M/year) → Series A territory.

---

## IMMEDIATE NEXT STEPS (This week)

1. **Today:** Enable TimescaleDB on Railway PostgreSQL instance — one SQL command
2. **Day 2:** Begin `db.py` ML persistence refactor (3 days work, biggest P0 risk)
3. **Day 3:** Sign up for Terra API dev account (free tier available for development)
4. **Day 5:** Contact ENSafrica or Webber Wentzel for healthcare law consultation
5. **Day 7:** Download SANC register CSV, begin import script
6. **Week 2:** Implement progressive baseline model
7. **Week 3:** Integrate Terra webhook handler
8. **Week 4:** Begin doctor recruitment outreach to Intercare/Clicks Clinics

---

*This plan closes every investor-identified gap with specific, executable technical steps layered on the existing codebase. No rewrites. No platform rebuilds. Surgical, high-leverage changes that move the platform from "impressive prototype" to "fundable product."*
