import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { getRedis } from '../services/redis';

type IdempotencyOptions = {
  scope: string;
  ttlSeconds?: number;
  lockSeconds?: number;
};

type CachedResponse = {
  statusCode: number;
  body: unknown;
};

const DEFAULT_IDEMPOTENCY_TTL_SECONDS = Math.max(
  60,
  parseInt(process.env.IDEMPOTENCY_TTL_SECONDS ?? '900', 10) || 900
);

const DEFAULT_IDEMPOTENCY_LOCK_SECONDS = Math.max(
  5,
  parseInt(process.env.IDEMPOTENCY_LOCK_SECONDS ?? '60', 10) || 60
);

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buildScopeKey(req: Request, scope: string, idempotencyKey: string): string {
  const userId = (req as any)?.user?.id ?? 'anonymous';
  const route = `${req.method}:${req.baseUrl}${req.path}`;
  return hashValue(`${scope}|${userId}|${route}|${idempotencyKey}`);
}

export function idempotencyMiddleware(options: IdempotencyOptions) {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_IDEMPOTENCY_TTL_SECONDS;
  const lockSeconds = options.lockSeconds ?? DEFAULT_IDEMPOTENCY_LOCK_SECONDS;

  return async (req: Request, res: Response, next: NextFunction) => {
    const rawKey = req.header(IDEMPOTENCY_KEY_HEADER);
    if (!rawKey) return next();

    const idempotencyKey = rawKey.trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Idempotency-Key header',
      });
    }

    let redis;
    try {
      redis = getRedis();
    } catch {
      // Fail open if Redis is unavailable so core healthcare flows are not blocked.
      return next();
    }

    const scopeHash = buildScopeKey(req, options.scope, idempotencyKey);
    const lockKey = `idem:lock:${scopeHash}`;
    const resultKey = `idem:result:${scopeHash}`;

    try {
      const existing = await redis.get(resultKey);
      if (existing) {
        const cached = JSON.parse(existing) as CachedResponse;
        res.setHeader('X-Idempotent-Replay', 'true');
        return res.status(cached.statusCode).json(cached.body);
      }

      const acquired = await redis.set(lockKey, '1', 'EX', lockSeconds, 'NX');
      if (!acquired) {
        return res.status(409).json({
          success: false,
          error: 'Duplicate request in progress',
          code: 'IDEMPOTENCY_IN_PROGRESS',
        });
      }

      let responseBody: unknown;
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        responseBody = body;
        return originalJson(body);
      }) as Response['json'];

      res.on('finish', async () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 500) {
            const cachedResponse: CachedResponse = {
              statusCode: res.statusCode,
              body: responseBody ?? {},
            };
            await redis.set(resultKey, JSON.stringify(cachedResponse), 'EX', ttlSeconds);
          }
          await redis.del(lockKey);
        } catch {
          // No-op: idempotency cache should never break request lifecycle.
        }
      });

      return next();
    } catch {
      return next();
    }
  };
}

