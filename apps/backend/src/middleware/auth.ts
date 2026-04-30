import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import prisma from '../lib/prisma';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    isActive: boolean;
  };
}

const userCache = new Map<string, { user: NonNullable<AuthenticatedRequest['user']>; expiresAt: number }>();

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Skip verification if already authenticated (e.g. app-level auth already ran for /api/patient)
    if (req.user) return next();

    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Invalid token format' });
    }

    let decoded: any;
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret || (process.env.NODE_ENV === 'production' && secret.length < 32)) {
        return res.status(503).json({ error: 'Server configuration error' });
      }
      const jwtSecret = process.env.NODE_ENV === 'production' ? secret : (secret || 'dev_secret_key_change_me_in_prod');
      decoded = jwt.verify(token, jwtSecret) as any;
    } catch (error) {
      const errName = (error as { name?: string })?.name;
      if (errName === 'TokenExpiredError') {
        // Expected in normal access-token refresh flow; avoid noisy error logs.
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      console.warn('[AuthMiddleware] Token verification failed');
      return res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
    }

    const cacheTtlSeconds = Math.max(
      0,
      parseInt(process.env.AUTH_USER_CACHE_TTL_SECONDS ?? '60', 10) || 0
    );
    const now = Date.now();
    if (cacheTtlSeconds > 0) {
      const cached = userCache.get(decoded.userId);
      if (cached && cached.expiresAt > now) {
        if (!cached.user.isActive) {
          return res.status(401).json({ error: 'Invalid or inactive user' });
        }
        req.user = cached.user;
        return next();
      }
      if (cached) userCache.delete(decoded.userId);
    }

    // Verify user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive user' });
    }

    req.user = user;
    if (cacheTtlSeconds > 0) {
      userCache.set(decoded.userId, { user, expiresAt: now + cacheTtlSeconds * 1000 });
    }
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

export const requireRole = (roles: UserRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

export const requireAdmin = requireRole([UserRole.ADMIN]);
export const requireDoctor = requireRole([UserRole.DOCTOR, UserRole.ADMIN]);
export const requireNurse = requireRole([UserRole.NURSE, UserRole.ADMIN]);
export const requirePatient = requireRole([UserRole.PATIENT, UserRole.ADMIN]);
