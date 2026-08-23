import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { createAuditLog } from '../services/auditLog';
import prisma from '../lib/prisma';

const router: Router = Router();

// Get user profile
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, dateOfBirth: true, gender: true, profileImage: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'READ', resource: 'Profile', resourceId: user.id, metadata: { fields: Object.keys(user) }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, user });
  } catch (error) { next(error); }
});

// Update profile
router.patch('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { firstName, lastName, phone, dateOfBirth, gender } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { firstName, lastName, phone, dateOfBirth, gender },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, dateOfBirth: true, gender: true },
    });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'Profile', resourceId: user.id, metadata: { updatedFields: Object.keys(req.body) }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, user });
  } catch (error) { next(error); }
});

export default router;
