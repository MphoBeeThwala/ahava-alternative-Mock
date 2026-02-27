import rateLimit from 'express-rate-limit';

// General API rate limiter. In development allow 10k/15min so load-test (1000 users × 4 req) works without LOAD_TEST=1.
const generalMax = process.env.LOAD_TEST === '1' ? 50000 : (process.env.NODE_ENV === 'production' ? 100 : 10000);
export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: generalMax,
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict rate limiter for auth endpoints (relaxed in dev so load-test can run 1000 logins)
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 5 : 5000, // 5 in prod, 5k in dev for load-test
  message: {
    error: 'Too many authentication attempts, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Webhook rate limiter (more lenient)
export const webhookRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 50, // Limit each IP to 50 requests per windowMs
  message: {
    error: 'Too many webhook requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
