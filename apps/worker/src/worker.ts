import 'dotenv/config';
import Redis from 'ioredis';
import { QueueEvents, Worker } from 'bullmq';
import { sendEmail } from './email';

const QUEUE_NAMES = {
  EMAIL: 'email',
} as const;

const normalizeRedisUrl = (raw?: string): string | null => {
  if (!raw) return null;
  const decoded = raw.includes('%20') ? raw.replace(/%20/g, ' ') : raw;
  const trimmed = decoded.trim();
  const match = trimmed.match(/(rediss?:\/\/\S+)/);
  if (!match) return null;
  const url = match[1];
  try {
    const u = new URL(url);
    if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') return null;
    return url;
  } catch {
    return null;
  }
};

async function main() {
  const redisUrl = normalizeRedisUrl(process.env.REDIS_URL);
  if (!redisUrl) {
    console.error('REDIS_URL is required and must be a valid redis:// or rediss:// URL');
    process.exit(1);
  }

  const connection = new Redis(redisUrl, {
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
    connectTimeout: 3000,
    lazyConnect: true,
  });

  connection.on('error', (err) => {
    console.error('❌ Redis connection error:', (err as Error)?.message ?? err);
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
