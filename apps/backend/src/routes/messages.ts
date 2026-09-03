import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import prisma from '../lib/prisma';

const router: Router = Router();

router.get('/visit/:visitId', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { visitId } = req.params;
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      select: { nurseId: true, doctorId: true, booking: { select: { patientId: true } } },
    });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    const isAuthorized = req.user!.role === UserRole.ADMIN || visit.booking.patientId === req.user!.id || visit.nurseId === req.user!.id || visit.doctorId === req.user!.id;
    if (!isAuthorized) return res.status(403).json({ error: 'Access denied' });
    const messages = await prisma.message.findMany({ where: { visitId }, orderBy: { createdAt: 'asc' } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'LIST', resource: 'Message', metadata: { visitId, count: messages.length }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, messages });
  } catch (error) { next(error); }
});

router.post('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { visitId, recipientId, content, type } = req.body;
    const visit = await prisma.visit.findUnique({ where: { id: visitId }, select: { id: true, nurseId: true, doctorId: true, booking: { select: { patientId: true } } } });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    const isAuthorized = req.user!.role === UserRole.ADMIN || visit.booking.patientId === req.user!.id || visit.nurseId === req.user!.id || visit.doctorId === req.user!.id;
    if (!isAuthorized) return res.status(403).json({ error: 'Access denied' });
    const message = await prisma.message.create({ data: { visitId, senderId: req.user!.id, recipientId, content, type: type || 'TEXT' } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'CREATE', resource: 'Message', resourceId: message.id, metadata: { visitId, recipientId, type }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.status(201).json({ success: true, message });
  } catch (error) { next(error); }
});

export default router;
