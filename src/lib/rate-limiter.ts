import type { Context, Next } from "hono";

export enum RateLimits {
  STRICT = 10, // requests per minute
  NORMAL = 30,
  RELAXED = 60,
}

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetAt: number;
  };
}

// In-memory store for rate limiting (in production, use KV or Durable Objects)
const store: RateLimitStore = {};

function getClientId(c: Context): string {
  // Try to get user ID from auth context first
  const user = c.get("user");
  if (user?.id) {
    return `user:${user.id}`;
  }
  
  // Fallback to IP address
  const forwarded = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for");
  return `ip:${forwarded || "unknown"}`;
}

export function rateLimit(limit: RateLimits = RateLimits.NORMAL) {
  return async (c: Context, next: Next) => {
    const clientId = getClientId(c);
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window

    // Clean up expired entries
    Object.keys(store).forEach((key) => {
      if (store[key].resetAt < now) {
        delete store[key];
      }
    });

    // Get or create entry for this client
    const entry = store[clientId];
    if (!entry || entry.resetAt < now) {
      store[clientId] = {
        count: 1,
        resetAt: now + windowMs,
      };
      await next();
      return;
    }

    // Check if limit exceeded
    if (entry.count >= limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", retryAfter.toString());
      return c.json(
        {
          error: "Too many requests",
          message: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
        },
        429
      );
    }

    // Increment count and continue
    entry.count++;
    await next();
  };
}

