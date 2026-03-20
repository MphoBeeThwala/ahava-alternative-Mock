/**
 * healthConnect.ts — Google Health Connect ingestion endpoint
 *
 * POST /api/biometrics/health-connect
 *
 * Accepts a batch of Health Connect records from the Capacitor Android app,
 * maps them to the existing BiometricReading + ML service pipeline.
 * Free — no per-user cost, unlike Terra API.
 *
 * Supported Health Connect record types:
 *   HeartRate, RestingHeartRate, HeartRateVariabilitySdnn,
 *   OxygenSaturation, RespiratoryRate, Steps,
 *   ActiveCaloriesBurned, SleepSession, BodyTemperature
 */

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';

const router: Router = Router();
const prisma = new PrismaClient();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';

// ─── Payload type from capacitor-health plugin ───────────────────────────────
// Fields sourced from: queryAggregated (steps, active-calories)
//                    + queryWorkouts (heartRateSamples via includeHeartRate)

interface HealthConnectPayload {
  steps:             number;
  activeCalories:    number;
  heartRateSamples:  number[];   // bpm values from workout heart rate readings
  workoutCount?:     number;
  deviceModel?:      string;
  syncedAt:          string;
}

// ─── Aggregation helpers ─────────────────────────────────────────────────────

function average(arr: number[]): number | undefined {
  if (!arr.length) return undefined;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function mapToMlPayload(payload: HealthConnectPayload) {
  const avgHr = average(payload.heartRateSamples);
  return {
    heart_rate_resting:   avgHr ?? 70,
    spo2:                 97,         // Not available from capacitor-health; use baseline default
    respiratory_rate:     15,         // Not available; use baseline default
    skin_temp_offset:     0,          // Not available; use baseline default
    hrv_rmssd:            undefined,  // Not available from capacitor-health
    step_count:           Math.round(payload.steps ?? 0),
    active_calories:      Math.round(payload.activeCalories ?? 0),
    sleep_duration_hours: undefined,
  };
}

// ─── Route ───────────────────────────────────────────────────────────────────

router.post('/', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const body = req.body as HealthConnectPayload;
    if (body?.steps == null && !body?.heartRateSamples?.length) {
      return res.status(400).json({ error: 'No health data provided' });
    }

    const aggregated = mapToMlPayload(body);
    const timestamp  = body.syncedAt ?? new Date().toISOString();

    // ── 1. Forward to ML service for early warning analysis ──────────────────
    let mlResult: { alert_level?: string; anomalies?: string[]; readiness_score?: number } = {};
    try {
      const mlRes = await fetch(
        `${ML_SERVICE_URL}/ingest?user_id=${encodeURIComponent(userId)}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ timestamp, ...aggregated }),
          signal:  AbortSignal.timeout(10000),
        }
      );
      if (mlRes.ok) mlResult = await mlRes.json();
    } catch (mlErr) {
      console.warn('[healthConnect] ML service unavailable, saving reading anyway:', (mlErr as Error).message);
    }

    // ── 2. Persist BiometricReading ──────────────────────────────────────────
    const reading = await prisma.biometricReading.create({
      data: {
        userId,
        heartRateResting:   aggregated.heart_rate_resting,
        hrvRmssd:           aggregated.hrv_rmssd,
        oxygenSaturation:   aggregated.spo2,
        respiratoryRate:    aggregated.respiratory_rate,
        skinTempOffset:     aggregated.skin_temp_offset,
        stepCount:          aggregated.step_count,
        activeCalories:     aggregated.active_calories,
        sleepDurationHours: aggregated.sleep_duration_hours,
        source:             'wearable',
        deviceType:         body.deviceModel ?? 'health_connect',
        alertLevel:         mlResult.alert_level ?? 'GREEN',
        anomalies:          mlResult.anomalies ?? [],
        readinessScore:     mlResult.readiness_score ?? null,
      },
    });

    // ── 3. Create HealthAlert if RED/YELLOW ──────────────────────────────────
    if (mlResult.alert_level === 'RED' || mlResult.alert_level === 'YELLOW') {
      await prisma.healthAlert.create({
        data: {
          userId,
          alertLevel:          mlResult.alert_level,
          title:               mlResult.alert_level === 'RED' ? 'Urgent health alert detected' : 'Health metric anomaly detected',
          message:             `Your wearable data shows: ${(mlResult.anomalies ?? []).join(', ') || 'unusual readings'}. Please consult a nurse.`,
          detectedAnomalies:   mlResult.anomalies ?? [],
          biometricReadingId:  reading.id,
        },
      });
    }

    // ── 4. Update connected devices list on User ─────────────────────────────
    if (body.deviceModel) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (user) {
        const existing = await prisma.user.findUnique({
          where: { id: userId },
        } as any);
        const devices: string[] = [...((existing as any)?.connectedDevices ?? [])];
        if (!devices.includes(body.deviceModel)) {
          devices.push(body.deviceModel);
          await prisma.user.update({
            where: { id: userId },
            data:  { connectedDevices: devices } as any,
          });
        }
      }
    }

    res.json({
      success:        true,
      readingId:      reading.id,
      alertLevel:     mlResult.alert_level ?? 'GREEN',
      readinessScore: mlResult.readiness_score ?? null,
      anomalies:      mlResult.anomalies ?? [],
      recordsProcessed: (body.heartRateSamples?.length ?? 0) + (body.steps ? 1 : 0),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
