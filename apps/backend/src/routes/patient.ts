import { Router } from 'express';
import { PrismaClient, UserRole } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import axios from 'axios';
import Joi from 'joi';
import { processBiometricReading, getMonitoringSummary, detectEarlyWarningSigns } from '../services/monitoring';

const router = Router();
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
          "stepCount", "activeCalories", "skinTempOffset", source, "deviceType",
          "createdAt"
        ) VALUES (
          gen_random_uuid()::text, ${userId}, ${value.heartRate}, ${value.heartRateResting || value.heartRate}, ${value.hrvRmssd},
          ${value.bloodPressure?.systolic}, ${value.bloodPressure?.diastolic}, ${value.oxygenSaturation},
          ${value.temperature}, ${value.respiratoryRate}, ${value.weight}, ${value.height}, ${value.glucose},
          ${value.stepCount}, ${value.activeCalories}, ${value.skinTempOffset}, ${value.source}, ${value.deviceType},
          NOW()
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
    const { limit = '30', offset = '0' } = req.query;

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
      if (prisma.biometricReading) {
        history = await prisma.biometricReading.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: parseInt(limit as string),
          skip: parseInt(offset as string),
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
      } else {
        // Fallback: Fetch via raw SQL
        history = await prisma.$queryRaw<any[]>`
          SELECT id, "heartRate", "heartRateResting", "bloodPressureSystolic", 
                 "bloodPressureDiastolic", "oxygenSaturation", temperature, 
                 "respiratoryRate", weight, glucose, source, "deviceType", 
                 "alertLevel", "readinessScore", "createdAt"
          FROM biometric_readings
          WHERE "userId" = ${userId}
          ORDER BY "createdAt" DESC
          LIMIT ${parseInt(limit as string)}
          OFFSET ${parseInt(offset as string)}
        `;
      }
    } catch (historyError) {
      console.warn('[Patient] Failed to fetch history:', historyError);
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
  } catch (error) {
    next(error);
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

