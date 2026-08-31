import { Router } from "express";
import { analyzeSymptoms } from "../services/aiTriage";
import {
  authMiddleware,
  AuthenticatedRequest,
  requirePatient,
} from "../middleware/auth";
import { rateLimiter } from "../middleware/rateLimiter";
import { requireConsent } from "../middleware/consentMiddleware";
import { aiTriageBudgetMiddleware } from "../middleware/aiTriageBudget";
import { calculateSlaDeadline, getDoctorFee } from "../jobs/triageEscalation";
import { broadcastToUsers, sendToUser } from "../services/websocket";
import prisma from "../lib/prisma";
import { randomUUID } from "crypto";
import { hashValue, writeClinicalAudit } from "../services/clinicalAudit";
import { sanitizeDataUrlImage } from "../utils/imageUtils";
import {
  assertLabAttachmentCount,
  buildTriageAttachmentUrl,
  parseTriageAttachmentManifest,
  persistTriageAttachment,
  serializeTriageAttachmentManifest,
  type StoredTriageAttachment,
} from "../services/triageAttachments";

const router: Router = Router();

const patientTriageCaseInclude = {
  doctor: {
    select: {
      firstName: true,
      lastName: true,
    },
  },
  prescription: {
    select: {
      id: true,
      diagnosis: true,
      medications: true,
      issuedAt: true,
    },
  },
  referral: {
    select: {
      id: true,
      referralType: true,
      provisionalDiagnosis: true,
      recommendedFacility: true,
      issuedAt: true,
    },
  },
} as const;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function serializePatientTriageCase(triageCase: any) {
  const manifest = parseTriageAttachmentManifest(triageCase.imageStorageRef);

  return {
    id: triageCase.id,
    status: triageCase.status,
    createdAt: triageCase.createdAt,
    slaDeadline: triageCase.slaDeadline,
    aiTriageLevel: triageCase.aiTriageLevel,
    aiRecommendedAction: triageCase.aiRecommendedAction,
    aiPossibleConditions: asStringArray(triageCase.aiPossibleConditions),
    doctorNotes: triageCase.doctorNotes,
    doctorDiagnosis: triageCase.doctorDiagnosis,
    doctorRecommendations: triageCase.doctorRecommendations,
    finalTriageLevel: triageCase.finalTriageLevel,
    releasedAt: triageCase.releasedAt,
    followUpRequestType: triageCase.followUpRequestType,
    followUpRequestMessage: triageCase.followUpRequestMessage,
    followUpQuestions: asStringArray(triageCase.followUpQuestions),
    requestedInvestigations: asStringArray(triageCase.requestedInvestigations),
    followUpRequestedAt: triageCase.followUpRequestedAt,
    patientFollowUpResponse: triageCase.patientFollowUpResponse,
    patientRespondedAt: triageCase.patientRespondedAt,
    doctorName: triageCase.doctor
      ? `Dr. ${triageCase.doctor.firstName} ${triageCase.doctor.lastName}`
      : null,
    attachments: manifest.attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
      createdAt: attachment.createdAt,
      url: buildTriageAttachmentUrl(triageCase.id, attachment.id),
    })),
    prescription: triageCase.prescription
      ? {
          id: triageCase.prescription.id,
          diagnosis: triageCase.prescription.diagnosis,
          medicationCount: Array.isArray(triageCase.prescription.medications)
            ? triageCase.prescription.medications.length
            : 0,
          issuedAt: triageCase.prescription.issuedAt,
          downloadUrl: `/api/triage-review/${triageCase.id}/prescription/pdf`,
          doctorName: triageCase.doctor
            ? `Dr. ${triageCase.doctor.firstName} ${triageCase.doctor.lastName}`
            : "Assigned doctor",
        }
      : null,
    referral: triageCase.referral
      ? {
          id: triageCase.referral.id,
          referralType: triageCase.referral.referralType,
          provisionalDiagnosis: triageCase.referral.provisionalDiagnosis,
          recommendedFacility: triageCase.referral.recommendedFacility,
          issuedAt: triageCase.referral.issuedAt,
          downloadUrl: `/api/triage-review/${triageCase.id}/referral/pdf`,
          doctorName: triageCase.doctor
            ? `Dr. ${triageCase.doctor.firstName} ${triageCase.doctor.lastName}`
            : "Assigned doctor",
        }
      : null,
  };
}

router.get(
  "/my-cases",
  requirePatient,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const cases = await prisma.triageCase.findMany({
        where: { patientId: req.user!.id },
        include: patientTriageCaseInclude,
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      res.json({
        success: true,
        cases: cases.map(serializePatientTriageCase),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/:id/follow-up-response",
  requirePatient,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const responseText =
        typeof req.body?.responseText === "string" ? req.body.responseText.trim() : "";
      const followUpFiles = Array.isArray(req.body?.followUpFiles)
        ? req.body.followUpFiles
        : [];

      if (!responseText && followUpFiles.length === 0) {
        return res.status(400).json({
          error: "A follow-up response message or investigation attachment is required",
        });
      }

      try {
        assertLabAttachmentCount(followUpFiles.length);
      } catch (attachmentErr) {
        return res.status(400).json({ error: (attachmentErr as Error).message });
      }

      const triageCase = await prisma.triageCase.findUnique({
        where: { id },
        include: patientTriageCaseInclude,
      });

      if (!triageCase || triageCase.patientId !== req.user!.id) {
        return res.status(404).json({ error: "Triage case not found" });
      }
      if (triageCase.status !== "AWAITING_PATIENT_RESPONSE") {
        return res.status(400).json({
          error: "This triage case is not currently awaiting a patient response",
        });
      }

      const manifest = parseTriageAttachmentManifest(triageCase.imageStorageRef);
      const newAttachments: StoredTriageAttachment[] = [];

      try {
        for (const file of followUpFiles) {
          if (
            !file ||
            typeof file.dataUrl !== "string" ||
            typeof file.fileName !== "string"
          ) {
            return res
              .status(400)
              .json({ error: "Invalid follow-up investigation attachment" });
          }

          newAttachments.push(
            await persistTriageAttachment({
              kind: "follow_up_file",
              dataUrl: file.dataUrl,
              fileName: file.fileName,
            }),
          );
        }
      } catch (attachmentErr) {
        return res.status(400).json({ error: (attachmentErr as Error).message });
      }

      const updated = await prisma.triageCase.update({
        where: { id },
        data: {
          status: "ASSIGNED",
          patientFollowUpResponse: responseText || null,
          patientRespondedAt: new Date(),
          imageStorageRef: serializeTriageAttachmentManifest({
            version: 1,
            attachments: [...manifest.attachments, ...newAttachments],
          }),
        },
        include: patientTriageCaseInclude,
      });

      await writeClinicalAudit({
        userId: req.user!.id,
        userRole: req.user?.role,
        action: "TRIAGE_FOLLOW_UP_RESPONSE",
        resource: "triage_case",
        resourceId: id,
        metadata: {
          responseLength: responseText.length,
          attachmentCount: newAttachments.length,
        },
      });

      if (triageCase.doctorId) {
        sendToUser(triageCase.doctorId, {
          type: "TRIAGE_FOLLOW_UP_RECEIVED",
          data: {
            triageCaseId: triageCase.id,
            patientId: triageCase.patientId,
            attachmentCount: newAttachments.length,
            respondedAt: updated.patientRespondedAt?.toISOString(),
          },
        });
      }

      res.json({
        success: true,
        triageCase: serializePatientTriageCase(updated),
      });
    } catch (error) {
      next(error);
    }
  },
);

// POST /api/triage – run AI triage and create a case for doctor review
router.post(
  "/",
  rateLimiter,
  authMiddleware,
  aiTriageBudgetMiddleware,
  requireConsent("AI_TRIAGE"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { symptoms } = req.body;
      let { imageBase64 } = req.body;
      const labResultFiles = Array.isArray(req.body?.labResultFiles)
        ? req.body.labResultFiles
        : [];
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

      try {
        assertLabAttachmentCount(labResultFiles.length);
      } catch (attachmentErr) {
        return res.status(400).json({ error: (attachmentErr as Error).message });
      }

      // ── Privacy: strip EXIF/GPS metadata from the photo before it reaches
      // any AI provider. If the image cannot be processed, drop it rather
      // than forwarding unstripped PHI.
      if (imageBase64) {
        try {
          imageBase64 = await sanitizeDataUrlImage(imageBase64);
          if (!imageBase64) {
            return res
              .status(400)
              .json({ error: "Attached symptom image could not be processed" });
          }
        } catch (imgErr) {
          console.warn("[triage] Image sanitization failed:", imgErr);
          return res
            .status(400)
            .json({ error: "Attached symptom image could not be processed" });
        }
      }

      const storedAttachments: StoredTriageAttachment[] = [];
      try {
        if (imageBase64) {
          storedAttachments.push(
            await persistTriageAttachment({
              kind: "symptom_image",
              dataUrl: imageBase64,
              fileName: "symptom-photo.jpg",
            }),
          );
        }

        for (const labFile of labResultFiles) {
          if (
            !labFile ||
            typeof labFile.dataUrl !== "string" ||
            typeof labFile.fileName !== "string"
          ) {
            return res.status(400).json({ error: "Invalid lab result attachment" });
          }

          storedAttachments.push(
            await persistTriageAttachment({
              kind: "lab_result",
              dataUrl: labFile.dataUrl,
              fileName: labFile.fileName,
            }),
          );
        }
      } catch (attachmentErr) {
        return res.status(400).json({ error: (attachmentErr as Error).message });
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
          imageStorageRef:
            storedAttachments.length > 0
              ? serializeTriageAttachmentManifest({
                  version: 1,
                  attachments: storedAttachments,
                })
              : undefined,
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
          attachmentCount: storedAttachments.length,
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
                attachmentCount: storedAttachments.length,
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
      // Return acknowledgement only — NOT the AI result
      // Patient receives the result via WebSocket when doctor releases it
      res.json({
        success: true,
        status: "PENDING_REVIEW",
        triageCaseId: triageCase.id,
        slaDeadline: slaDeadline.toISOString(),
        requiresDoctorReview: result.requiresDoctorReview,
        meta: {
          estimatedWaitMinutes: { 1: 5, 2: 15, 3: 60, 4: 240, 5: 480 }[
            result.triageLevel
          ],
          attachmentCount: storedAttachments.length,
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
