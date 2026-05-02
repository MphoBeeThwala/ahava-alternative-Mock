import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from './auth';
import { getRedis } from '../services/redis';

const DAILY_LIMIT = parseInt(process.env.AI_TRIAGE_DAILY_LIMIT ?? '40', 10);

function secondsUntilUtcMidnight(now = new Date()): number {
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return Math.max(60, Math.floor((tomorrow.getTime() - now.getTime()) / 1000));
}

function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function aiTriageBudgetMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  // Disabled explicitly when set <= 0.
  if (!Number.isFinite(DAILY_LIMIT) || DAILY_LIMIT <= 0) return next();

  const userId = req.user?.id;
  if (!userId) return next();

  let redis;
  try {
    redis = getRedis();
  } catch {
    // Fail open: clinical flow should continue even if Redis is unavailable.
    return next();
  }

  const key = `ai:triage:daily:${dayKey()}:${userId}`;
  const ttl = secondsUntilUtcMidnight();

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, ttl);
    }

    const remaining = Math.max(0, DAILY_LIMIT - count);
    res.setHeader('X-AI-Triage-Limit', String(DAILY_LIMIT));
    res.setHeader('X-AI-Triage-Remaining', String(remaining));
    res.setHeader('X-AI-Triage-Reset-Seconds', String(ttl));

    if (count > DAILY_LIMIT) {
      return res.status(429).json({
        success: false,
        error: 'Daily AI triage limit reached for this account.',
        code: 'AI_TRIAGE_DAILY_LIMIT_EXCEEDED',
        retryAfterSeconds: ttl,
      });
    }

    return next();
  } catch {
    // Fail open if Redis command fails.
    return next();
  }
}

