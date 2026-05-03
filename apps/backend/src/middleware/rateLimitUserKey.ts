/**
 * Attach Rate Limit User Key Middleware
 *
 * Non-blocking middleware that decodes the JWT (if present) and attaches
 * the user ID to `req._rateLimitUserId` so that the rate limiter can key
 * requests by authenticated user rather than IP address.
 *
 * This middleware never blocks the request — invalid or missing tokens are
 * silently ignored and rate limiting falls back to IP-based keying.
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const attachRateLimitUserKey = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return next();

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;
    if (!token) return next();

    const secret =
      process.env.JWT_SECRET ||
      (process.env.NODE_ENV !== 'production' ? 'dev_secret_key_change_me_in_prod' : '');
    if (!secret) return next();

    const decoded = jwt.decode(token) as { userId?: string } | null;
    if (decoded?.userId) {
      (req as any)._rateLimitUserId = decoded.userId;
    }
  } catch {
    // Silently ignore any errors — rate limiting falls back to IP
  }
  next();
};
