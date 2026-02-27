import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    isActive: boolean;
  };
}

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Skip verification if already authenticated (e.g. app-level auth already ran for /api/patient)
    if (req.user) return next();

    const authHeader = req.headers.authorization;
    console.log(`[AuthMiddleware] URL: ${req.originalUrl}, Method: ${req.method}`);
    console.log(`[AuthMiddleware] Header: ${authHeader}`);

    if (!authHeader) {
      console.log('[AuthMiddleware] Missing Authorization header');
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      console.log('[AuthMiddleware] Malformed Authorization header (no token)');
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
      console.log(`[AuthMiddleware] Token verified for user: ${decoded.userId}`);
    } catch (error) {
      console.error('[AuthMiddleware] Token verification failed:', error);
      return res.status(401).json({ error: 'Invalid token' });
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
