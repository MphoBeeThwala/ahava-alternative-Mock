import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';

export const requireRole = (...roles: string[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: `Access restricted to: ${roles.join(', ')}` });
        }
        next();
    };
};
