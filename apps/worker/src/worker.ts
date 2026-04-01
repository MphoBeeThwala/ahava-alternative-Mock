import 'dotenv/config';
import Redis from 'ioredis';
import { QueueEvents, Worker } from 'bullmq';
import { sendEmail } from './email';

const QUEUE_NAMES = {
  EMAIL: 'email',
} as const;

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is required');
  }

  const connection = new Redis(redisUrl, {
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
    connectTimeout: 3000,
    lazyConnect: true,
  });

  await connection.connect();

  const emailEvents = new QueueEvents(QUEUE_NAMES.EMAIL, { connection });
  emailEvents.on('completed', ({ jobId }) => {
    console.log(`📧 Email job ${jobId} completed`);
  });
  emailEvents.on('failed', ({ jobId, failedReason }) => {
    console.error(`❌ Email job ${jobId} failed:`, failedReason);
  });

  const concurrency = Math.max(1, parseInt(process.env.EMAIL_WORKER_CONCURRENCY ?? '10', 10) || 10);
  const emailWorker = new Worker(
    QUEUE_NAMES.EMAIL,
    async (job) => {
      const { to, subject, html, text } = job.data as { to: string; subject: string; html: string; text?: string };
      const result = await sendEmail({ to, subject, html, text });
      if (result.error) throw result.error;
    },
    { connection, concurrency }
  );

  emailWorker.on('failed', (job, err) => {
    console.error(`❌ Email job ${job?.id} failed:`, err?.message);
  });

  const shutdown = async () => {
    await emailWorker.close().catch(() => {});
    await emailEvents.close().catch(() => {});
    await connection.quit().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('✅ Worker started');
}

void main();
