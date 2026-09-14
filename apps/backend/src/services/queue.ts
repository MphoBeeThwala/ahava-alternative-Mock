import type Redis from "ioredis";
import { Queue, QueueEvents, UnrecoverableError, Worker } from "bullmq";
import { sendEmail } from "./email";
import { processAiTriageJob, type AiTriageJobData } from "../jobs/aiTriageJob";

// Queue names
export const QUEUE_NAMES = {
  PDF_EXPORT: "pdf-export",
  PUSH_NOTIFICATION: "push-notification",
  EMAIL: "email",
  AI_TRIAGE: "ai-triage",
} as const;

// Lazy-initialized queues (only set after initializeQueue() when REDIS_URL is set)
let pdfExportQueue: Queue | null = null;
let pushNotificationQueue: Queue | null = null;
let emailQueue: Queue | null = null;
let emailWorker: Worker | null = null;
let aiTriageQueue: Queue | null = null;
let aiTriageWorker: Worker | null = null;
let pdfEvents: QueueEvents | null = null;
let pushEvents: QueueEvents | null = null;
let emailEvents: QueueEvents | null = null;
let aiTriageEvents: QueueEvents | null = null;
let queuesInitialized = false;

function getDefaultJobOptions() {
  return {
    removeOnComplete: 10,
    removeOnFail: 5,
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 2000 },
  };
}

export const initializeQueue = async (connection: any) => {
  // A background reconnect retry (index.ts) can call this again after a
  // startup failure resolves — guard so it can't create duplicate
  // Queue/Worker instances on the same queue names, which would process
  // every job twice.
  if (queuesInitialized) return;

  pdfExportQueue = new Queue(QUEUE_NAMES.PDF_EXPORT, {
    connection,
    defaultJobOptions: {
      ...getDefaultJobOptions(),
      removeOnComplete: 10,
      removeOnFail: 5,
    },
  });
  pushNotificationQueue = new Queue(QUEUE_NAMES.PUSH_NOTIFICATION, {
    connection,
    defaultJobOptions: {
      ...getDefaultJobOptions(),
      removeOnComplete: 100,
      removeOnFail: 10,
    },
  });
  emailQueue = new Queue(QUEUE_NAMES.EMAIL, {
    connection,
    defaultJobOptions: {
      ...getDefaultJobOptions(),
      removeOnComplete: 50,
      removeOnFail: 10,
    },
  });

  pdfEvents = new QueueEvents(QUEUE_NAMES.PDF_EXPORT, { connection });
  pushEvents = new QueueEvents(QUEUE_NAMES.PUSH_NOTIFICATION, {
    connection,
  });
  emailEvents = new QueueEvents(QUEUE_NAMES.EMAIL, { connection });

  pdfEvents.on("completed", ({ jobId }) => {
    console.log(`📄 PDF export job ${jobId} completed`);
  });
  pdfEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(`❌ PDF export job ${jobId} failed:`, failedReason);
  });
  pushEvents.on("completed", ({ jobId }) => {
    console.log(`📱 Push notification job ${jobId} completed`);
  });
  pushEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(`❌ Push notification job ${jobId} failed:`, failedReason);
  });
  emailEvents.on("completed", ({ jobId }) => {
    console.log(`📧 Email job ${jobId} completed`);
  });
  emailEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(`❌ Email job ${jobId} failed:`, failedReason);
  });

  if (process.env.DISABLE_INLINE_QUEUE_WORKERS !== "1") {
    const concurrency = Math.max(
      1,
      parseInt(process.env.EMAIL_WORKER_CONCURRENCY ?? "5", 10) || 5,
    );
    emailWorker = new Worker(
      QUEUE_NAMES.EMAIL,
      async (job) => {
        const { to, subject, html, text } = job.data as {
          to: string;
          subject: string;
          html: string;
          text?: string;
        };
        const result = await sendEmail({ to, subject, html, text });
        if (result.error) {
          if (result.error.message.startsWith("RESEND_DOMAIN_NOT_VERIFIED:")) {
            throw new UnrecoverableError(result.error.message);
          }
          throw result.error;
        }
      },
      { connection, concurrency },
    );
    emailWorker.on("failed", (job, err) => {
      console.error(`❌ Email job ${job?.id} failed:`, err?.message);
    });
  }

  // AH-32: AI triage off the request thread. analyzeSymptoms rarely throws
  // (it already falls back to a conservative, doctor-forced result if every
  // AI provider fails), so attempts stay low — retries here are mainly for
  // genuine infra failures (a DB hiccup on the update), not AI flakiness.
  aiTriageQueue = new Queue(QUEUE_NAMES.AI_TRIAGE, {
    connection,
    defaultJobOptions: {
      removeOnComplete: 50,
      removeOnFail: 20,
      attempts: 2,
      backoff: { type: "exponential" as const, delay: 5000 },
    },
  });
  aiTriageEvents = new QueueEvents(QUEUE_NAMES.AI_TRIAGE, { connection });
  aiTriageEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(`❌ AI triage job ${jobId} failed:`, failedReason);
  });

  if (process.env.DISABLE_INLINE_QUEUE_WORKERS !== "1") {
    const aiTriageConcurrency = Math.max(
      1,
      parseInt(process.env.AI_TRIAGE_WORKER_CONCURRENCY ?? "5", 10) || 5,
    );
    aiTriageWorker = new Worker(
      QUEUE_NAMES.AI_TRIAGE,
      async (job) => {
        await processAiTriageJob(job.data as AiTriageJobData);
      },
      { connection, concurrency: aiTriageConcurrency },
    );
    aiTriageWorker.on("failed", (job, err) => {
      console.error(`❌ AI triage job ${job?.id} failed:`, err?.message);
    });
  }

  queuesInitialized = true;
  console.log("✅ BullMQ queues initialized");
};

// Helper functions to add jobs (no-op if Redis/queues not initialized)
export const addPdfExportJob = async (data: {
  exportJobId: string;
  userId: string;
  filters: Record<string, unknown>;
  type: string;
}) => {
  if (!pdfExportQueue) return;
  return pdfExportQueue.add("generate-pdf", data, { priority: 1 });
};

export const addPushNotificationJob = async (data: {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}) => {
  if (!pushNotificationQueue) return;
  return pushNotificationQueue.add("send-push", data, { priority: 5 });
};

export const addEmailJob = async (data: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  priority?: number; // optional BullMQ job priority (lower = higher priority)
}) => {
  if (emailQueue) {
    return emailQueue.add("send-email", data, { priority: 3 });
  }
  // No Redis: send directly so notifications still work (e.g. serverless or dev without Redis)
  const { sendEmail } = await import("./email");
  sendEmail(data).catch((e) => console.error("[email] direct send failed", e));
  return undefined;
};

/**
 * AH-32: enqueues the AI triage job for a case routes/triage.ts already
 * created (with an interim, deterministic-floor-based assessment). Returns
 * whether it was actually queued — when it wasn't (no Redis configured),
 * the caller runs processAiTriageJob synchronously instead, so a case never
 * gets stuck showing only the interim placeholder forever. Same function
 * either way; see jobs/aiTriageJob.ts.
 */
export const addAiTriageJob = async (data: AiTriageJobData): Promise<boolean> => {
  if (!aiTriageQueue) return false;
  await aiTriageQueue.add("analyze", data, { priority: 1 });
  return true;
};

async function closeWithTimeout(
  closeable: { close: () => Promise<void> } | null,
  label: string,
  timeoutMs: number,
): Promise<void> {
  if (!closeable) return;
  try {
    await Promise.race([
      closeable.close(),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timed out")), timeoutMs)),
    ]);
  } catch (err) {
    console.warn(`[queue] ${label} did not close cleanly:`, (err as Error).message);
  }
}

/**
 * Graceful shutdown drain for BullMQ. Previously nothing here — the process
 * just exited on SIGTERM with these workers never told to stop, so a job
 * being actively processed (an AI triage analysis, an email send) was
 * abruptly killed rather than given a chance to finish; the only recovery
 * was BullMQ's stall-detection eventually noticing and retrying it, an
 * unverified safety net standing in for an actual drain. Workers close
 * first — Worker.close() waits for the current job to finish, up to
 * `workerTimeoutMs` — before the queues and their event listeners.
 */
export const closeQueues = async (workerTimeoutMs = 10_000): Promise<void> => {
  if (!queuesInitialized) return;

  await Promise.all([
    closeWithTimeout(aiTriageWorker, "AI triage worker", workerTimeoutMs),
    closeWithTimeout(emailWorker, "email worker", workerTimeoutMs),
  ]);

  await Promise.all([
    closeWithTimeout(aiTriageQueue, "AI triage queue", 3000),
    closeWithTimeout(emailQueue, "email queue", 3000),
    closeWithTimeout(pdfExportQueue, "PDF export queue", 3000),
    closeWithTimeout(pushNotificationQueue, "push notification queue", 3000),
    closeWithTimeout(aiTriageEvents, "AI triage queue events", 3000),
    closeWithTimeout(emailEvents, "email queue events", 3000),
    closeWithTimeout(pdfEvents, "PDF queue events", 3000),
    closeWithTimeout(pushEvents, "push queue events", 3000),
  ]);
};
