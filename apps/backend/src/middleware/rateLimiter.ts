import crypto from "crypto";
import rateLimit, { MemoryStore, Store, IncrementResponse, Options } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { getRedis } from "../services/redis";

/**
 * AH-02b: express-rate-limit's default store is per-process in-memory, so
 * across N replicas the effective limit is N x max and every deploy resets
 * every counter. This wraps rate-limit-redis's RedisStore so counts are
 * shared across replicas via Redis, but never lets the app depend on Redis
 * being up just to answer a request: any Redis error - not connected
 * (REDIS_URL unset, same as running without it today), a timeout, a
 * dropped connection - falls back to a local MemoryStore for that one call,
 * the same degraded-but-working behaviour Redis outages already get
 * elsewhere in this app (middleware/auth.ts's cache, services/monitoring.ts).
 *
 * The one thing this trades away: a request that falls back mid-window
 * counts against a separate, per-process counter than the Redis-backed one,
 * so a client whose requests happen to straddle a brief Redis blip could
 * exceed the configured limit slightly during that window. Preferable to
 * every request failing while Redis recovers.
 */
export class ResilientRateLimitStore implements Store {
  private redisStore: RedisStore;
  private fallback = new MemoryStore();

  constructor(prefix: string) {
    this.redisStore = new RedisStore({
      prefix,
      sendCommand: (...args: string[]): Promise<never> => {
        try {
          return getRedis().call(...(args as [string, ...string[]])) as Promise<never>;
        } catch (err) {
          return Promise.reject(err);
        }
      },
    });
  }

  init(options: Options): void {
    this.fallback.init(options);
    // RedisStore.init() loads its Lua scripts via sendCommand, which
    // rejects immediately when Redis isn't initialized yet (or at all) —
    // that's expected, not fatal: every call below falls back to
    // `fallback` regardless, so a failed init here just means the first
    // real request pays the same rejected-promise cost again. What
    // matters is not leaving this rejection unhandled, which would
    // otherwise crash the process on Node's unhandled-rejection default.
    this.redisStore.init(options).catch(() => {});
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      return await this.redisStore.increment(key);
    } catch {
      return this.fallback.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.redisStore.decrement(key);
    } catch {
      await this.fallback.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.redisStore.resetKey(key);
    } catch {
      await this.fallback.resetKey(key);
    }
  }
}

function envInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Client IP for rate-limit keying.
 *
 * This previously read the leftmost value of X-Forwarded-For, which is set by
 * the caller and can be any string. That made every limiter here - general,
 * auth and webhook - opt-out: a different header value per request meant a
 * fresh bucket per request. It also let a caller mint unbounded distinct keys
 * in the limiter's in-memory store.
 *
 * Express computes `req.ip` from the X-Forwarded-For chain according to the
 * `trust proxy` setting (see index.ts), which counts hops from the far end
 * and so cannot be spoofed by prepending entries. That is the value to key on.
 *
 * IPv6 addresses are truncated to a /64 because a single subscriber is
 * routinely handed an entire /64 and could otherwise rotate through it.
 */
const getClientIp = (req: any): string => {
  const ip: string = req?.ip || req?.socket?.remoteAddress || "unknown";
  const normalized = ip.startsWith("::ffff:") ? ip.slice(7) : ip;

  if (normalized.includes(":")) {
    const groups = normalized.split(":");
    return `${groups.slice(0, 4).join(":")}::/64`;
  }
  return normalized;
};

const authKeyStrategy = (
  process.env.AUTH_RATE_LIMIT_KEY_STRATEGY || "ip"
).toLowerCase();

const getHashedEmailFromBody = (req: any): string | null => {
  const email = req?.body?.email;
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash("sha256").update(normalized).digest("hex");
};

const getAuthRateLimitKey = (req: any): string => {
  const ip = String(getClientIp(req));
  const emailHash = getHashedEmailFromBody(req);
  if (authKeyStrategy === "email" && emailHash) return `email:${emailHash}`;
  if (authKeyStrategy === "ip_or_email" && emailHash)
    return `ip:${ip}|email:${emailHash}`;
  return `ip:${ip}`;
};

const generalWindowMs = envInt("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000);
const generalMax = envInt(
  "RATE_LIMIT_MAX",
  process.env.LOAD_TEST === "1"
    ? 50000
    : process.env.NODE_ENV === "production"
      ? 100
      : 10000,
);
export const rateLimiter = rateLimit({
  windowMs: generalWindowMs,
  max: generalMax,
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === "development" && !getClientIp(req),
  keyGenerator: getClientIp,
  store: new ResilientRateLimitStore("rl:general:"),
});

const authWindowMs = envInt("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000);
const authMax = envInt(
  "AUTH_RATE_LIMIT_MAX",
  process.env.NODE_ENV === "production" ? 30 : 5000,
);

export const authRateLimiter = rateLimit({
  windowMs: authWindowMs,
  max: authMax,
  message: {
    error: "Too many authentication attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === "development" && !getClientIp(req),
  keyGenerator: getAuthRateLimitKey,
  store: new ResilientRateLimitStore("rl:auth:"),
});

const webhookWindowMs = envInt("WEBHOOK_RATE_LIMIT_WINDOW_MS", 1 * 60 * 1000);
const webhookMax = envInt("WEBHOOK_RATE_LIMIT_MAX", 50);

export const webhookRateLimiter = rateLimit({
  windowMs: webhookWindowMs,
  max: webhookMax,
  message: {
    error: "Too many webhook requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === "development" && !getClientIp(req),
  keyGenerator: getClientIp,
  store: new ResilientRateLimitStore("rl:webhook:"),
});
