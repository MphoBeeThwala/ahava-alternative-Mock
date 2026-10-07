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
import { analyzeSymptoms, type TriageResult } from "../services/aiTriage";
import type { AiInputFile } from "../services/aiProviders";
import { calculateSlaDeadline, getDoctorFee } from "../services/triageSla";
import { broadcastToUsers } from "../services/websocket";
import prisma from "../lib/prisma";
import { hashValue, writeClinicalAudit } from "../services/clinicalAudit";
import {
  materializeTriageAttachment,
  parseTriageAttachmentManifest,
  type StoredTriageAttachment,
} from "../services/triageAttachments";
import type { TriageVitalsSnapshot, DeterministicRiskPatient } from "../services/triageSafety";

const SYMPTOM_PREVIEW_LENGTH = 280;

export interface AiTriageJobData {
  caseId: string;
  patientId: string;
  symptoms: string;
  patientContext?: string;
  vitalsSnapshot?: TriageVitalsSnapshot;
  patient?: DeterministicRiskPatient;
  /** 0 for the first analysis; n for the nth automatic re-analysis after the AI was unavailable. */
  retryAttempt?: number;
  /**
   * Set when a case is re-queued by the sweeper, which does not have the
   * original vitals or patient context. The AI's answer may then add a
   * diagnosis and reasoning, but never make the case LESS urgent than the
   * level it was already held at.
   */
  holdUrgency?: boolean;
}

/**
 * When no AI provider could analyse a case it is saved with an honest
 * "AI analysis unavailable" result and a doctor is told. It is then
 * re-analysed automatically, after each of these delays, so the doctor gets
 * the AI summary as soon as a provider recovers instead of the case staying
 * un-analysed forever. Override with AI_REANALYSIS_DELAYS_MS (comma list).
 */
export function reanalysisDelaysMs(): number[] {
  const configured = (process.env.AI_REANALYSIS_DELAYS_MS ?? "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return configured.length > 0 ? configured : [2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 3600_000];
}

export function isUnavailableResult(result: Pick<TriageResult, "uncertaintyFlags">): boolean {
  return result.uncertaintyFlags.includes("AI_ANALYSIS_UNAVAILABLE");
}

const MAX_AI_FILES = 6;
const MAX_AI_FILE_BYTES = 5 * 1024 * 1024;

/** Lab results and other documents the patient attached, as the AI should see them. */
async function loadAiFiles(attachments: StoredTriageAttachment[]): Promise<AiInputFile[]> {
  const files: AiInputFile[] = [];
  for (const a of attachments.filter((x) => x.kind !== "symptom_image").slice(0, MAX_AI_FILES)) {
    try {
      const { mimeType, buffer } = await materializeTriageAttachment(a);
      if (buffer.length > MAX_AI_FILE_BYTES) continue;
      files.push({ fileName: a.fileName, mimeType, base64: buffer.toString("base64") });
    } catch (err) {
      // A file we can't read must not block the analysis; the doctor still sees the original.
      console.warn(`[aiTriageJob] could not load attachment ${a.id} for the AI:`, (err as Error).message);
    }
  }
  return files;
}

export async function processAiTriageJob(data: AiTriageJobData): Promise<void> {
  const { caseId, patientId, symptoms, patientContext, vitalsSnapshot, patient, retryAttempt = 0, holdUrgency = false } = data;

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

  // A later re-analysis must never overwrite a case a doctor has already
  // picked up: their work and the AI's earlier draft stay as they are.
  if (retryAttempt > 0 && triageCase.status !== "PENDING_REVIEW") {
    return;
  }

  // Resolve the photo through the same path as every other attachment: when
  // object storage is configured it has no embedded dataUrl, so reading
  // `.dataUrl` directly (as this used to) silently sent no image at all.
  let imageBase64: string | undefined;
  if (imageAttachment) {
    try {
      const { mimeType, buffer } = await materializeTriageAttachment(imageAttachment);
      imageBase64 = `data:${mimeType};base64,${buffer.toString("base64")}`;
    } catch (err) {
      console.warn("[aiTriageJob] could not load the symptom photo for the AI:", (err as Error).message);
    }
  }
  const files = await loadAiFiles(manifest.attachments);

  const result = await analyzeSymptoms({
    symptoms,
    imageBase64,
    files,
    patientContext,
    patientId,
    caseId,
    vitalsSnapshot,
    patient,
  });
  const unavailable = isUnavailableResult(result);
  if (holdUrgency) result.triageLevel = Math.min(result.triageLevel, triageCase.aiTriageLevel) as TriageResult["triageLevel"];

  const now = new Date();
  // A re-analysis must not restart the patient's clock: the SLA runs from when
  // the case was submitted, not from when the AI finally answered.
  const slaDeadline = calculateSlaDeadline(result.triageLevel, retryAttempt > 0 ? triageCase.createdAt : now);
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
      // Found via a real user question, 2026-09-14: this used to stamp every
      // case with the CONFIGURED Anthropic model name unconditionally, even
      // when the no-AI-available fallback produced the result — a doctor
      // reviewing a fallback case saw "Model: claude-sonnet-4-20250514" when
      // no model had run at all. result.modelUsed is set at the actual point
      // a result is produced (see aiTriage.ts), so this now reflects what
      // really happened: Claude, Gemini, or the fallback heuristic.
      aiModel: result.modelUsed,
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
      attachmentsSentToAi: files.length,
      symptomsHash: hashValue(symptoms),
      modelUsed: result.modelUsed,
      aiAnalysisUnavailable: unavailable,
      retryAttempt,
      // Provider, model, failure kind, HTTP status and a short error string; no patient data.
      providerFailures: result.providerFailures ?? [],
    },
  });

  // No provider could analyse this case: try again later, automatically.
  if (unavailable) {
    await scheduleReanalysis(data, retryAttempt);
  }

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
            aiAnalysisUnavailable: unavailable,
            reanalysed: retryAttempt > 0,
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

async function scheduleReanalysis(data: AiTriageJobData, attempt: number): Promise<void> {
  const delays = reanalysisDelaysMs();
  if (attempt >= delays.length) {
    console.error(`[aiTriageJob] case ${data.caseId}: AI still unavailable after ${attempt} re-analyses; leaving it for the doctor`);
    return;
  }
  const next: AiTriageJobData = { ...data, retryAttempt: attempt + 1 };
  const delayMs = delays[attempt];
  try {
    // Dynamic import: services/queue.ts imports this module.
    const { addAiTriageJob } = await import("../services/queue");
    if (await addAiTriageJob(next, { delayMs })) return;
  } catch (err) {
    console.warn("[aiTriageJob] could not queue re-analysis:", (err as Error).message);
  }
  // No queue (no Redis): fall back to an in-process timer. It is lost if the
  // process restarts, which is why production should run Redis.
  setTimeout(() => {
    processAiTriageJob(next).catch((err) =>
      console.error(`[aiTriageJob] re-analysis of case ${data.caseId} failed:`, (err as Error).message),
    );
  }, delayMs).unref();
}
