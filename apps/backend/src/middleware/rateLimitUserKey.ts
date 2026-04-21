import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const attachRateLimitUserKey = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return next();
    const token = authHeader.split(' ')[1];
    if (!token) return next();

    const secret = process.env.JWT_SECRET;
    if (!secret || (process.env.NODE_ENV === 'production' && secret.length < 32)) return next();
    const jwtSecret = process.env.NODE_ENV === 'production' ? secret : (secret || 'dev_secret_key_change_me_in_prod');
    const decoded = jwt.verify(token, jwtSecret) as any;
    if (decoded?.userId) {
      (req as any)._rateLimitUserId = decoded.userId;
    }
    return next();
  } catch {
    return next();
  }
};
