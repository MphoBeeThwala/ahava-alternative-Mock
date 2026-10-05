import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import prisma from '../lib/prisma';
import { getAccessTokenFromRequest } from '../services/authSession';
import { verifyToken } from '../services/tokens';
import { publishAuthCacheInvalidation, onAuthCacheInvalidate } from '../services/websocket';
import { MFA_ENROLMENT_REQUIRED, isEnrolmentPath, isMfaRequired } from '../services/mfaPolicy';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    isActive: boolean;
    totpEnabled?: boolean;
  };
}

const userCache = new Map<string, { user: NonNullable<AuthenticatedRequest['user']>; expiresAt: number }>();

// AH-08: hear about another replica's invalidateCachedUser call so this
// process's local cache doesn't keep serving a deactivated/role-changed
// user for up to AUTH_USER_CACHE_TTL_SECONDS after the fact.
onAuthCacheInvalidate((userId) => userCache.delete(userId));

async function getCachedUser(userId: string): Promise<NonNullable<AuthenticatedRequest['user']> | null> {
  try {
    const { getRedis } = await import('../services/redis');
    const redis = getRedis();
    const cached = await redis.get(`auth:user:v2:${userId}`);
    if (cached) return JSON.parse(cached);
  } catch { /* redis unavailable — treat as a cache miss */ }
  return null;
}
async function setCachedUser(userId: string, user: NonNullable<AuthenticatedRequest['user']>, ttlSeconds: number) {
  try {
    const { getRedis } = await import('../services/redis');
    const redis = getRedis();
    await redis.set(`auth:user:v2:${userId}`, JSON.stringify(user), 'EX', ttlSeconds);
  } catch { /* redis unavailable — request still succeeds, just uncached */ }
}

export async function invalidateCachedUser(userId: string) {
  userCache.delete(userId);
  try {
    const { getRedis } = await import("../services/redis");
    const redis = getRedis();
    await redis.del(`auth:user:v2:${userId}`);
  } catch { /* redis unavailable — local map entry above is still cleared */ }
  // AH-08: tell every other replica too — without this, only the replica
  // that handled this request (and Redis's own cache) heard about it.
  publishAuthCacheInvalidation(userId);
}

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Skip verification if already authenticated (e.g. app-level auth already ran for /api/patient)
    if (req.user) return next();

    // Mandatory 2FA for staff (services/mfaPolicy.ts): until enrolled, a
    // staff session reaches only the enrolment endpoints.
    const finish = () => {
      if (req.user && isMfaRequired(req.user.role) && !req.user.totpEnabled && !isEnrolmentPath(req.originalUrl)) {
        return res.status(403).json(MFA_ENROLMENT_REQUIRED);
      }
      return next();
    };

    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.split(' ')[1];
    const token = bearerToken ?? getAccessTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    let decoded: { userId: string; role: string };
    try {
      // Accepts ONLY access tokens. A refresh token or a WebSocket ticket
      // verifies against the same secret but is rejected here, so neither can
      // be used as an API credential.
      decoded = verifyToken(token, 'access');
    } catch (error) {
      const errName = (error as { name?: string })?.name;
      if (errName === 'TokenExpiredError') {
        // Expected in normal access-token refresh flow; avoid noisy error logs.
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      if (error instanceof Error && error.message.includes('JWT_SECRET')) {
        console.error('[AuthMiddleware] JWT_SECRET misconfigured');
        return res.status(503).json({ error: 'Server configuration error' });
      }
      console.warn('[AuthMiddleware] Token verification failed');
      return res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
    }

    const cacheTtlSeconds = Math.max(
      0,
      parseInt(process.env.AUTH_USER_CACHE_TTL_SECONDS ?? '300', 10) || 0
    );
    const now = Date.now();
    // Try Redis first, then in-memory
    if (cacheTtlSeconds > 0) {
      const redisUser = await getCachedUser(decoded.userId);
      if (redisUser) {
        if (!redisUser.isActive) return res.status(401).json({ error: 'Invalid or inactive user' });
        req.user = redisUser;
        return finish();
      }
      const cached = userCache.get(decoded.userId);
      if (cached && cached.expiresAt > now) {
        if (!cached.user.isActive) {
          return res.status(401).json({ error: 'Invalid or inactive user' });
        }
        req.user = cached.user;
        return finish();
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
        totpEnabled: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive user' });
    }

    req.user = user;
    if (cacheTtlSeconds > 0) {
      userCache.set(decoded.userId, { user, expiresAt: now + cacheTtlSeconds * 1000 });
      await setCachedUser(decoded.userId, user, cacheTtlSeconds);
    }
    return finish();
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

    return next();
  };
};

// Each role gate admits exactly one role. Admins administer (see
// services/careAccess.ts, separation of duties); they are not folded into the
// patient, nurse or doctor gates, so an admin account can't act as a patient
// (book, cancel, answer triage follow-ups) or as a clinician.
export const requireAdmin = requireRole([UserRole.ADMIN]);
export const requireDoctor = requireRole([UserRole.DOCTOR]);
export const requireNurse = requireRole([UserRole.NURSE]);
export const requirePatient = requireRole([UserRole.PATIENT]);
