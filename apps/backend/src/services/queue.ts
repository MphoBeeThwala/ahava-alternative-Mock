import { Queue, QueueEvents, Worker } from 'bullmq';
import { getRedis } from './redis';
import { sendEmail } from './email';

// Queue names
export const QUEUE_NAMES = {
  PDF_EXPORT: 'pdf-export',
  PUSH_NOTIFICATION: 'push-notification',
  EMAIL: 'email',
} as const;

// Lazy-initialized queues (only set after initializeQueue() when REDIS_URL is set)
let pdfExportQueue: Queue | null = null;
let pushNotificationQueue: Queue | null = null;
let emailQueue: Queue | null = null;
let emailWorker: Worker | null = null;

function getDefaultJobOptions() {
  return {
    removeOnComplete: 10,
    removeOnFail: 5,
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 2000 },
  };
}

export const initializeQueue = async () => {
  const connection = getRedis();
  pdfExportQueue = new Queue(QUEUE_NAMES.PDF_EXPORT, {
    connection,
    defaultJobOptions: { ...getDefaultJobOptions(), removeOnComplete: 10, removeOnFail: 5 },
  });
  pushNotificationQueue = new Queue(QUEUE_NAMES.PUSH_NOTIFICATION, {
    connection,
    defaultJobOptions: { ...getDefaultJobOptions(), removeOnComplete: 100, removeOnFail: 10 },
  });
  emailQueue = new Queue(QUEUE_NAMES.EMAIL, {
    connection,
    defaultJobOptions: { ...getDefaultJobOptions(), removeOnComplete: 50, removeOnFail: 10 },
  });

  const pdfEvents = new QueueEvents(QUEUE_NAMES.PDF_EXPORT, { connection });
  const pushEvents = new QueueEvents(QUEUE_NAMES.PUSH_NOTIFICATION, { connection });
  const emailEvents = new QueueEvents(QUEUE_NAMES.EMAIL, { connection });

  pdfEvents.on('completed', ({ jobId }) => {
    console.log(`📄 PDF export job ${jobId} completed`);
  });
  pdfEvents.on('failed', ({ jobId, failedReason }) => {
    console.error(`❌ PDF export job ${jobId} failed:`, failedReason);
  });
  pushEvents.on('completed', ({ jobId }) => {
    console.log(`📱 Push notification job ${jobId} completed`);
  });
  pushEvents.on('failed', ({ jobId, failedReason }) => {
    console.error(`❌ Push notification job ${jobId} failed:`, failedReason);
  });
  emailEvents.on('completed', ({ jobId }) => {
    console.log(`📧 Email job ${jobId} completed`);
  });
  emailEvents.on('failed', ({ jobId, failedReason }) => {
    console.error(`❌ Email job ${jobId} failed:`, failedReason);
  });

  emailWorker = new Worker(
    QUEUE_NAMES.EMAIL,
    async (job) => {
      const { to, subject, html, text } = job.data as { to: string; subject: string; html: string; text?: string };
      const result = await sendEmail({ to, subject, html, text });
      if (result.error) throw result.error;
    },
    { connection, concurrency: 5 }
  );
  emailWorker.on('failed', (job, err) => {
    console.error(`❌ Email job ${job?.id} failed:`, err?.message);
  });

  console.log('✅ BullMQ queues initialized');
};

// Helper functions to add jobs (no-op if Redis/queues not initialized)
export const addPdfExportJob = async (data: {
  exportJobId: string;
  userId: string;
  filters: Record<string, unknown>;
  type: string;
}) => {
  if (!pdfExportQueue) return;
  return pdfExportQueue.add('generate-pdf', data, { priority: 1 });
};

export const addPushNotificationJob = async (data: {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}) => {
  if (!pushNotificationQueue) return;
  return pushNotificationQueue.add('send-push', data, { priority: 5 });
};

export const addEmailJob = async (data: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) => {
  if (emailQueue) {
    return emailQueue.add('send-email', data, { priority: 3 });
  }
  // No Redis: send directly so notifications still work (e.g. serverless or dev without Redis)
  const { sendEmail } = await import('./email');
  sendEmail(data).catch((e) => console.error('[email] direct send failed', e));
};
