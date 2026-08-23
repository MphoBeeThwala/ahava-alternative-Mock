import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware, requireAdmin } from '../middleware/auth';
import { createAuditLog } from '../services/auditLog';
import prisma from '../lib/prisma';

const router: Router = Router();

// Get all users (Admin only)
router.get('/users', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const users = await prisma.user.findMany({ select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, createdAt: true } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'LIST', resource: 'AdminAction', metadata: { entity: 'User', count: users.length }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, users });
  } catch (error) { next(error); }
});

// Get system stats (Admin only)
router.get('/stats', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const [userCount, bookingCount, visitCount, triageCaseCount] = await Promise.all([
      prisma.user.count(),
      prisma.booking.count(),
      prisma.visit.count(),
      prisma.triageCase.count(),
    ]);
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'READ', resource: 'AdminAction', metadata: { entity: 'SystemStats', userCount, bookingCount, visitCount, triageCaseCount }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, stats: { userCount, bookingCount, visitCount, triageCaseCount } });
  } catch (error) { next(error); }
});

// Suspend user (Admin only)
router.patch('/users/:id/suspend', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const updated = await prisma.user.update({ where: { id }, data: { isActive: false } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'AdminAction', resourceId: id, metadata: { entity: 'User', oldStatus: 'active', newStatus: 'suspended' }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, user: updated });
  } catch (error) { next(error); }
});

export default router;
