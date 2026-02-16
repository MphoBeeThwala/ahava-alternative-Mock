import Redis from 'ioredis';

let redis: Redis;

export const initializeRedis = async () => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  redis = new Redis(redisUrl, {
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  redis.on('connect', () => {
    console.log('🔗 Redis connected');
  });

  redis.on('error', (error) => {
    console.error('❌ Redis connection error:', error);
  });

  return redis;
};

export const getRedis = () => {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    console.log(`🔌 Lazy initializing Redis connecting to ${redisUrl}`);
    redis = new Redis(redisUrl, {
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });

    redis.on('connect', () => {
      console.log('🔗 Redis connected');
    });

    redis.on('error', (error) => {
      console.error('❌ Redis connection error:', error);
    });
  }
  return redis;
};

export const closeRedis = async () => {
  if (redis) {
    await redis.quit();
  }
};
