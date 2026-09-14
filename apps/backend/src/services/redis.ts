import Redis from 'ioredis';

let redis: Redis | null = null;

// A failed attempt used to permanently lock this out for the process's
// lifetime (redisInitFailed, now removed) — meaning a transient network
// blip during startup degraded a replica until someone redeployed it. The
// only caller (index.ts) now retries this on an interval after a failure,
// so each call here genuinely attempts a fresh connection instead of
// short-circuiting; that retry cadence is what keeps this from hammering a
// genuinely-down Redis.
export const initializeRedis = async (): Promise<Redis> => {
  if (redis) return redis;

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const client = new Redis(redisUrl, {
    enableReadyCheck: true,
    maxRetriesPerRequest: null, // Required by BullMQ Workers (allows retries on disconnect)
    connectTimeout: 3000,
    lazyConnect: true,
  });

  client.on('error', (err) => {
    console.error('❌ Redis connection error:', err.message);
  });

  try {
    await Promise.race([
      client.connect(),
      new Promise<void>((_, rej) =>
        setTimeout(() => rej(new Error('Redis connection timeout')), 4000)
      ),
    ]);
    client.on('connect', () => {
      console.log('🔗 Redis connected');
    });
    redis = client;
    return redis;
  } catch (err) {
    client.disconnect();
    throw err;
  }
};

export const getRedis = (): Redis => {
  if (!redis) {
    throw new Error('Redis not initialized. Set REDIS_URL and ensure initializeRedis() ran successfully.');
  }
  return redis;
};

export const closeRedis = async (): Promise<void> => {
  if (redis) {
    await redis.quit().catch(() => {});
    redis = null;
  }
};
