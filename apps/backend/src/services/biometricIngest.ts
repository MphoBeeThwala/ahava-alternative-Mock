/**
 * Records one biometric submission (manual entry, or a wearable / phone
 * health-store sync) and runs it through early-warning monitoring.
 *
 * Shared by POST /patient/biometrics and POST /biometrics/health-connect so
 * both take exactly the same path: store only what was measured, forward to the
 * ML service without padding, de-duplicate alerts.
 */
import Joi from "joi";
import prisma from "../lib/prisma";
import { processBiometricReading, detectEarlyWarningSigns } from "./monitoring";

export const submitBiometricsSchema = Joi.object({
  // Core vitals
  heartRate: Joi.number().min(30).max(220).optional(),
  heartRateResting: Joi.number().min(30).max(200).optional(),
  hrvRmssd: Joi.number().min(0).max(300).optional(), // Heart Rate Variability
  bloodPressure: Joi.object({
    systolic: Joi.number().min(50).max(250).required(),
    diastolic: Joi.number().min(30).max(150).required(),
  })
    // A transposed or mistyped pair (e.g. 100/125) is a data-entry error: ask for a
    // re-measure instead of treating the diastolic as a crisis-range reading.
    .custom((v, helpers) =>
      v.systolic > v.diastolic ? v : helpers.message({ custom: "Systolic must be higher than diastolic. Please re-check the reading." }),
    )
    .optional(),
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
  ecgRhythm: Joi.string().valid("regular", "irregular", "unknown").optional(),
  temperatureTrend: Joi.string()
    .valid("normal", "elevated_single_day", "elevated_over_3_days")
    .optional(),
  // Overnight oximetry (forwarded to the early-warning engine)
  spo2NightMin: Joi.number().min(50).max(100).optional(),
  nightOdiPerHr: Joi.number().min(0).max(150).optional(),

  // Source
  source: Joi.string().valid("wearable", "manual").default("manual"),
  deviceType: Joi.string().optional(), // e.g., 'apple_watch', 'fitbit', 'manual_entry'
});

export type BiometricSubmission = {
  heartRate?: number; heartRateResting?: number; hrvRmssd?: number;
  bloodPressure?: { systolic: number; diastolic: number };
  oxygenSaturation?: number; temperature?: number; respiratoryRate?: number;
  weight?: number; height?: number; glucose?: number;
  stepCount?: number; activeCalories?: number; skinTempOffset?: number;
  sleepDurationHours?: number; ecgRhythm?: string; temperatureTrend?: string;
  spo2NightMin?: number; nightOdiPerHr?: number;
  source: string; deviceType?: string;
};

/**
 * A wearable's plain heart rate is an average over activity, not a resting
 * value, so it is never promoted to "resting". A manual entry has no such
 * distinction (the person took their pulse), so it still is.
 */
export const restingHeartRate = (v: Pick<BiometricSubmission, "source" | "heartRate" | "heartRateResting">) =>
  v.source === "wearable" ? v.heartRateResting : v.heartRateResting || v.heartRate;

export async function ingestBiometrics(userId: string, value: BiometricSubmission) {
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
          heartRateResting: restingHeartRate(value),
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
      throw new Error("Model not available");
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
      gen_random_uuid()::text, ${userId}, ${value.heartRate}, ${restingHeartRate(value)}, ${value.hrvRmssd},
      ${value.bloodPressure?.systolic}, ${value.bloodPressure?.diastolic}, ${value.oxygenSaturation},
      ${value.temperature}, ${value.respiratoryRate}, ${value.weight}, ${value.height}, ${value.glucose},
      ${value.stepCount}, ${value.activeCalories}, ${value.skinTempOffset},
      ${value.sleepDurationHours ?? null}, ${value.ecgRhythm ?? null}, ${value.temperatureTrend ?? null},
      ${value.source}, ${value.deviceType}, NOW()
    ) RETURNING id
  `;
    biometricRecord = { id: result[0]?.id || "temp-id" };
  }

  // Process through early warning monitoring system
  const monitoringResult = await processBiometricReading(userId, value);
  const {
    alertLevel,
    anomalies,
    readinessScore,
    baselineStatus,
    recommendations,
  } = monitoringResult;

  // Detect early warning signs for specific conditions
  const earlyWarnings = detectEarlyWarningSigns(anomalies, value);

  // AH-36: these two writes touch different tables and neither depends
  // on the other's result (both only need biometricRecord.id and the
  // already-computed alertLevel/anomalies/readinessScore) — run them
  // concurrently instead of sequentially.
  const updateBiometricRecord = async (): Promise<void> => {
    try {
      if (
        prisma.biometricReading &&
        typeof prisma.biometricReading.update === "function"
      ) {
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
      console.warn(
        "[Patient] Failed to update biometric record:",
        updateError,
      );
    }
  };

  const createAlertIfNeeded = async (): Promise<{ id: string } | null> => {
    if (!(alertLevel !== "GREEN" && anomalies.length > 0)) return null;
    try {
      // A condition that is still present (chronic hypertension, say) is
      // re-detected on every reading; alerting each time buries the patient.
      // Alert only when this level has a category that has not already
      // alerted, unresolved, in the last 7 days. An escalation to a new
      // level always alerts.
      // Anomaly text carries live numbers, so group on its leading
      // identifier (e.g. "bp_sustained_elevated"), and ignore the
      // informational notes that are not conditions.
      const category = (a: unknown) =>
        String(a).match(/^[A-Za-z0-9_]+/)?.[0] ?? String(a);
      const notCondition = new Set(["Suppressed", "No", "Exercise"]);
      const current = [...new Set(anomalies.map(category))].filter(
        (c) => !notCondition.has(c),
      );
      const recent = await prisma.healthAlert.findMany({
        where: {
          userId,
          alertLevel,
          resolved: false,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, detectedAnomalies: true },
      });
      const alerted = new Set(
        recent.flatMap((r) =>
          Array.isArray(r.detectedAnomalies)
            ? (r.detectedAnomalies as unknown[]).map(category)
            : [],
        ),
      );
      const duplicate = current.every((c) => alerted.has(c)) ? recent[0] : undefined;
      if (duplicate) return { id: duplicate.id };
      if (
        prisma.healthAlert &&
        typeof prisma.healthAlert.create === "function"
      ) {
        return await prisma.healthAlert.create({
          data: {
            userId,
            alertLevel: alertLevel as "YELLOW" | "RED",
            title:
              alertLevel === "RED"
                ? "Critical Health Alert"
                : "Health Warning",
            message: `Detected ${anomalies.length} biometric anomaly(ies): ${anomalies.slice(0, 2).join(", ")}${anomalies.length > 2 ? "..." : ""}`,
            detectedAnomalies: anomalies as any,
            biometricReadingId: biometricRecord.id,
          },
        });
      }
      // Fallback: Create alert via raw SQL
      const alertResult = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO health_alerts (
          id, "userId", "alertLevel", title, message, "detectedAnomalies", "biometricReadingId", "createdAt"
        ) VALUES (
          gen_random_uuid()::text, ${userId}, ${alertLevel},
          ${alertLevel === "RED" ? "Critical Health Alert" : "Health Warning"},
          ${`Detected ${anomalies.length} biometric anomaly(ies): ${anomalies.slice(0, 2).join(", ")}${anomalies.length > 2 ? "..." : ""}`},
          ${JSON.stringify(anomalies)}::jsonb,
          ${biometricRecord.id},
          NOW()
        ) RETURNING id
      `;
      return { id: alertResult[0]?.id };
    } catch (alertError) {
      console.warn("[Patient] Failed to create alert:", alertError);
      return null;
    }
  };

  const [, alert] = await Promise.all([
    updateBiometricRecord(),
    createAlertIfNeeded(),
  ]);

  return {
    timestamp,
    biometricRecord,
    alert,
    alertLevel,
    anomalies,
    readinessScore,
    baselineStatus,
    recommendations,
    earlyWarnings,
  };
}
