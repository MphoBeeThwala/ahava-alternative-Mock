import { Router } from "express";
import {
  AuthenticatedRequest,
  authMiddleware,
  invalidateCachedUser,
} from "../middleware/auth";
import { rateLimiter } from "../middleware/rateLimiter";
import { ingestBiometrics, submitBiometricsSchema } from "../services/biometricIngest";
import { idempotencyMiddleware } from "../middleware/idempotency";
import axios from "axios";
import Joi from "joi";
import {
  fallbackAnalysis,
  processBiometricReading,
  getMonitoringSummary,
  detectEarlyWarningSigns,
} from "../services/monitoring";
import { startDemoStream } from "../services/demoStream";
import { mlServiceHeaders } from "../services/mlServiceAuth";
import prisma from "../lib/prisma";
import { hashValue, writeClinicalAudit } from "../services/clinicalAudit";
import { captureReadingSnapshot } from "../services/research/researchCapture";

const router: Router = Router();

// ML Service URL (from environment or default)
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

// Validation schemas

// Submit biometrics (from wearable or manual entry)
router.post(
  "/biometrics",
  rateLimiter,
  authMiddleware,
  idempotencyMiddleware({ scope: "patient-biometrics" }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { error, value } = submitBiometricsSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const userId = req.user!.id;
      const {
        timestamp, biometricRecord, alert, alertLevel, anomalies, readinessScore,
        baselineStatus, recommendations, earlyWarnings,
      } = await ingestBiometrics(userId, value);

      res.json({
        success: true,
        message: "Biometrics recorded successfully",
        alertLevel: alertLevel || "GREEN",
        anomalies: anomalies || [],
        readinessScore: readinessScore ?? 100,
        baselineStatus: baselineStatus || "STABLE",
        recommendations: recommendations || [],
        earlyWarnings: earlyWarnings || [],
        data: {
          timestamp,
          source: value.source,
          deviceType: value.deviceType,
          alertLevel: alertLevel || "GREEN",
          anomalies: anomalies || [],
          readinessScore: readinessScore ?? 100,
          baselineStatus: baselineStatus || "STABLE",
          recommendations: recommendations || [],
          earlyWarnings: earlyWarnings || [],
          biometricReadingId: biometricRecord.id,
          alertId: alert?.id,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

// Get patient's biometric history
router.get(
  "/biometrics/history",
  authMiddleware,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.limit), 10) || 30),
      );
      const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);

      // Get readiness score from ML service
      let readinessScore = null;
      let baselineStatus = "CALIBRATING";

      try {
        const scoreResponse = await axios.get(
          `${ML_SERVICE_URL}/readiness-score/${userId}`,
          {
            timeout: 5000,
            headers: mlServiceHeaders(),
          },
        );
        readinessScore = scoreResponse.data.score;
        baselineStatus = scoreResponse.data.baseline_status;
      } catch (mlError: any) {
        console.warn("[Patient] ML service unavailable:", mlError.message);
      }

      // Fetch biometric history from database
      let history: any[] = [];
      try {
        history = await prisma.biometricReading.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
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
        console.error(
          "[Patient] Failed to fetch biometric history:",
          historyError?.message || historyError,
        );
        return res.status(503).json({
          success: false,
          error:
            "Unable to load biometric history. Database may be unavailable.",
        });
      }

      res.json({
        success: true,
        data: {
          readinessScore,
          baselineStatus,
          baselineEstablished: baselineStatus !== "CALIBRATING",
          history,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

// Get early warning alerts
router.get(
  "/alerts",
  authMiddleware,
  async (req: AuthenticatedRequest, res, next) => {
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
            orderBy: { createdAt: "desc" },
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
        console.warn("[Patient] Failed to fetch alerts:", alertsError);
      }

      res.json({
        success: true,
        alerts,
      });
    } catch (error) {
      return next(error);
    }
  },
);

// Get monitoring summary
router.get(
  "/monitoring/summary",
  authMiddleware,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const summary = await getMonitoringSummary(userId);
      return res.json({
        success: true,
        data: summary,
      });
    } catch (error: any) {
      console.error(
        "[Patient] Monitoring summary failed:",
        error?.message || error,
      );
      return res.status(503).json({
        success: false,
        error:
          "Unable to load monitoring summary. Database or ML service may be unavailable.",
      });
    }
  },
);

// Get Early Warning dashboard (risk scores, trajectory, clinical flags)
router.get(
  "/early-warning",
  authMiddleware,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.id;

      const [user, latestReading, bodyReading, recentBp] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { dateOfBirth: true, riskProfile: true, gender: true },
        }),
        prisma.biometricReading.findFirst({
          where: { userId },
          orderBy: { createdAt: "desc" },
        }),
        // Latest weight and height, which may sit on different rows
        prisma.biometricReading.findMany({
          where: { userId, OR: [{ weight: { not: null } }, { height: { not: null } }] },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { weight: true, height: true },
        }),
        prisma.biometricReading.findMany({
          where: { userId, bloodPressureSystolic: { not: null } },
          orderBy: { createdAt: "desc" },
          take: 14,
          select: { bloodPressureSystolic: true },
        }),
      ]);

      if (!latestReading) {
        return res.status(404).json({
          success: false,
          error:
            "No biometric data yet. Submit at least one reading to see your Early Warning summary.",
        });
      }

      const riskProfile =
        (user?.riskProfile as { smoker?: boolean; hypertension?: boolean }) ||
        {};
      const age = user?.dateOfBirth
        ? Math.floor(
            (Date.now() - new Date(user.dateOfBirth).getTime()) /
              (365.25 * 24 * 60 * 60 * 1000),
          )
        : 50;
      // Measured inputs for the risk charts. Each stays undefined (so the
      // engine reports it as missing) unless there is real data behind it;
      // nothing is assumed.
      const sexRaw = String(user?.gender ?? "").trim().toLowerCase();
      const sex =
        sexRaw === "m" || sexRaw === "male"
          ? "male"
          : sexRaw === "f" || sexRaw === "female"
            ? "female"
            : undefined;
      const weightKg = bodyReading.find((b) => b.weight != null)?.weight;
      const heightCm = bodyReading.find((b) => b.height != null)?.height;
      const bmi =
        weightKg && heightCm && heightCm > 0
          ? Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10
          : undefined;
      const systolicBp = recentBp.length
        ? Math.round(
            recentBp.reduce((a, r) => a + Number(r.bloodPressureSystolic), 0) /
              recentBp.length,
          )
        : undefined;
      const context = {
        age: Math.max(18, Math.min(120, age)),
        ...(sex ? { sex } : {}),
        ...(bmi ? { bmi } : {}),
        ...(systolicBp ? { systolic_bp: systolicBp } : {}),
        smoker: Boolean(riskProfile.smoker),
        hypertension: Boolean(riskProfile.hypertension),
        cholesterol_known: Boolean(
          (user?.riskProfile as any)?.cholesterolKnown,
        ),
        cholesterol_mmol_per_L:
          (user?.riskProfile as any)?.cholesterolValue ?? null,
      };

      const r = latestReading as any;
      const toIso = (d: Date | string | null | undefined) =>
        d ? new Date(d).toISOString() : new Date().toISOString();
      const clamp = (
        v: number | null | undefined,
        min: number,
        max: number,
        def: number,
      ) => (v != null ? Math.min(max, Math.max(min, Number(v))) : def);
      const biometrics = {
        timestamp: toIso(r.createdAt),
        heart_rate_resting: clamp(
          r.heartRateResting ?? r.heartRate,
          30,
          200,
          72,
        ),
        hrv_rmssd: clamp(r.hrvRmssd, 0, 300, 35),
        spo2: clamp(r.oxygenSaturation, 50, 100, 98),
        skin_temp_offset: clamp(r.skinTempOffset, -5, 5, 0),
        respiratory_rate: clamp(r.respiratoryRate, 4, 60, 16),
        step_count: Math.max(0, Number(r.stepCount) || 0),
        active_calories: Math.max(0, Number(r.activeCalories) || 0),
        sleep_duration_hours: Math.min(
          24,
          Math.max(0, Number(r.sleepDurationHours) || 0),
        ),
        ecg_rhythm: ["regular", "irregular", "unknown"].includes(r.ecgRhythm)
          ? r.ecgRhythm
          : "unknown",
        temperature_trend: [
          "normal",
          "elevated_single_day",
          "elevated_over_3_days",
        ].includes(r.temperatureTrend)
          ? r.temperatureTrend
          : "normal",
      };

      // Try ML service first, with graceful fallback to database-only analysis
      let mlData: any;
      // Local dev skips the ML service unless explicitly opted in, so a
      // developer without it running still gets the DB-only fallback.
      const mlServiceAvailable =
        process.env.ML_SERVICE_URL &&
        (!process.env.ML_SERVICE_URL.includes("localhost") ||
          process.env.ML_SERVICE_ALLOW_LOCALHOST === "true");

      if (mlServiceAvailable) {
       try {
        try {
          // POST (not GET) so the per-request context (sex, BMI, measured
          // systolic) reaches the engine; those are deliberately not stored.
          const summaryRes = await axios.post(
            `${ML_SERVICE_URL}/early-warning/summary/${encodeURIComponent(userId)}`,
            { context },
            {
              timeout: 8000,
              headers: mlServiceHeaders(),
            },
          );
          mlData = summaryRes.data;
        } catch (summaryErr: any) {
          if (summaryErr.response?.status !== 404) throw summaryErr;
          // ML has no history: backfill from DB (last 20 readings, send oldest-first so baseline works)
          const recentReadings = await prisma.biometricReading.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
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
            const ts = r.createdAt
              ? new Date(r.createdAt).toISOString()
              : new Date().toISOString();
            const clamp = (
              v: number | null | undefined,
              min: number,
              max: number,
              def: number,
            ) => (v != null ? Math.min(max, Math.max(min, Number(v))) : def);
            try {
              await axios.post(
                `${ML_SERVICE_URL}/ingest?user_id=${encodeURIComponent(userId)}`,
                {
                  timestamp: ts,
                  heart_rate_resting: clamp(
                    r.heartRateResting ?? r.heartRate,
                    30,
                    200,
                    72,
                  ),
                  hrv_rmssd: clamp(r.hrvRmssd, 0, 300, 35),
                  spo2: clamp(r.oxygenSaturation, 50, 100, 98),
                  skin_temp_offset: clamp(r.skinTempOffset, -5, 5, 0),
                  respiratory_rate: clamp(r.respiratoryRate, 4, 60, 16),
                  step_count: Math.max(0, Number(r.stepCount) || 0),
                  active_calories: Math.max(0, Number(r.activeCalories) || 0),
                  sleep_duration_hours: Math.min(
                    24,
                    Math.max(0, Number(r.sleepDurationHours) || 0),
                  ),
                  ecg_rhythm: ["regular", "irregular", "unknown"].includes(
                    r.ecgRhythm,
                  )
                    ? r.ecgRhythm
                    : "unknown",
                  temperature_trend: [
                    "normal",
                    "elevated_single_day",
                    "elevated_over_3_days",
                  ].includes(r.temperatureTrend)
                    ? r.temperatureTrend
                    : "normal",
                },
                {
                  timeout: 3000,
                  headers: mlServiceHeaders(),
                },
              );
            } catch (_) {
              // ignore single ingest failure
            }
          }
          const analyzeRes = await axios.post(
            `${ML_SERVICE_URL}/early-warning/analyze?user_id=${encodeURIComponent(userId)}`,
            { biometrics, context },
            {
              timeout: 10000,
              headers: mlServiceHeaders(),
            },
          );
          mlData = analyzeRes.data;
        }
       } catch (mlErr: any) {
        // The ML service being down, slow, misconfigured (auth, version skew)
        // or failing on this patient's data must not take the page down: serve
        // the degraded, clearly-labelled rules below instead of a 500.
        console.warn(
          "[EarlyWarning] ML service failed; serving degraded rules:",
          mlErr.response?.status ?? mlErr.code ?? "",
          mlErr.response?.data?.detail ?? mlErr.message,
        );
        mlData = undefined;
       }
      }

      // Fallback to database-only analysis if ML service unavailable (this
      // is the path taken for essentially all of local dev, since
      // mlServiceAvailable is false whenever ML_SERVICE_URL contains
      // "localhost" — not just when the service is genuinely down).
      //
      // Shape matches the real ml-service EarlyWarningSummary exactly
      // (apps/ml-service/models.py) — this used to be a different, older
      // shape (riskLevel/trendAnalysis/baselineMetrics) that predated the
      // AH-45 refactor and that the real ml_service response was never
      // reshaped into either, so the frontend was built against a payload
      // shape real traffic never actually sent. One consistent contract
      // now, regardless of which branch fills mlData.
      if (!mlData) {
        const allReadings = await prisma.biometricReading.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 30,
        });

        // Basic absolute thresholds on what the patient actually measured, not a
        // blanket GREEN: a degraded engine must still flag a crisis-range BP.
        const latestBp = allReadings.find(
          (x) => x.bloodPressureSystolic != null && x.bloodPressureDiastolic != null,
        );
        const bpIsRecent =
          latestBp && Date.now() - new Date(latestBp.createdAt).getTime() <= 72 * 3600 * 1000;
        const lr: any = latestReading;
        const basic = fallbackAnalysis({
          heartRate: lr.heartRateResting ?? lr.heartRate ?? undefined,
          oxygenSaturation: lr.oxygenSaturation ?? undefined,
          respiratoryRate: lr.respiratoryRate ?? undefined,
          bloodPressure: bpIsRecent
            ? {
                systolic: Number(latestBp!.bloodPressureSystolic),
                diastolic: Number(latestBp!.bloodPressureDiastolic),
              }
            : undefined,
        });

        mlData = {
          _source: "db_rules",
          user_id: userId,
          processed_at: new Date().toISOString(),
          heart_rate_resting: biometrics.heart_rate_resting,
          hrv_rmssd: biometrics.hrv_rmssd,
          spo2: biometrics.spo2,
          sleep_duration_hours: biometrics.sleep_duration_hours,
          step_count: biometrics.step_count,
          ecg_rhythm: biometrics.ecg_rhythm,
          temperature_trend: biometrics.temperature_trend,
          hr_baseline: null,
          hrv_baseline: null,
          hr_trend_2w: null,
          hrv_vs_baseline: null,
          sleep_pattern: null,
          cvd_risk: {
            instrument: "WHO_2019_NON_LAB_SOUTHERN_SUB_SAHARAN_AFRICA",
            computable: false,
            risk_category: null,
            reasons_not_computable: ["ML_SERVICE_UNAVAILABLE"],
            discordance_flag: false,
            physiological_trend_flags: [],
            epidemiological_flags: [],
          },
          framingham_lab_risk: {
            instrument: "FRAMINGHAM_LAB_2008_SA_NDOH_APPENDIX_VII",
            computable: false,
            ten_year_risk_pct: null,
            risk_bound: null,
            total_points: null,
            reasons_not_computable: ["ML_SERVICE_UNAVAILABLE"],
            statin_indicated_by_diabetes_flag: false,
          },
          bp_risk: {
            prompt_bp_check: false,
            hr_deviation: false,
            hrv_deviation: false,
            short_sleep: false,
            signed_off: false,
            contributing_signals: [],
            disclaimer:
              "Not a blood pressure measurement or a hypertension risk score. Your own signals have shifted from your own baseline — a measured blood pressure reading is recommended to follow up. This flag cannot diagnose anything on its own.",
          },
          fusion: {
            trajectory_risk_2y_pct: null,
            alert_triggered: false,
            alert_message: null,
          },
          clinical_flags: [],
          alert_level: basic.alertLevel,
          anomalies: basic.anomalies,
          recommendations:
            allReadings.length === 0
              ? [
                  "Please add your first biometric reading to get personalized recommendations",
                ]
              : [
                  "Our full analysis is temporarily unavailable, so this check uses basic limits only. Trends and risk scores are not shown.",
                  ...basic.recommendations,
                ],
        };
      }

      // Safety envelope: enforce uncertainty/provenance contract even on legacy/fallback payloads.
      if (!(mlData as any).uncertainty) {
        (mlData as any).uncertainty = {
          score: (mlData as any)._source === "db_rules" ? 0.55 : 0.4,
          reasons:
            (mlData as any)._source === "db_rules"
              ? ["ML_SERVICE_UNAVAILABLE_FALLBACK"]
              : [],
        };
      }
      if (!(mlData as any).provenance) {
        (mlData as any).provenance = {
          evidence_sources: ["Local rule-based fallback"],
          clinical_basis: ["Deterministic threshold checks"],
          model_version:
            (mlData as any)._source === "db_rules"
              ? "fallback-rules-v1"
              : "unknown",
          decision_trace_id: hashValue(`${userId}:${Date.now()}`).slice(0, 24),
        };
      }
      const uncertaintyScore = Number(
        (mlData as any)?.uncertainty?.score ?? 0.5,
      );
      (mlData as any).requires_clinician_review = Boolean(
        (mlData as any)?.requires_clinician_review ||
        uncertaintyScore >= 0.45 ||
        (mlData as any)?.alert_level === "RED" ||
        (mlData as any)?.alert_level === "YELLOW",
      );

      // Retrospective-validation snapshot (docs/ENGINEERING_PLAN.md #29):
      // bp_risk/cvd_risk were computed fresh here and discarded after the
      // response, leaving nothing to compare against a later manual cuff
      // entry for CLINICAL_SIGNOFF_CHECKLIST.md rows 7/10. Persisted onto
      // the reading this analysis was computed from — best-effort, must
      // never fail the actual response the patient is waiting on.
      try {
        await prisma.biometricReading.update({
          where: { id: latestReading.id },
          data: {
            bpPromptCheck: Boolean((mlData as any)?.bp_risk?.prompt_bp_check),
            bpContributingSignals:
              (mlData as any)?.bp_risk?.contributing_signals ?? [],
            cvdRiskCategory: (mlData as any)?.cvd_risk?.risk_category ?? null,
            framinghamRiskPct:
              (mlData as any)?.framingham_lab_risk?.ten_year_risk_pct ?? null,
            framinghamRiskBound:
              (mlData as any)?.framingham_lab_risk?.risk_bound ?? null,
          },
        });
      } catch (persistErr: any) {
        console.warn(
          "[EarlyWarning] Failed to persist retrospective bp_risk/cvd_risk snapshot:",
          persistErr.message,
        );
      }

      // Research capture (docs/RESEARCH_DATA_PIPELINE.md): attaches what the
      // rules engine concluded to this reading's research snapshot, only for
      // patients who opted in. Fire-and-forget: it never delays or changes
      // the response, and it swallows its own errors.
      void captureReadingSnapshot(userId, latestReading, {
        alertLevel: (mlData as any)?.alert_level ?? null,
        cvdRiskCategory: (mlData as any)?.cvd_risk?.risk_category ?? null,
        framinghamRiskPct: (mlData as any)?.framingham_lab_risk?.ten_year_risk_pct ?? null,
        bpPromptCheck: (mlData as any)?.bp_risk?.prompt_bp_check ?? null,
        engineVersion: (mlData as any)?.provenance?.model_version ?? null,
      });

      const responseSource = String((mlData as any)?._source ?? "ml_service");
      await writeClinicalAudit({
        userId,
        userRole: req.user?.role,
        action: "EARLY_WARNING_ASSESSMENT",
        resource: "early_warning_summary",
        resourceId: userId,
        metadata: {
          source: responseSource,
          alertLevel: (mlData as any)?.alert_level ?? "UNKNOWN",
          cvdRiskCategory: (mlData as any)?.cvd_risk?.risk_category ?? null,
          bpPromptCheck: Boolean((mlData as any)?.bp_risk?.prompt_bp_check),
          anomalyCount: Array.isArray((mlData as any)?.anomalies)
            ? (mlData as any).anomalies.length
            : 0,
          alertTriggered: Boolean((mlData as any)?.fusion?.alert_triggered),
          uncertaintyScore,
          requiresClinicianReview: Boolean(
            (mlData as any)?.requires_clinician_review,
          ),
          decisionTraceId:
            (mlData as any)?.provenance?.decision_trace_id ?? null,
        },
      });

      return res.json({
        success: true,
        data: mlData,
        meta: {
          disclaimer:
            "Not a medical diagnosis. For informational purposes only.",
        },
      });
    } catch (error: any) {
      console.error("Early warning error:", error.message);
      if (error.response?.status === 404) {
        return res.status(404).json({
          success: false,
          error: "No biometric data found. Submit a reading first.",
        });
      }
      if (error.response?.status === 400 || error.response?.status === 422) {
        const detail =
          error.response?.data?.detail ??
          error.response?.data?.message ??
          error.message;
        return res.status(400).json({
          success: false,
          error:
            typeof detail === "string"
              ? detail
              : "Early warning request invalid.",
        });
      }
      // For other errors, return a generic response
      return res.status(500).json({
        success: false,
        error: "Failed to get early warning summary. Please try again.",
      });
    }
  },
);

const riskProfileSchema = Joi.object({
  smoker: Joi.boolean().optional(),
  hypertension: Joi.boolean().optional(),
  diabetes: Joi.boolean().optional(),
  asthmaOrCopd: Joi.boolean().optional(),
  pregnancy: Joi.boolean().optional(),
  familyHistoryCvd: Joi.boolean().optional(),
  activityLevel: Joi.string().valid("LOW", "MODERATE", "HIGH").optional(),
  alcoholUse: Joi.string().valid("NONE", "LOW", "MODERATE", "HIGH").optional(),
  cholesterolKnown: Joi.boolean().optional(),
  cholesterolValue: Joi.number().min(2).max(15).optional(),
  consentAcknowledged: Joi.boolean().optional(),
  onboardingCompleted: Joi.boolean().optional(),
  surveyVersion: Joi.number().integer().min(1).max(10).optional(),
  passportCompletionPercent: Joi.number().integer().min(0).max(100).optional(),
  nextPassportQuestion: Joi.string().max(300).optional(),
  medicalPassport: Joi.object({
    emergencyContactName: Joi.string().trim().allow("", null).optional(),
    emergencyContactPhone: Joi.string().trim().allow("", null).optional(),
    bloodType: Joi.string().trim().allow("", null).optional(),
    allergies: Joi.array().items(Joi.string().trim().max(120)).optional(),
    chronicConditions: Joi.array()
      .items(Joi.string().trim().max(120))
      .optional(),
    currentMedications: Joi.array()
      .items(Joi.string().trim().max(120))
      .optional(),
  }).optional(),
}).min(1);

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonEmptyStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => hasNonEmptyString(entry));
}

function calculateMedicalPassportCompletion(args: {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  dateOfBirth?: Date | string | null;
  gender?: string | null;
  medicalPassport: Record<string, unknown>;
}): number {
  const checks = [
    hasNonEmptyString(args.firstName) && hasNonEmptyString(args.lastName),
    hasNonEmptyString(args.phone),
    Boolean(args.dateOfBirth),
    hasNonEmptyString(args.gender),
    hasNonEmptyString(args.medicalPassport.emergencyContactName),
    hasNonEmptyString(args.medicalPassport.emergencyContactPhone),
    hasNonEmptyString(args.medicalPassport.bloodType),
    hasNonEmptyStringArray(args.medicalPassport.allergies),
    hasNonEmptyStringArray(args.medicalPassport.chronicConditions),
    hasNonEmptyStringArray(args.medicalPassport.currentMedications),
  ];

  return Math.round(
    (checks.filter(Boolean).length / checks.length) * 100,
  );
}

function getNextPassportQuestion(args: {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  dateOfBirth?: Date | string | null;
  gender?: string | null;
  medicalPassport: Record<string, unknown>;
}): string | undefined {
  const prompts = [
    {
      done: hasNonEmptyString(args.firstName) && hasNonEmptyString(args.lastName),
      prompt: "What is your full name?",
    },
    {
      done: hasNonEmptyString(args.phone),
      prompt: "What is your best contact number?",
    },
    {
      done: Boolean(args.dateOfBirth),
      prompt: "What is your date of birth?",
    },
    {
      done: hasNonEmptyString(args.gender),
      prompt: "What gender should we record for clinical care?",
    },
    {
      done: hasNonEmptyString(args.medicalPassport.emergencyContactName),
      prompt: "Who should we contact in an emergency?",
    },
    {
      done: hasNonEmptyString(args.medicalPassport.emergencyContactPhone),
      prompt: "What is your emergency contact's phone number?",
    },
    {
      done: hasNonEmptyString(args.medicalPassport.bloodType),
      prompt: "Do you know your blood type?",
    },
    {
      done: hasNonEmptyStringArray(args.medicalPassport.allergies),
      prompt: "Do you have any known allergies? (type None if none)",
    },
    {
      done: hasNonEmptyStringArray(args.medicalPassport.chronicConditions),
      prompt: "Any chronic conditions we should record? (type None if none)",
    },
    {
      done: hasNonEmptyStringArray(args.medicalPassport.currentMedications),
      prompt: "Are you taking any regular medications? (type None if none)",
    },
  ];

  return prompts.find((item) => !item.done)?.prompt;
}


router.patch(
  "/risk-profile",
  authMiddleware,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { error, value } = riskProfileSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }
      const userId = req.user!.id;
      const current = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          dateOfBirth: true,
          gender: true,
          riskProfile: true,
        },
      });
      const currentRiskProfile =
        ((current?.riskProfile as Record<string, unknown> | null) ?? {});
      const incomingRiskProfile = value as Record<string, unknown>;
      const currentMedicalPassport =
        currentRiskProfile.medicalPassport &&
        typeof currentRiskProfile.medicalPassport === "object"
          ? (currentRiskProfile.medicalPassport as Record<string, unknown>)
          : undefined;
      const incomingMedicalPassport =
        incomingRiskProfile.medicalPassport &&
        typeof incomingRiskProfile.medicalPassport === "object"
          ? (incomingRiskProfile.medicalPassport as Record<string, unknown>)
          : undefined;
      const mergedMedicalPassport = incomingMedicalPassport
        ? {
            ...(currentMedicalPassport ?? {}),
            ...incomingMedicalPassport,
          }
        : undefined;
      const calculatedPassportCompletionPercent = mergedMedicalPassport
        ? calculateMedicalPassportCompletion({
            firstName: current?.firstName,
            lastName: current?.lastName,
            phone: current?.phone,
            dateOfBirth: current?.dateOfBirth,
            gender: current?.gender,
            medicalPassport: mergedMedicalPassport,
          })
        : undefined;
      const nextPassportQuestion = mergedMedicalPassport
        ? getNextPassportQuestion({
            firstName: current?.firstName,
            lastName: current?.lastName,
            phone: current?.phone,
            dateOfBirth: current?.dateOfBirth,
            gender: current?.gender,
            medicalPassport: mergedMedicalPassport,
          })
        : undefined;

      const merged = {
        ...currentRiskProfile,
        ...incomingRiskProfile,
        ...(mergedMedicalPassport
          ? {
              medicalPassport: mergedMedicalPassport,
              passportCompletionPercent: calculatedPassportCompletionPercent,
              nextPassportQuestion,
            }
          : {}),
        updatedAt: new Date().toISOString(),
      };

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          riskProfile: {
            ...merged,
            // Safety check: ensure completion % is never dropped during
            // the write even if something upstream mutated `merged`.
            passportCompletionPercent:
              calculatedPassportCompletionPercent ??
              merged.passportCompletionPercent ??
              (currentRiskProfile as Record<string, unknown>)
                .passportCompletionPercent ??
              0,
          } as object,
        },
        select: { riskProfile: true },
      });
      await invalidateCachedUser(userId);
      const persistedRiskProfile =
        ((updatedUser.riskProfile as Record<string, unknown> | null) ??
          merged) as Record<string, unknown>;

      const ML_URL = (process.env.ML_SERVICE_URL ?? "").replace(/\/$/, "");
      const mlServiceAvailable = !!ML_URL && (!ML_URL.includes("localhost") || process.env.ML_SERVICE_ALLOW_LOCALHOST === "true");
      if (mlServiceAvailable) {
        const age = current?.dateOfBirth
          ? Math.floor(
              (Date.now() - new Date(current.dateOfBirth).getTime()) /
                (365.25 * 24 * 60 * 60 * 1000),
            )
          : 50;
        const context = {
          age: Math.max(18, Math.min(120, age)),
          smoker: Boolean((persistedRiskProfile as any).smoker),
          hypertension: Boolean((persistedRiskProfile as any).hypertension),
          cholesterol_known: Boolean((persistedRiskProfile as any).cholesterolKnown),
          cholesterol_mmol_per_L: (persistedRiskProfile as any).cholesterolValue ?? null,
        };
        axios
          .put(
            `${ML_URL}/early-warning/context/${encodeURIComponent(userId)}`,
            context,
            {
              timeout: 8000,
              headers: mlServiceHeaders(),
            },
          )
          .catch(() => {});
      }
      return res.json({ success: true, riskProfile: persistedRiskProfile });
    } catch (e) {
      return next(e);
    }
  },
);

// GET /api/patient/baseline-info
// Returns baseline establishment progress (days toward 14-day requirement)
router.get(
  "/baseline-info",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const firstReading = await prisma.biometricReading.findFirst({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });

      if (!firstReading) {
        return res.json({
          daysEstablished: 0,
          daysRequired: 14,
          isComplete: false,
        });
      }

      const daysDiff =
        Math.floor(
          (new Date().getTime() - new Date(firstReading.createdAt).getTime()) /
            (1000 * 60 * 60 * 24),
        ) + 1;

      const daysEstablished = Math.min(daysDiff, 14);
      const isComplete = daysEstablished >= 14;

      return res.json({ daysEstablished, daysRequired: 14, isComplete });
    } catch (e) {
      return res.status(500).json({ error: "Failed to get baseline info" });
    }
  },
);

// GET /api/patient/anomaly-timeline
// Returns daily anomaly timeline (last 30 days)
router.get(
  "/anomaly-timeline",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
      const daysBack = parseInt(req.query.days as string) || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);

      // Get daily summaries (one reading per day, preferring worst alert level)
      const readings = await prisma.biometricReading.findMany({
        where: {
          userId,
          createdAt: { gte: cutoffDate },
          alertLevel: { not: "GREEN" }, // Only non-normal readings
        },
        select: {
          createdAt: true,
          alertLevel: true,
          anomalies: true,
          heartRate: true,
          oxygenSaturation: true,
          temperature: true,
          respiratoryRate: true,
        },
        orderBy: { createdAt: "desc" },
        // Not `take: limit`: that counts readings, and with two or more a day it
        // silently shortened the window (30 readings = ~15 days). The limit is
        // applied to days, after grouping.
        take: 2000,
      });

      // Group by day, keeping worst alert level per day
      const timeline: any[] = [];
      const dayMap = new Map<string, any>();

      readings.forEach((r) => {
        const day = new Date(r.createdAt).toISOString().split("T")[0];
        const existing = dayMap.get(day);

        // Keep RED over YELLOW over GREEN
        const alertPriority: Record<string, number> = { RED: 3, YELLOW: 2, GREEN: 1 };
        if (
          !existing ||
          alertPriority[r.alertLevel || "GREEN"] >
            alertPriority[existing.alertLevel || "GREEN"]
        ) {
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
          respiratoryRate: value.respiratoryRate,
        });
      });

      timeline.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );

      return res.json(timeline.slice(0, limit));
    } catch (e) {
      console.error("Error loading timeline:", e);
      return res.status(500).json({ error: "Failed to load timeline" });
    }
  },
);

// POST /api/patient/demo/start-stream
// DEMO ONLY - Streams realistic biometric progression for investor demo.
//
// This injects synthetic vitals into the caller's own record, which feed
// baselines and early-warning alerts. Any authenticated patient could reach it
// in production, poisoning their own clinical history. Disabled unless
// explicitly switched on, so the demo still works on a staging deployment.
router.post("/demo/start-stream", async (req: AuthenticatedRequest, res) => {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_DEMO_STREAM !== "true"
  ) {
    return res.status(403).json({ error: "Demo stream is disabled" });
  }

  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { durationSeconds = 300, intervalSeconds = 30 } = req.query;

  try {
    startDemoStream(
      userId as string,
      parseInt(durationSeconds as string) || 300,
      parseInt(intervalSeconds as string) || 30,
    );

    return res.json({
      success: true,
      message: "Demo biometric stream started",
      userId,
      durationSeconds: parseInt(durationSeconds as string) || 300,
      intervalSeconds: parseInt(intervalSeconds as string) || 30,
      note: "Stream will submit realistic health data every 30 seconds",
    });
  } catch (e) {
    console.error("Error starting demo stream:", e);
    return res.status(500).json({ error: "Failed to start demo stream" });
  }
});

export default router;
