/**
 * AH-32: the actual AI-triage work, factored out so it can run either as a
 * BullMQ job (services/queue.ts, the normal path when Redis is configured)
 * or synchronously as a fallback (routes/triage.ts, when it isn't) — same
 * function either way, so there's exactly one place this logic can drift.
 *
 * routes/triage.ts's POST / creates the TriageCase immediately using
 * assessDeterministicRisk's floor as an interim aiTriageLevel (fast, pure,
 * and — because the guardrail can only ever narrow the final level to be
 * *at least* this urgent — never optimistic relative to where the real
 * analysis will land). This function replaces that interim state with the
 * real one once analyzeSymptoms completes.
 */
import { analyzeSymptoms } from "../services/aiTriage";
import { calculateSlaDeadline, getDoctorFee } from "../services/triageSla";
import { broadcastToUsers } from "../services/websocket";
import prisma from "../lib/prisma";
import { hashValue, writeClinicalAudit } from "../services/clinicalAudit";
import { parseTriageAttachmentManifest } from "../services/triageAttachments";
import type { TriageVitalsSnapshot } from "../services/triageSafety";

const SYMPTOM_PREVIEW_LENGTH = 280;

export interface AiTriageJobData {
  caseId: string;
  patientId: string;
  symptoms: string;
  patientContext?: string;
  vitalsSnapshot?: TriageVitalsSnapshot;
}

export async function processAiTriageJob(data: AiTriageJobData): Promise<void> {
  const { caseId, patientId, symptoms, patientContext, vitalsSnapshot } = data;

  const triageCase = await prisma.triageCase.findUnique({ where: { id: caseId } });
  if (!triageCase) {
    // Case was deleted (or never existed) between enqueue and processing —
    // nothing to analyze or update.
    console.warn(`[aiTriageJob] TriageCase ${caseId} not found; skipping`);
    return;
  }

  // The sanitized image is already persisted on the case itself
  // (imageStorageRef) from the synchronous submission step — re-read it
  // here rather than carrying base64 image data through the job payload
  // (the queue equivalent of AH-33's base64-in-JSON concern).
  const manifest = parseTriageAttachmentManifest(triageCase.imageStorageRef);
  const imageAttachment = manifest.attachments.find((a) => a.kind === "symptom_image");

  const result = await analyzeSymptoms({
    symptoms,
    imageBase64: imageAttachment?.dataUrl,
    patientContext,
    patientId,
    caseId,
    vitalsSnapshot,
  });

  const now = new Date();
  const slaDeadline = calculateSlaDeadline(result.triageLevel, now);
  const feeCents = getDoctorFee(result.triageLevel);

  await prisma.triageCase.update({
    where: { id: caseId },
    data: {
      aiTriageLevel: result.triageLevel,
      aiRecommendedAction: result.recommendedAction,
      aiPossibleConditions: result.possibleConditions,
      aiReasoning: result.reasoning,
      slaDeadline,
      doctorFeeCents: feeCents,
      aiModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      aiContextUsed: !!patientContext,
      statPearlsUsed: result.evidenceSources.includes("StatPearls/NCBI"),
    },
  });

  await writeClinicalAudit({
    userId: patientId,
    userRole: "PATIENT",
    action: "AI_TRIAGE_DECISION",
    resource: "triage_case",
    resourceId: caseId,
    metadata: {
      triageLevel: result.triageLevel,
      confidence: result.confidence,
      requiresDoctorReview: result.requiresDoctorReview,
      uncertaintyFlags: result.uncertaintyFlags,
      evidenceSources: result.evidenceSources,
      aiContextUsed: !!patientContext,
      statPearlsUsed: result.evidenceSources.includes("StatPearls/NCBI"),
      attachmentCount: manifest.attachments.length,
      symptomsHash: hashValue(symptoms),
    },
  });

  // Notify available doctors now that the real severity is known — same
  // single notification the synchronous flow sent, just from here instead.
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
            triageCaseId: caseId,
            triageLevel: result.triageLevel,
            slaDeadline: slaDeadline.toISOString(),
            symptoms: symptoms.slice(0, SYMPTOM_PREVIEW_LENGTH),
            attachmentCount: manifest.attachments.length,
            createdAt: triageCase.createdAt.toISOString(),
          },
        },
      );
    }
  } catch (wsErr) {
    console.warn(
      "[aiTriageJob] WebSocket notify doctors failed (non-fatal):",
      (wsErr as Error).message,
    );
  }
}
