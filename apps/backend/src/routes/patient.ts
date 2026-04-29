import { Router } from 'express';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { idempotencyMiddleware } from '../middleware/idempotency';
import { aiTriageBudgetMiddleware } from '../middleware/aiTriageBudget';
import axios from 'axios';
import Joi from 'joi';
import { processBiometricReading, getMonitoringSummary, detectEarlyWarningSigns } from '../services/monitoring';
import { analyzeSymptoms } from '../services/aiTriage';
import { startDemoStream } from '../services/demoStream';
import prisma from '../lib/prisma';
import { randomUUID } from 'crypto';
import { hashValue, writeClinicalAudit } from '../services/clinicalAudit';

const router: Router = Router();

// ML Service URL (from environment or default)
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// Validation schemas
const submitBiometricsSchema = Joi.object({
  // Core vitals
  heartRate: Joi.number().min(30).max(220).optional(),
  heartRateResting: Joi.number().min(30).max(200).optional(),
  hrvRmssd: Joi.number().min(0).max(300).optional(), // Heart Rate Variability
  bloodPressure: Joi.object({
    systolic: Joi.number().min(50).max(250).required(),
    diastolic: Joi.number().min(30).max(150).required(),
  }).optional(),
  oxygenSaturation: Joi.number().min(50).max(100).optional(), // SpO2
  temperature: Joi.number().min(30).max(45).optional(), // Celsius
  respiratoryRate: Joi.number().min(4).max(60).optional(), // Breaths per minute
  weight: Joi.number().min(0).max(500).optional(), // kg
  height: Joi.number().min(0).max(300).optional(), // cm
  glucose: Joi.number().min(0).max(600).optional(), // mg/dL
  
  // Activity context (for wearable devices)
  stepCount: Joi.number().min(0).optional(),
  activeCalories: Joi.number().min(0).optional(),
  skinTempOffset: Joi.number().min(-5).max(5).optional(),
  sleepDurationHours: Joi.number().min(0).max(24).optional(),
  ecgRhythm: Joi.string().valid('regular', 'irregular', 'unknown').optional(),
  temperatureTrend: Joi.string().valid('normal', 'elevated_single_day', 'elevated_over_3_days').optional(),
  
  // Source
  source: Joi.string().valid('wearable', 'manual').default('manual'),
  deviceType: Joi.string().optional(), // e.g., 'apple_watch', 'fitbit', 'manual_entry'
});

const submitTriageWithBiometricsSchema = Joi.object({
  symptoms: Joi.string().required(),
  imageBase64: Joi.string().optional(),
  biometrics: submitBiometricsSchema.optional(),
});

// Submit biometrics (from wearable or manual entry)
router.post('/biometrics', rateLimiter, authMiddleware, idempotencyMiddleware({ scope: 'patient-biometrics' }), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = submitBiometricsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user!.id;
    const timestamp = new Date();

    // Store biometrics in database
    // Workaround: Try Prisma model first, fallback to raw SQL if model not available
    let biometricRecord: any;
    try {
      if (prisma.biometricReading) {
        biometricRecord = await prisma.biometricReading.create({
          data: {
            userId,
            heartRate: value.heartRate,
            heartRateResting: value.heartRateResting || value.heartRate,
            hrvRmssd: value.hrvRmssd,
            bloodPressureSystolic: value.bloodPressure?.systolic,
            bloodPressureDiastolic: value.bloodPressure?.diastolic,
            oxygenSaturation: value.oxygenSaturation,
            temperature: value.temperature,
            respiratoryRate: value.respiratoryRate,
            weight: value.weight,
            height: value.height,
            glucose: value.glucose,
            stepCount: value.stepCount,
            activeCalories: value.activeCalories,
            skinTempOffset: value.skinTempOffset,
            sleepDurationHours: value.sleepDurationHours,
            ecgRhythm: value.ecgRhythm,
            temperatureTrend: value.temperatureTrend,
            source: value.source,
            deviceType: value.deviceType,
          },
        });
      } else {
        throw new Error('Model not available');
      }
    } catch (modelError: any) {
      // Fallback to raw SQL if model not available (Prisma client regeneration issue)
      const result = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO biometric_readings (
          id, "userId", "heartRate", "heartRateResting", "hrvRmssd",
          "bloodPressureSystolic", "bloodPressureDiastolic", "oxygenSaturation",
          temperature, "respiratoryRate", weight, height, glucose,
          "stepCount", "activeCalories", "skinTempOffset",
          "sleepDurationHours", "ecgRhythm", "temperatureTrend",
          source, "deviceType", "createdAt"
        ) VALUES (
          gen_random_uuid()::text, ${userId}, ${value.heartRate}, ${value.heartRateResting || value.heartRate}, ${value.hrvRmssd},
          ${value.bloodPressure?.systolic}, ${value.bloodPressure?.diastolic}, ${value.oxygenSaturation},
          ${value.temperature}, ${value.respiratoryRate}, ${value.weight}, ${value.height}, ${value.glucose},
          ${value.stepCount}, ${value.activeCalories}, ${value.skinTempOffset},
          ${value.sleepDurationHours ?? null}, ${value.ecgRhythm ?? null}, ${value.temperatureTrend ?? null},
          ${value.source}, ${value.deviceType}, NOW()
        ) RETURNING id
      `;
      biometricRecord = { id: result[0]?.id || 'temp-id' };
    }

    // Process through early warning monitoring system
    const monitoringResult = await processBiometricReading(userId, value);
    const { alertLevel, anomalies, readinessScore, baselineStatus, recommendations } = monitoringResult;

    // Detect early warning signs for specific conditions
    const earlyWarnings = detectEarlyWarningSigns(anomalies, value);

    // Update biometric record with analysis results
    try {
      if (prisma.biometricReading && typeof prisma.biometricReading.update === 'function') {
        await prisma.biometricReading.update({
          where: { id: biometricRecord.id },
          data: {
            alertLevel,
            anomalies: anomalies as any,
            readinessScore,
          },
        });
      } else {
        // Fallback: Update via raw SQL
        await prisma.$executeRaw`
          UPDATE biometric_readings
          SET "alertLevel" = ${alertLevel},
              anomalies = ${JSON.stringify(anomalies)}::jsonb,
              "readinessScore" = ${readinessScore}
          WHERE id = ${biometricRecord.id}
        `;
      }
    } catch (updateError) {
      console.warn('[Patient] Failed to update biometric record:', updateError);
    }

    // Create alert if anomalies detected
    let alert = null;
    if (alertLevel !== 'GREEN' && anomalies.length > 0) {
      try {
        if (prisma.healthAlert && typeof prisma.healthAlert.create === 'function') {
          alert = await prisma.healthAlert.create({
            data: {
              userId,
              alertLevel: alertLevel as 'YELLOW' | 'RED',
              title: alertLevel === 'RED' ? 'Critical Health Alert' : 'Health Warning',
              message: `Detected ${anomalies.length} biometric anomaly(ies): ${anomalies.slice(0, 2).join(', ')}${anomalies.length > 2 ? '...' : ''}`,
              detectedAnomalies: anomalies as any,
              biometricReadingId: biometricRecord.id,
            },
          });
        } else {
          // Fallback: Create alert via raw SQL
          const alertResult = await prisma.$queryRaw<Array<{ id: string }>>`
            INSERT INTO health_alerts (
              id, "userId", "alertLevel", title, message, "detectedAnomalies", "biometricReadingId", "createdAt"
            ) VALUES (
              gen_random_uuid()::text, ${userId}, ${alertLevel}, 
              ${alertLevel === 'RED' ? 'Critical Health Alert' : 'Health Warning'},
              ${`Detected ${anomalies.length} biometric anomaly(ies): ${anomalies.slice(0, 2).join(', ')}${anomalies.length > 2 ? '...' : ''}`},
              ${JSON.stringify(anomalies)}::jsonb,
              ${biometricRecord.id},
              NOW()
            ) RETURNING id
          `;
          alert = { id: alertResult[0]?.id };
        }
      } catch (alertError) {
        console.warn('[Patient] Failed to create alert:', alertError);
      }
    }

    res.json({
      success: true,
      message: 'Biometrics recorded successfully',
      alertLevel: alertLevel || 'GREEN',
      anomalies: anomalies || [],
      readinessScore: readinessScore || 100,
      baselineStatus: baselineStatus || 'STABLE',
      recommendations: recommendations || [],
      earlyWarnings: earlyWarnings || [],
      data: {
        timestamp,
        source: value.source,
        deviceType: value.deviceType,
        alertLevel: alertLevel || 'GREEN',
        anomalies: anomalies || [],
        readinessScore: readinessScore || 100,
        baselineStatus: baselineStatus || 'STABLE',
        recommendations: recommendations || [],
        earlyWarnings: earlyWarnings || [],
        biometricReadingId: biometricRecord.id,
        alertId: alert?.id,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get patient's biometric history
router.get('/biometrics/history', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 30));
    const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);

    // Get readiness score from ML service
    let readinessScore = null;
    let baselineStatus = 'CALIBRATING';

    try {
      const scoreResponse = await axios.get(
        `${ML_SERVICE_URL}/readiness-score/${userId}`,
        { timeout: 5000 }
      );
      readinessScore = scoreResponse.data.score;
      baselineStatus = scoreResponse.data.baseline_status;
    } catch (mlError: any) {
      console.warn('[Patient] ML service unavailable:', mlError.message);
    }

    // Fetch biometric history from database
    let history: any[] = [];
    try {
      history = await prisma.biometricReading.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          heartRate: true,
          heartRateResting: true,
          bloodPressureSystolic: true,
          bloodPressureDiastolic: true,
          oxygenSaturation: true,
          temperature: true,
          respiratoryRate: true,
          weight: true,
          glucose: true,
          source: true,
          deviceType: true,
          alertLevel: true,
          readinessScore: true,
          createdAt: true,
        },
      });
    } catch (historyError: any) {
      console.error('[Patient] Failed to fetch biometric history:', historyError?.message || historyError);
      return res.status(503).json({
        success: false,
        error: 'Unable to load biometric history. Database may be unavailable.',
      });
    }

    res.json({
      success: true,
      data: {
        readinessScore,
        baselineStatus,
        baselineEstablished: baselineStatus !== 'CALIBRATING',
        history,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get early warning alerts
router.get('/alerts', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;

    // Fetch alerts from database
    let alerts: any[] = [];
    try {
      if (prisma.healthAlert) {
        alerts = await prisma.healthAlert.findMany({
          where: {
            userId,
            resolved: false,
          },
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        });
      } else {
        // Fallback: Fetch via raw SQL
        alerts = await prisma.$queryRaw<any[]>`
          SELECT h.*, 
                 json_build_object('id', u.id, 'firstName', u."firstName", 
                                   'lastName', u."lastName", 'email', u.email) as user
          FROM health_alerts h
          JOIN users u ON h."userId" = u.id
          WHERE h."userId" = ${userId} AND h.resolved = false
          ORDER BY h."createdAt" DESC
        `;
      }
    } catch (alertsError) {
      console.warn('[Patient] Failed to fetch alerts:', alertsError);
    }

    res.json({
      success: true,
      alerts,
    });
  } catch (error) {
    next(error);
  }
});

// Get monitoring summary
router.get('/monitoring/summary', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const summary = await getMonitoringSummary(userId);
    res.json({
      success: true,
      data: summary,
    });
  } catch (error: any) {
    console.error('[Patient] Monitoring summary failed:', error?.message || error);
    return res.status(503).json({
      success: false,
      error: 'Unable to load monitoring summary. Database or ML service may be unavailable.',
    });
  }
});

// Get Early Warning dashboard (risk scores, trajectory, clinical flags)
router.get('/early-warning', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;

    const [user, latestReading] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { dateOfBirth: true, riskProfile: true },
      }),
      prisma.biometricReading.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    if (!latestReading) {
      return res.status(404).json({
        success: false,
        error: 'No biometric data yet. Submit at least one reading to see your Early Warning summary.',
      });
    }

    const riskProfile = (user?.riskProfile as { smoker?: boolean; hypertension?: boolean }) || {};
    const age = user?.dateOfBirth
      ? Math.floor((Date.now() - new Date(user.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      : 50;
    const context = {
      age: Math.max(18, Math.min(120, age)),
      smoker: Boolean(riskProfile.smoker),
      hypertension: Boolean(riskProfile.hypertension),
      cholesterol_known: Boolean((user?.riskProfile as any)?.cholesterolKnown),
      cholesterol_mmol_per_L: (user?.riskProfile as any)?.cholesterolValue ?? null,
    };

    const r = latestReading as any;
    const toIso = (d: Date | string | null | undefined) =>
      d ? new Date(d).toISOString() : new Date().toISOString();
    const clamp = (v: number | null | undefined, min: number, max: number, def: number) =>
      v != null ? Math.min(max, Math.max(min, Number(v))) : def;
    const biometrics = {
      timestamp: toIso(r.createdAt),
      heart_rate_resting: clamp(r.heartRateResting ?? r.heartRate, 30, 200, 72),
      hrv_rmssd: clamp(r.hrvRmssd, 0, 300, 35),
      spo2: clamp(r.oxygenSaturation, 50, 100, 98),
      skin_temp_offset: clamp(r.skinTempOffset, -5, 5, 0),
      respiratory_rate: clamp(r.respiratoryRate, 4, 60, 16),
      step_count: Math.max(0, Number(r.stepCount) || 0),
      active_calories: Math.max(0, Number(r.activeCalories) || 0),
      sleep_duration_hours: Math.min(24, Math.max(0, Number(r.sleepDurationHours) || 0)),
      ecg_rhythm: ['regular', 'irregular', 'unknown'].includes(r.ecgRhythm) ? r.ecgRhythm : 'unknown',
      temperature_trend: ['normal', 'elevated_single_day', 'elevated_over_3_days'].includes(r.temperatureTrend) ? r.temperatureTrend : 'normal',
    };

    // Try ML service — fully optional, any failure falls back to DB-only analysis
    let mlData: any;
    const ML_URL = (process.env.ML_SERVICE_URL ?? '').replace(/\/$/, '');
    const mlServiceAvailable = !!ML_URL && !ML_URL.includes('localhost');

    if (mlServiceAvailable) {
      try {
        // 1. Try the cached summary first
        const summaryRes = await axios.get(
          `${ML_URL}/early-warning/summary/${encodeURIComponent(userId)}`,
          { timeout: 8000 }
        );
        mlData = summaryRes.data;
      } catch (summaryErr: any) {
        const status = summaryErr.response?.status;
        if (status !== 404) {
          // ML service is reachable but erroring — log and fall through to DB analysis
          console.warn(`[early-warning] ML summary failed (${status ?? 'network'}): ${summaryErr.message}`);
        } else {
          // 404 = no history yet — backfill from DB then run analysis
          try {
            const recentReadings = await prisma.biometricReading.findMany({
              where: { userId },
              orderBy: { createdAt: 'desc' },
              take: 20,
              select: {
                createdAt: true, heartRate: true, heartRateResting: true, hrvRmssd: true,
                oxygenSaturation: true, skinTempOffset: true, respiratoryRate: true,
                stepCount: true, activeCalories: true, sleepDurationHours: true,
                ecgRhythm: true, temperatureTrend: true,
              },
            });
            const clampR = (v: number | null | undefined, min: number, max: number, def: number) =>
              v != null ? Math.min(max, Math.max(min, Number(v))) : def;
            for (const row of [...recentReadings].reverse()) {
              const rb = row as any;
              await axios.post(
                `${ML_URL}/ingest?user_id=${encodeURIComponent(userId)}`,
                {
                  timestamp: rb.createdAt ? new Date(rb.createdAt).toISOString() : new Date().toISOString(),
                  heart_rate_resting: clampR(rb.heartRateResting ?? rb.heartRate, 30, 200, 72),
                  hrv_rmssd: clampR(rb.hrvRmssd, 0, 300, 35),
                  spo2: clampR(rb.oxygenSaturation, 50, 100, 98),
                  skin_temp_offset: clampR(rb.skinTempOffset, -5, 5, 0),
                  respiratory_rate: clampR(rb.respiratoryRate, 4, 60, 16),
                  step_count: Math.max(0, Number(rb.stepCount) || 0),
                  active_calories: Math.max(0, Number(rb.activeCalories) || 0),
                  sleep_duration_hours: Math.min(24, Math.max(0, Number(rb.sleepDurationHours) || 0)),
                  ecg_rhythm: ['regular', 'irregular', 'unknown'].includes(rb.ecgRhythm) ? rb.ecgRhythm : 'unknown',
                  temperature_trend: ['normal', 'elevated_single_day', 'elevated_over_3_days'].includes(rb.temperatureTrend) ? rb.temperatureTrend : 'normal',
                },
                { timeout: 3000 }
              ).catch(() => { /* ignore individual ingest failures */ });
            }
            const analyzeRes = await axios.post(
              `${ML_URL}/early-warning/analyze?user_id=${encodeURIComponent(userId)}`,
              { biometrics, context },
              { timeout: 10000 }
            );
            mlData = analyzeRes.data;
          } catch (backfillErr: any) {
            console.warn(`[early-warning] ML backfill/analyze failed: ${backfillErr.message}`);
            // mlData stays undefined → DB fallback below
          }
        }
      }
    }
    
    // Fallback: rule-based analysis directly from DB readings (works without ML service)
    if (!mlData) {
      const allReadings = await prisma.biometricReading.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });

      const anomalies: string[] = [];
      const recommendations: string[] = [];
      let alertLevel = 'GREEN';

      if (allReadings.length > 0) {
        const latest = allReadings[0] as any;
        const hr    = Number(latest.heartRateResting ?? latest.heartRate ?? 0);
        const spo2  = Number(latest.oxygenSaturation ?? 98);
        const hrv   = Number(latest.hrvRmssd ?? 35);
        const rr    = Number(latest.respiratoryRate ?? 16);
        const temp  = Number(latest.temperature ?? 36.5);
        const sleep = Number(latest.sleepDurationHours ?? 7);

        // Heart rate flags
        if (hr > 100) { anomalies.push('Resting tachycardia (HR > 100 bpm)'); alertLevel = 'YELLOW'; recommendations.push('Resting heart rate is elevated — consider rest and re-check. If persistent, consult a clinician.'); }
        else if (hr < 45) { anomalies.push('Bradycardia (HR < 45 bpm)'); alertLevel = 'YELLOW'; recommendations.push('Resting heart rate is very low — ensure no medication side effect. Seek medical review if symptomatic.'); }

        // SpO2 flags
        if (spo2 < 90) { anomalies.push(`Critical SpO2 (${spo2}%)`); alertLevel = 'RED'; recommendations.push('Oxygen saturation critically low — seek immediate medical attention.'); }
        else if (spo2 < 94) { anomalies.push(`Low SpO2 (${spo2}%)`); alertLevel = 'YELLOW'; recommendations.push('Blood oxygen below normal range — avoid exertion, ensure adequate ventilation, consult a clinician.'); }

        // HRV flags
        if (hrv < 20) { anomalies.push('Very low HRV (autonomic stress)'); if (alertLevel === 'GREEN') alertLevel = 'YELLOW'; recommendations.push('HRV is very low, indicating high autonomic stress or fatigue. Prioritise rest and recovery.'); }

        // Respiratory rate
        if (rr > 24) { anomalies.push(`Elevated respiratory rate (${rr}/min)`); alertLevel = 'RED'; recommendations.push('Respiratory rate is elevated — seek medical review, particularly to exclude pneumonia or pulmonary embolism.'); }
        else if (rr > 20) { anomalies.push(`Mildly elevated respiratory rate (${rr}/min)`); if (alertLevel === 'GREEN') alertLevel = 'YELLOW'; recommendations.push('Respiratory rate slightly elevated — monitor closely and avoid strenuous activity.'); }

        // Temperature
        if (temp > 38.5) { anomalies.push(`Fever (${temp.toFixed(1)}°C)`); if (alertLevel === 'GREEN') alertLevel = 'YELLOW'; recommendations.push('Temperature indicates fever — stay hydrated, rest, and consult a clinician if above 39°C or persistent beyond 48h.'); }

        // Sleep
        if (sleep < 5 && sleep > 0) { recommendations.push('Sleep duration below recommended — chronic sleep deprivation increases cardiovascular and metabolic risk.'); }

        // Trend analysis (compare most recent 5 readings if available)
        const hrValues = allReadings.slice(0, 5).map((row: any) => Number(row.heartRateResting ?? row.heartRate ?? 0)).filter(v => v > 0);
        const hrTrend = hrValues.length >= 3
          ? (hrValues[0] - hrValues[hrValues.length - 1] > 8 ? 'rising' : hrValues[hrValues.length - 1] - hrValues[0] > 8 ? 'falling' : 'stable')
          : 'stable';

        if (anomalies.length === 0) recommendations.push('All key vitals within normal range. Maintain your current habits — regular monitoring, balanced diet, and 150 min/week of moderate activity.');
        // SA-specific note
        recommendations.push('If you have any respiratory symptoms, consider TB screening — South Africa has a high TB burden.');

        mlData = {
          riskLevel: alertLevel === 'RED' ? 'high' : alertLevel === 'YELLOW' ? 'moderate' : 'low',
          alert_level: alertLevel,
          anomalies,
          recommendations,
          trendAnalysis: {
            heartRate: hrTrend,
            oxygenSaturation: spo2 >= 96 ? 'normal' : spo2 >= 94 ? 'borderline' : 'low',
            sleepQuality: sleep >= 7 ? 'adequate' : sleep >= 5 ? 'below optimal' : 'poor',
          },
          baselineMetrics: biometrics,
          fusion: {
            alert_triggered: alertLevel !== 'GREEN',
            alert_message: alertLevel !== 'GREEN' ? anomalies[0] : undefined,
            trajectory_risk_2y_pct: undefined,
          },
          _source: 'db_rules', // indicates ML service was unavailable; this is rule-based
        };
      } else {
        mlData = {
          riskLevel: 'unknown',
          alert_level: 'GREEN',
          anomalies: [],
          recommendations: ['Connect a wearable or enter your first biometric reading to receive personalised Early Warning analysis.'],
          trendAnalysis: { heartRate: 'no data', oxygenSaturation: 'no data', sleepQuality: 'no data' },
          baselineMetrics: biometrics,
          fusion: { alert_triggered: false },
          _source: 'db_rules',
        };
      }
    }

    // Safety envelope: enforce uncertainty/provenance contract even on legacy/fallback payloads.
    if (!(mlData as any).uncertainty) {
      (mlData as any).uncertainty = {
        score: (mlData as any)._source === 'db_rules' ? 0.55 : 0.4,
        reasons: (mlData as any)._source === 'db_rules' ? ['ML_SERVICE_UNAVAILABLE_FALLBACK'] : [],
      };
    }
    if (!(mlData as any).provenance) {
      (mlData as any).provenance = {
        evidence_sources: ['Local rule-based fallback'],
        clinical_basis: ['Deterministic threshold checks'],
        model_version: (mlData as any)._source === 'db_rules' ? 'fallback-rules-v1' : 'unknown',
        decision_trace_id: hashValue(`${userId}:${Date.now()}`).slice(0, 24),
      };
    }
    const uncertaintyScore = Number((mlData as any)?.uncertainty?.score ?? 0.5);
    (mlData as any).requires_clinician_review = Boolean(
      (mlData as any)?.requires_clinician_review
      || uncertaintyScore >= 0.45
      || (mlData as any)?.alert_level === 'RED'
      || (mlData as any)?.alert_level === 'YELLOW'
    );

    const responseSource = String((mlData as any)?._source ?? 'ml_service');
    await writeClinicalAudit({
      userId,
      userRole: req.user?.role,
      action: 'EARLY_WARNING_ASSESSMENT',
      resource: 'early_warning_summary',
      resourceId: userId,
      metadata: {
        source: responseSource,
        alertLevel: (mlData as any)?.alert_level ?? 'UNKNOWN',
        riskLevel: (mlData as any)?.riskLevel ?? 'UNKNOWN',
        anomalyCount: Array.isArray((mlData as any)?.anomalies) ? (mlData as any).anomalies.length : 0,
        alertTriggered: Boolean((mlData as any)?.fusion?.alert_triggered),
        uncertaintyScore,
        requiresClinicianReview: Boolean((mlData as any)?.requires_clinician_review),
        decisionTraceId: (mlData as any)?.provenance?.decision_trace_id ?? null,
      },
    });

    res.json({
      success: true,
      data: mlData,
      meta: { disclaimer: 'Not a medical diagnosis. For informational purposes only.' },
    });
  } catch (error: any) {
    console.error('Early warning error:', error.message);
    if (error.response?.status === 404) {
      return res.status(404).json({ success: false, error: 'No biometric data found. Submit a reading first.' });
    }
    if (error.response?.status === 400 || error.response?.status === 422) {
      const detail = error.response?.data?.detail ?? error.response?.data?.message ?? error.message;
      return res.status(400).json({
        success: false,
        error: typeof detail === 'string' ? detail : 'Early warning request invalid.',
      });
    }
    // For other errors, return a generic response
    res.status(500).json({
      success: false,
      error: 'Failed to get early warning summary. Please try again.',
    });
  }
});

const riskProfileSchema = Joi.object({
  smoker: Joi.boolean().optional(),
  hypertension: Joi.boolean().optional(),
  diabetes: Joi.boolean().optional(),
  asthmaOrCopd: Joi.boolean().optional(),
  pregnancy: Joi.boolean().optional(),
  familyHistoryCvd: Joi.boolean().optional(),
  activityLevel: Joi.string().valid('LOW', 'MODERATE', 'HIGH').optional(),
  alcoholUse: Joi.string().valid('NONE', 'LOW', 'MODERATE', 'HIGH').optional(),
  cholesterolKnown: Joi.boolean().optional(),
  cholesterolValue: Joi.number().min(2).max(15).optional(),
  consentAcknowledged: Joi.boolean().optional(),
  onboardingCompleted: Joi.boolean().optional(),
  surveyVersion: Joi.number().integer().min(1).max(10).optional(),
}).min(1);
router.patch('/risk-profile', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = riskProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    const userId = req.user!.id;
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { dateOfBirth: true, gender: true, riskProfile: true },
    });

    const merged = {
      ...((current?.riskProfile as Record<string, unknown> | null) ?? {}),
      ...(value as Record<string, unknown>),
      updatedAt: new Date().toISOString(),
    };

    await prisma.user.update({
      where: { id: userId },
      data: { riskProfile: merged as object },
    });

    const ML_URL = (process.env.ML_SERVICE_URL ?? '').replace(/\/$/, '');
    const mlServiceAvailable = !!ML_URL && !ML_URL.includes('localhost');
    if (mlServiceAvailable) {
      const age = current?.dateOfBirth
        ? Math.floor((Date.now() - new Date(current.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
        : 50;
      const context = {
        age: Math.max(18, Math.min(120, age)),
        smoker: Boolean((merged as any).smoker),
        hypertension: Boolean((merged as any).hypertension),
        cholesterol_known: Boolean((merged as any).cholesterolKnown),
        cholesterol_mmol_per_L: (merged as any).cholesterolValue ?? null,
      };
      axios
        .put(`${ML_URL}/early-warning/context/${encodeURIComponent(userId)}`, context, { timeout: 8000 })
        .catch(() => {});
    }

    res.json({ success: true, riskProfile: merged });
  } catch (e) {
    next(e);
  }
});

// Enhanced triage with biometrics
router.post('/triage', rateLimiter, authMiddleware, aiTriageBudgetMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = submitTriageWithBiometricsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { symptoms, imageBase64, biometrics } = value;
    const patientId = req.user!.id;
    const caseId = randomUUID();
    const vitalsSnapshot = biometrics ? {
      heartRateResting: biometrics.heartRateResting ?? biometrics.heartRate ?? null,
      oxygenSaturation: biometrics.oxygenSaturation ?? null,
      respiratoryRate: biometrics.respiratoryRate ?? null,
      temperature: biometrics.temperature ?? null,
      bloodPressureSystolic: biometrics.bloodPressure?.systolic ?? null,
      bloodPressureDiastolic: biometrics.bloodPressure?.diastolic ?? null,
      hrvRmssd: biometrics.hrvRmssd ?? null,
    } : undefined;

    // Call AI triage service directly (avoids network self-call)
    const triageResult = await analyzeSymptoms({
      symptoms,
      imageBase64,
      patientId,
      caseId,
      vitalsSnapshot,
    });

    // If biometrics provided, enhance triage with biometric context
    let biometricContext = null;
    if (biometrics) {
      // Analyze biometrics for additional context
      const biometricAnalysis = {
        vitalSigns: {
          heartRate: biometrics.heartRate || biometrics.heartRateResting,
          bloodPressure: biometrics.bloodPressure,
          oxygenSaturation: biometrics.oxygenSaturation,
          temperature: biometrics.temperature,
          respiratoryRate: biometrics.respiratoryRate,
        },
        abnormal: [] as string[],
      };

      // Check for abnormal values
      if (biometricAnalysis.vitalSigns.heartRate && (biometricAnalysis.vitalSigns.heartRate > 100 || biometricAnalysis.vitalSigns.heartRate < 60)) {
        biometricAnalysis.abnormal.push('Heart rate outside normal range');
      }
      if (biometricAnalysis.vitalSigns.bloodPressure) {
        const { systolic, diastolic } = biometricAnalysis.vitalSigns.bloodPressure;
        if (systolic > 140 || diastolic > 90) {
          biometricAnalysis.abnormal.push('Elevated blood pressure');
        }
      }
      if (biometricAnalysis.vitalSigns.oxygenSaturation && biometricAnalysis.vitalSigns.oxygenSaturation < 95) {
        biometricAnalysis.abnormal.push('Low oxygen saturation');
      }
      if (biometricAnalysis.vitalSigns.temperature && biometricAnalysis.vitalSigns.temperature > 37.5) {
        biometricAnalysis.abnormal.push('Elevated temperature');
      }

      biometricContext = biometricAnalysis;

      // Conservative override: never reduce urgency, only escalate if abnormalities exist.
      if (biometricAnalysis.abnormal.length > 0 && triageResult.triageLevel > 2) {
        triageResult.triageLevel = Math.max(1, triageResult.triageLevel - 1) as any;
        triageResult.reasoning += ` Note: Additional biometric red flags: ${biometricAnalysis.abnormal.join(', ')}.`;
        triageResult.requiresDoctorReview = true;
      }
    }

    await writeClinicalAudit({
      userId: patientId,
      userRole: req.user?.role,
      action: 'AI_TRIAGE_PREVIEW',
      resource: 'patient_triage',
      resourceId: caseId,
      metadata: {
        triageLevel: triageResult.triageLevel,
        confidence: triageResult.confidence,
        requiresDoctorReview: triageResult.requiresDoctorReview,
        uncertaintyFlags: triageResult.uncertaintyFlags,
        evidenceSources: triageResult.evidenceSources,
        symptomsHash: hashValue(symptoms),
        hasBiometrics: Boolean(biometrics),
      },
    });

    res.json({
      success: true,
      data: {
        ...triageResult,
        biometricContext,
      },
      meta: {
        disclaimer: 'Not a medical diagnosis. Tool for decision support only.',
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/patient/baseline-info
// Returns baseline establishment progress (days toward 14-day requirement)
router.get('/baseline-info', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const firstReading = await prisma.biometricReading.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true }
    });

    if (!firstReading) {
      return res.json({ daysEstablished: 0, daysRequired: 14, isComplete: false });
    }

    const daysSinceFirst = Math.floor(
      (Date.now() - new Date(firstReading.createdAt).getTime()) / 86400000
    );

    const totalReadings = await prisma.biometricReading.count({ where: { userId } });
    const daysEstablished = Math.min(daysSinceFirst, 14);
    const isComplete = daysSinceFirst >= 14 && totalReadings >= 14;

    res.json({ daysEstablished, daysRequired: 14, totalReadings, isComplete });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get baseline info' });
  }
});

// GET /api/patient/anomaly-timeline
// Returns daily anomaly timeline (last 30 days)
router.get('/anomaly-timeline', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
    const daysBack = parseInt(req.query.days as string) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    // Get daily summaries (one reading per day, preferring worst alert level)
    const readings = await prisma.biometricReading.findMany({
      where: {
        userId,
        createdAt: { gte: cutoffDate },
        alertLevel: { not: 'GREEN' }  // Only non-normal readings
      },
      select: {
        createdAt: true,
        alertLevel: true,
        anomalies: true,
        heartRate: true,
        oxygenSaturation: true,
        temperature: true,
        respiratoryRate: true
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    // Group by day, keeping worst alert level per day
    const timeline: any[] = [];
    const dayMap = new Map<string, any>();

    readings.forEach(r => {
      const day = new Date(r.createdAt).toISOString().split('T')[0];
      const existing = dayMap.get(day);
      
      // Keep RED over YELLOW over GREEN
      const alertPriority = { 'RED': 3, 'YELLOW': 2, 'GREEN': 1 };
      if (!existing || alertPriority[r.alertLevel || 'GREEN'] > alertPriority[existing.alertLevel || 'GREEN']) {
        dayMap.set(day, r);
      }
    });

    // Convert to array and sort
    dayMap.forEach((value, key) => {
      timeline.push({
        date: key,
        alertLevel: value.alertLevel,
        anomalies: value.anomalies as string[],
        heartRate: value.heartRate,
        spo2: value.oxygenSaturation,
        temperature: value.temperature,
        respiratoryRate: value.respiratoryRate
      });
    });

    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.json(timeline);
  } catch (e) {
    console.error('Error loading timeline:', e);
    res.status(500).json({ error: 'Failed to load timeline' });
  }
});

// POST /api/patient/demo/start-stream
// DEMO ONLY - Streams realistic biometric progression for investor demo
// Works in production but requires authentication (applied by app.use mount)
router.post('/demo/start-stream', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { durationSeconds = 300, intervalSeconds = 30 } = req.query;

  try {
    startDemoStream(
      userId as string,
      parseInt(durationSeconds as string) || 300,
      parseInt(intervalSeconds as string) || 30
    );

    res.json({
      success: true,
      message: 'Demo biometric stream started',
      userId,
      durationSeconds: parseInt(durationSeconds as string) || 300,
      intervalSeconds: parseInt(intervalSeconds as string) || 30,
      note: 'Stream will submit realistic health data every 30 seconds'
    });
  } catch (e) {
    console.error('Error starting demo stream:', e);
    res.status(500).json({ error: 'Failed to start demo stream' });
  }
});

export default router;
