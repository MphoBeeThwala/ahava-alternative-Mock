import crypto from "crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

function envInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// IPv6-safe key generator with explicit X-Forwarded-For support for proxy deployments.
const getClientIp = (req: any) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return typeof forwarded === "string"
      ? forwarded.split(",")[0].trim()
      : forwarded[0];
  }
  return ipKeyGenerator(req);
};

const getRateLimitKey = (req: any) => {
  const userId = req?._rateLimitUserId;
  if (userId) return `u:${userId}`;
  return `ip:${getClientIp(req)}`;
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
