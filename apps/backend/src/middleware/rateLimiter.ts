import crypto from "crypto";
import rateLimit from "express-rate-limit";

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
/**
 * FOLLOW-UP before scale: these limiters use express-rate-limit's default
 * in-memory store, which is per-process. Across N replicas the effective
 * limit is N x max, and every deploy resets all counters. Once `rate-limit-redis`
 * is added to apps/backend/package.json, give each limiter:
 *
 *   store: new RedisStore({ sendCommand: (...args) => getRedis().call(...args) })
 *
 * Tracked as AH-02b in docs/ENGINEERING_PLAN.md.
 */
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
});
