import { Router } from 'express';
import { UserRole, VisitStatus } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware, requireNurse } from '../middleware/auth';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import { safeDecrypt } from '../utils/encryption';
import prisma from '../lib/prisma';

// Found via a real user report, 2026-09-14: these queries never selected
// encryptedAddress at all, so every caller (patient, nurse, doctor) always
// saw the frontend's generic "Address on file" fallback, never the real
// visit address. Decrypts in place rather than shipping raw ciphertext to
// the client for no purpose.
type WithDecryptedAddress<T extends { booking?: { encryptedAddress?: string } | null }> = T & {
  booking?: (Omit<NonNullable<T['booking']>, 'encryptedAddress'> & { address: string | null }) | null;
};

function withDecryptedBookingAddress<T extends { booking?: { encryptedAddress?: string } | null }>(
  entity: T,
): WithDecryptedAddress<T> {
  if (!entity.booking) return entity as WithDecryptedAddress<T>;
  const { encryptedAddress, ...bookingRest } = entity.booking;
  return { ...entity, booking: { ...bookingRest, address: safeDecrypt(encryptedAddress) } } as WithDecryptedAddress<T>;
}

const router: Router = Router();

// Get visits for user
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const where: any = {};
    if (req.user!.role === UserRole.PATIENT) where.booking = { patientId: req.user!.id };
    else if (req.user!.role === UserRole.NURSE) where.nurseId = req.user!.id;
    else if (req.user!.role === UserRole.DOCTOR) where.doctorId = req.user!.id;
    const visits = await prisma.visit.findMany({ where, include: { booking: { select: { patientId: true, encryptedAddress: true, patient: { select: { id: true, firstName: true, lastName: true } } } }, nurse: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'LIST', resource: 'Visit', metadata: { count: visits.length, role: req.user!.role }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, visits: visits.map(withDecryptedBookingAddress) });
  } catch (error) { return next(error); }
});

// Get specific visit
router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const visit = await prisma.visit.findUnique({ where: { id }, include: { booking: { select: { patientId: true, encryptedAddress: true, patient: { select: { id: true, firstName: true, lastName: true } } } }, nurse: true, doctor: true, messages: { orderBy: { createdAt: 'desc' }, take: 10 } } });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    const isAuthorized = req.user!.role === UserRole.ADMIN || visit.booking.patientId === req.user!.id || visit.nurseId === req.user!.id || visit.doctorId === req.user!.id;
    if (!isAuthorized) return res.status(403).json({ error: 'Access denied' });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'READ', resource: 'Visit', resourceId: visit.id, metadata: { patientId: visit.booking.patientId, nurseId: visit.nurseId, status: visit.status }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, visit: withDecryptedBookingAddress(visit) });
  } catch (error) { return next(error); }
});

// Update visit status (Nurse only)
router.patch('/:id/status', requireNurse, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const visit = await prisma.visit.findUnique({ where: { id } });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    if (visit.nurseId !== req.user!.id) return res.status(403).json({ error: 'Access denied' });
    const updated = await prisma.visit.update({ where: { id }, data: { status } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'Visit', resourceId: id, metadata: { oldStatus: visit.status, newStatus: status }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, visit: updated });
  } catch (error) { return next(error); }
});

export default router;
