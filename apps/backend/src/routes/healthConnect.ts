/**
 * healthConnect.ts - phone health-store ingestion (no Terra/Rook needed)
 *
 * POST /api/v1/biometrics/health-connect
 *
 * The mobile app reads what the patient's watch has already synced to the
 * phone's health store (Google Health Connect on Android, Apple Health on
 * iPhone) and posts one summary here. Free: no per-user vendor fee.
 *
 * Only values the device actually measured are accepted and stored. Anything
 * missing stays missing: it is never replaced by a "typical" number, because a
 * made-up SpO2 or heart rate in a patient's baseline can hide a real problem.
 * The reading then goes through the same pipeline as a manual submission
 * (services/biometricIngest.ts): partial submissions are checked against the
 * absolute thresholds, and only a complete wearable set trains the ML baseline.
 */

import { Router, Response, NextFunction } from "express";
import Joi from "joi";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { rateLimiter } from "../middleware/rateLimiter";
import { idempotencyMiddleware } from "../middleware/idempotency";
import prisma from "../lib/prisma";
import { ingestBiometrics } from "../services/biometricIngest";

const router: Router = Router();

const syncSchema = Joi.object({
  platform: Joi.string().valid("android", "ios").optional(),
  deviceModel: Joi.string().max(100).optional(),
  syncedAt: Joi.date().iso().max("now").optional(),

  // Measured by the device
  heartRate: Joi.number().min(30).max(220).optional(), // average over the window, NOT resting
  heartRateResting: Joi.number().min(30).max(200).optional(),
  hrvRmssd: Joi.number().min(0).max(300).optional(), // Android reports RMSSD
  hrvSdnn: Joi.number().min(0).max(300).optional(), // Apple reports SDNN: a different measure, kept out of the RMSSD baseline
  oxygenSaturation: Joi.number().min(50).max(100).optional(),
  respiratoryRate: Joi.number().min(4).max(60).optional(),
  temperature: Joi.number().min(30).max(45).optional(),
  skinTempOffset: Joi.number().min(-5).max(5).optional(),
  sleepDurationHours: Joi.number().min(0).max(24).optional(),
  steps: Joi.number().min(0).optional(),
  activeCalories: Joi.number().min(0).optional(),
  bloodPressure: Joi.object({
    systolic: Joi.number().min(50).max(250).required(),
    diastolic: Joi.number().min(30).max(150).required(),
  })
    .custom((v, helpers) =>
      v.systolic > v.diastolic ? v : helpers.message({ custom: "Systolic must be higher than diastolic" }),
    )
    .optional(),

  // Older app builds sent workout heart-rate samples. Their average is an
  // exercise heart rate, so it is stored as heartRate, never as resting.
  heartRateSamples: Joi.array().items(Joi.number().min(30).max(220)).max(5000).optional(),
}).unknown(false);

const MEASURED_FIELDS = [
  "heartRate", "heartRateResting", "hrvRmssd", "hrvSdnn", "oxygenSaturation", "respiratoryRate",
  "temperature", "skinTempOffset", "sleepDurationHours", "steps", "activeCalories", "bloodPressure",
] as const;

const average = (xs: number[]): number | undefined =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;

router.post(
  "/",
  rateLimiter,
  authMiddleware,
  idempotencyMiddleware({ scope: "health-connect-sync" }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { error, value } = syncSchema.validate(req.body ?? {}, { abortEarly: true });
      if (error) return res.status(400).json({ error: error.details[0].message });

      const sampleAverage = average(value.heartRateSamples ?? []);
      const heartRate = value.heartRate ?? sampleAverage;
      const hasData =
        heartRate != null || MEASURED_FIELDS.some((f) => f !== "heartRate" && value[f] != null);
      if (!hasData) return res.status(400).json({ error: "No health data provided" });

      const deviceType =
        value.deviceModel ?? (value.platform === "ios" ? "apple_health" : "health_connect");

      const result = await ingestBiometrics(userId, {
        heartRate: heartRate != null ? Math.round(heartRate * 10) / 10 : undefined,
        heartRateResting: value.heartRateResting,
        hrvRmssd: value.hrvRmssd,
        oxygenSaturation: value.oxygenSaturation,
        respiratoryRate: value.respiratoryRate,
        temperature: value.temperature,
        skinTempOffset: value.skinTempOffset,
        sleepDurationHours: value.sleepDurationHours,
        stepCount: value.steps != null ? Math.round(value.steps) : undefined,
        activeCalories: value.activeCalories,
        bloodPressure: value.bloodPressure,
        source: "wearable",
        deviceType,
      });

      // Remember which devices have synced, for the "connected devices" list.
      if (value.deviceModel) {
        const user = await prisma.user.findUnique({ where: { id: userId } } as any);
        const devices: string[] = [...((user as any)?.connectedDevices ?? [])];
        if (!devices.includes(value.deviceModel)) {
          devices.push(value.deviceModel);
          await prisma.user.update({ where: { id: userId }, data: { connectedDevices: devices } as any });
        }
      }

      return res.json({
        success: true,
        readingId: result.biometricRecord.id,
        alertLevel: result.alertLevel,
        readinessScore: result.readinessScore,
        anomalies: result.anomalies,
        baselineStatus: result.baselineStatus,
        recordsProcessed: MEASURED_FIELDS.filter((f) => value[f] != null).length + (sampleAverage != null ? 1 : 0),
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
