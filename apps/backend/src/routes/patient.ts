import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import axios from 'axios';
import Joi from 'joi';
import { processBiometricReading, getMonitoringSummary, detectEarlyWarningSigns } from '../services/monitoring';

const router: Router = Router();
const prisma = new PrismaClient();

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
router.post('/biometrics', authMiddleware, rateLimiter, async (req: AuthenticatedRequest, res, next) => {
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

    // Prefer summary (no duplicate append); if ML has no data, backfill from DB then analyze
    let mlData: any;
    try {
      const summaryRes = await axios.get(
        `${ML_SERVICE_URL}/early-warning/summary/${encodeURIComponent(userId)}`,
        { timeout: 8000 }
      );
      mlData = summaryRes.data;
    } catch (summaryErr: any) {
      if (summaryErr.response?.status !== 404) throw summaryErr;
      // ML has no history: backfill from DB (last 20 readings, send oldest-first so baseline works)
      const recentReadings = await prisma.biometricReading.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          createdAt: true,
          heartRate: true,
          heartRateResting: true,
          hrvRmssd: true,
          oxygenSaturation: true,
          skinTempOffset: true,
          respiratoryRate: true,
          stepCount: true,
          activeCalories: true,
          sleepDurationHours: true,
          ecgRhythm: true,
          temperatureTrend: true,
        },
      });
      const inOrder = [...recentReadings].reverse();
      for (const row of inOrder) {
        const r = row as any;
        const ts = r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString();
        const clamp = (v: number | null | undefined, min: number, max: number, def: number) =>
          v != null ? Math.min(max, Math.max(min, Number(v))) : def;
        try {
          await axios.post(
            `${ML_SERVICE_URL}/ingest?user_id=${encodeURIComponent(userId)}`,
            {
              timestamp: ts,
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
            },
            { timeout: 3000 }
          );
        } catch (_) {
          // ignore single ingest failure
        }
      }
      const analyzeRes = await axios.post(
        `${ML_SERVICE_URL}/early-warning/analyze?user_id=${encodeURIComponent(userId)}`,
        { biometrics, context },
        { timeout: 10000 }
      );
      mlData = analyzeRes.data;
    }

    res.json({
      success: true,
      data: mlData,
      meta: { disclaimer: 'Not a medical diagnosis. For informational purposes only.' },
    });
  } catch (error: any) {
    if (error.response?.status === 404) {
      return res.status(404).json({ success: false, error: error.response?.data?.detail ?? 'No data' });
    }
    if (error.code === 'ECONNREFUSED' || error.response?.status >= 500) {
      return res.status(503).json({
        success: false,
        error: 'Early warning service temporarily unavailable. Try again later.',
      });
    }
    if (error.response?.status === 400 || error.response?.status === 422) {
      const detail = error.response?.data?.detail ?? error.response?.data?.message ?? error.message;
      return res.status(400).json({
        success: false,
        error: typeof detail === 'string' ? detail : 'Early warning request invalid.',
      });
    }
    next(error);
  }
});

// Update patient risk profile (smoker, hypertension) for CVD algorithms
const riskProfileSchema = Joi.object({
  smoker: Joi.boolean().optional(),
  hypertension: Joi.boolean().optional(),
  cholesterolKnown: Joi.boolean().optional(),
  cholesterolValue: Joi.number().min(2).max(15).optional(),
});
router.patch('/risk-profile', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = riskProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    const userId = req.user!.id;
    await prisma.user.update({
      where: { id: userId },
      data: { riskProfile: value as object },
    });
    res.json({ success: true, riskProfile: value });
  } catch (e) {
    next(e);
  }
});

// Enhanced triage with biometrics
router.post('/triage', authMiddleware, rateLimiter, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = submitTriageWithBiometricsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { symptoms, imageBase64, biometrics } = value;

    // Call AI triage service
    const triageResponse = await axios.post(
      'http://localhost:4000/api/triage',
      {
        symptoms,
        imageBase64,
      },
      {
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );

    const triageResult = triageResponse.data.data;

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

      // Adjust triage level if biometrics indicate urgency
      if (biometricAnalysis.abnormal.length > 0 && triageResult.triageLevel > 2) {
        triageResult.triageLevel = Math.max(1, triageResult.triageLevel - 1) as any; // Increase urgency
        triageResult.reasoning += ` Note: Biometric readings show ${biometricAnalysis.abnormal.join(', ')}.`;
      }
    }

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

export default router;

