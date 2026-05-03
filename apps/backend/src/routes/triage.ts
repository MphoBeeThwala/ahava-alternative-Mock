import { Router } from "express";
import { analyzeSymptoms } from "../services/aiTriage";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { rateLimiter } from "../middleware/rateLimiter";
import { requireConsent } from "../middleware/consentMiddleware";
import { aiTriageBudgetMiddleware } from "../middleware/aiTriageBudget";
import { calculateSlaDeadline, getDoctorFee } from "../jobs/triageEscalation";
import { broadcastToUsers } from "../services/websocket";
import prisma from "../lib/prisma";
import { randomUUID } from "crypto";
import { hashValue, writeClinicalAudit } from "../services/clinicalAudit";

const router: Router = Router();

// POST /api/triage – run AI triage and create a case for doctor review
router.post(
  "/",
  rateLimiter,
  authMiddleware,
  aiTriageBudgetMiddleware,
  requireConsent("AI_TRIAGE"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { symptoms, imageBase64 } = req.body;
      const patientId = req.user?.id;
      const caseId = randomUUID();

      if (!symptoms) {
        return res
          .status(400)
          .json({ error: "Symptoms description is required" });
      }
      if (!patientId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // ── Enrich AI prompt with patient's real health data ──────────────────
      let patientContext: string | undefined;
      let latestVitalsSnapshot:
        | {
            heartRateResting?: number | null;
            oxygenSaturation?: number | null;
            respiratoryRate?: number | null;
            temperature?: number | null;
            bloodPressureSystolic?: number | null;
            bloodPressureDiastolic?: number | null;
            hrvRmssd?: number | null;
          }
        | undefined;
      try {
        const [readings, alerts, baseline, userInfo] = await Promise.all([
          prisma.biometricReading.findMany({
            where: { userId: patientId },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              heartRate: true,
              bloodPressureSystolic: true,
              bloodPressureDiastolic: true,
              oxygenSaturation: true,
              respiratoryRate: true,
              temperature: true,
              hrvRmssd: true,
              createdAt: true,
            },
          }),
          prisma.healthAlert.findMany({
            where: { userId: patientId, resolved: false },
            orderBy: { createdAt: "desc" },
            take: 3,
            select: { alertLevel: true, title: true, message: true },
          }),
          (prisma as any).userBaseline.findUnique({
            where: { userId: patientId },
            select: {
              hrMean: true,
              hrStd: true,
              spo2Mean: true,
              spo2Std: true,
              stage: true,
              confidencePct: true,
            },
          }),
          prisma.user.findUnique({
            where: { id: patientId },
            select: { dateOfBirth: true, gender: true, riskProfile: true },
          }),
        ]);

        const lines: string[] = [];

        if (userInfo?.dateOfBirth) {
          const age = Math.floor(
            (Date.now() - new Date(userInfo.dateOfBirth).getTime()) /
              (365.25 * 24 * 60 * 60 * 1000),
          );
          lines.push(
            `Patient: ${age} years old, ${userInfo.gender ?? "gender unknown"}`,
          );
        }

        if (readings.length > 0) {
          const latest = readings[0];
          latestVitalsSnapshot = {
            heartRateResting: latest.heartRate ?? null,
            oxygenSaturation: latest.oxygenSaturation ?? null,
            respiratoryRate: latest.respiratoryRate ?? null,
            temperature: latest.temperature ?? null,
            bloodPressureSystolic: latest.bloodPressureSystolic ?? null,
            bloodPressureDiastolic: latest.bloodPressureDiastolic ?? null,
            hrvRmssd: latest.hrvRmssd ?? null,
          };
          const parts: string[] = [];
          if (latest.heartRate != null)
            parts.push(`HR ${latest.heartRate} bpm`);
          if (latest.oxygenSaturation != null)
            parts.push(`SpO2 ${latest.oxygenSaturation}%`);
          if (
            latest.bloodPressureSystolic != null &&
            latest.bloodPressureDiastolic != null
          )
            parts.push(
              `BP ${latest.bloodPressureSystolic}/${latest.bloodPressureDiastolic} mmHg`,
            );
          if (latest.respiratoryRate != null)
            parts.push(`RR ${latest.respiratoryRate} breaths/min`);
          if (latest.temperature != null)
            parts.push(`Temp ${latest.temperature}°C`);
          if (latest.hrvRmssd != null) parts.push(`HRV ${latest.hrvRmssd} ms`);
          if (parts.length > 0)
            lines.push(
              `Latest vitals (${new Date(latest.createdAt).toLocaleDateString("en-ZA")}): ${parts.join(", ")}`,
            );
        }

        if (baseline) {
          const bParts: string[] = [];
          if (baseline.hrMean != null)
            bParts.push(`normal HR ${baseline.hrMean}±${baseline.hrStd} bpm`);
          if (baseline.spo2Mean != null)
            bParts.push(
              `normal SpO2 ${baseline.spo2Mean}±${baseline.spo2Std}%`,
            );
          if (bParts.length > 0)
            lines.push(
              `Personal baseline (${baseline.stage}, ${baseline.confidencePct}% confidence): ${bParts.join(", ")}`,
            );
        }

        if ((userInfo as any)?.riskProfile) {
          const rp = (userInfo as any).riskProfile;
          if (typeof rp === "object" && rp !== null) {
            const rpStr = Object.entries(rp)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ");
            if (rpStr) lines.push(`Risk profile: ${rpStr}`);
          }
        }

        if (alerts && alerts.length > 0) {
          const alertStr = alerts
            .map((a) => `[${a.alertLevel}] ${a.title}: ${a.message}`)
            .join(" | ");
          lines.push(`Active health alerts: ${alertStr}`);
        }

        if (lines.length > 0) patientContext = lines.join("\n");
      } catch (ctxErr) {
        console.warn(
          "[triage] Could not build patient context, proceeding without:",
          ctxErr,
        );
      }
      // ─────────────────────────────────────────────────────────────────────

      const result = await analyzeSymptoms({
        symptoms,
        imageBase64,
        patientContext,
        patientId,
        caseId,
        vitalsSnapshot: latestVitalsSnapshot,
      });

      const now = new Date();
      const slaDeadline = calculateSlaDeadline(result.triageLevel, now);
      const feeCents = getDoctorFee(result.triageLevel);

      const triageCase = await prisma.triageCase.create({
        data: {
          patientId,
          symptoms,
          imageStorageRef: undefined,
          aiTriageLevel: result.triageLevel,
          aiRecommendedAction: result.recommendedAction,
          aiPossibleConditions: result.possibleConditions,
          aiReasoning: result.reasoning,
          slaDeadline,
          doctorFeeCents: feeCents,
          aiModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
          aiContextUsed: !!patientContext,
          statPearlsUsed: result.evidenceSources.includes("StatPearls/NCBI"),
        } as any,
      });

      await writeClinicalAudit({
        userId: patientId,
        userRole: req.user?.role,
        action: "AI_TRIAGE_DECISION",
        resource: "triage_case",
        resourceId: triageCase.id,
        metadata: {
          caseId,
          triageLevel: result.triageLevel,
          confidence: result.confidence,
          requiresDoctorReview: result.requiresDoctorReview,
          uncertaintyFlags: result.uncertaintyFlags,
          evidenceSources: result.evidenceSources,
          aiContextUsed: !!patientContext,
          statPearlsUsed: result.evidenceSources.includes("StatPearls/NCBI"),
          symptomsHash: hashValue(symptoms),
        },
      });

      // Notify all available doctors via WebSocket that a new case needs review
      try {
        const availableDoctors = await prisma.user.findMany({
          where: { role: "DOCTOR", isAvailable: true, isActive: true },
          select: { id: true },
        });
        if (availableDoctors.length > 0) {
          broadcastToUsers(
            availableDoctors.map((d) => d.id),
            {
              type: "NEW_TRIAGE_CASE",
              data: {
                triageCaseId: triageCase.id,
                triageLevel: result.triageLevel,
                slaDeadline: slaDeadline.toISOString(),
                symptoms: symptoms.slice(0, 100),
                createdAt: new Date().toISOString(),
              },
            },
          );
        }
      } catch (wsErr) {
        console.warn(
          "[triage] WebSocket notify doctors failed (non-fatal):",
          (wsErr as Error).message,
        );
      }

      // Return acknowledgement only — NOT the AI result
      // Patient receives the result via WebSocket when doctor releases it
      res.json({
        success: true,
        data: result,
        triageCaseId: triageCase.id,
        slaDeadline: slaDeadline.toISOString(),
        meta: {
          disclaimer:
            "Not a medical diagnosis. Tool for decision support only. Sent to doctor for review.",
          satsLevel: result.triageLevel,
          slaMinutes: { 1: 5, 2: 15, 3: 60, 4: 240, 5: 480 }[
            result.triageLevel
          ],
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
