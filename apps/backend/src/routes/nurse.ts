import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware, requireNurse } from '../middleware/auth';
import { createAuditLog } from '../services/auditLog';
import prisma from '../lib/prisma';

const router: Router = Router();

// Get nurse profile
router.get('/profile', requireNurse, async (req: AuthenticatedRequest, res, next) => {
  try {
    const nurse = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, isAvailable: true, lastKnownLat: true, lastKnownLng: true, sancId: true, sancVerificationStatus: true, sancCategory: true, createdAt: true }
    });
    if (!nurse) return res.status(404).json({ error: 'Nurse not found' });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'READ', resource: 'Nurse', resourceId: nurse.id, metadata: { fields: Object.keys(nurse) }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, nurse });
  } catch (error) { next(error); }
});

// Update availability
router.patch('/availability', requireNurse, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { isAvailable, lat, lng } = req.body;
    const nurse = await prisma.user.update({
      where: { id: req.user!.id },
      data: { isAvailable, lastKnownLat: lat, lastKnownLng: lng, lastLocationUpdate: new Date() },
      select: { id: true, isAvailable: true, lastKnownLat: true, lastKnownLng: true }
    });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'Nurse', resourceId: nurse.id, metadata: { oldAvailability: !isAvailable, newAvailability: isAvailable, lat, lng }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, nurse });
  } catch (error) { next(error); }
});

// Get nurse visits
router.get('/visits', requireNurse, async (req: AuthenticatedRequest, res, next) => {
  try {
    const visits = await prisma.visit.findMany({
      where: { nurseId: req.user!.id },
      include: { booking: { select: { scheduledDate: true, amountInCents: true, patient: { select: { id: true, firstName: true, lastName: true, phone: true } } } } },
      orderBy: { scheduledStart: 'desc' }
    });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'LIST', resource: 'Nurse', metadata: { entity: 'Visit', count: visits.length }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, visits });
  } catch (error) { next(error); }
});

export default router;
