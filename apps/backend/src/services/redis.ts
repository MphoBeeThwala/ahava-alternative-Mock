import Redis from 'ioredis';

let redis: Redis | null = null;
let redisInitFailed = false;

export const initializeRedis = async (): Promise<Redis> => {
  if (redis) return redis;
  if (redisInitFailed) throw new Error('Redis previously failed to connect');

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const client = new Redis(redisUrl, {
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
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
    redisInitFailed = true;
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
