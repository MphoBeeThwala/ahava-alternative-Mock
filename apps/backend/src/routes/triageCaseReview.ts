import { Router } from 'express';
import { UserRole, TriageCaseStatus } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware, requireDoctor } from '../middleware/auth';
import { createAuditLog } from '../services/auditLog';
import prisma from '../lib/prisma';

const router: Router = Router();

// Doctor releases triage case to patient
router.post('/:id/release', requireDoctor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const triageCase = await prisma.triageCase.findUnique({ where: { id } });
    if (!triageCase) return res.status(404).json({ error: 'Triage case not found' });
    if (triageCase.doctorId !== req.user!.id) return res.status(403).json({ error: 'Access denied' });
    if (triageCase.status !== TriageCaseStatus.REVIEWED) return res.status(400).json({ error: 'Case must be reviewed before release' });
    const updated = await prisma.triageCase.update({ where: { id }, data: { status: TriageCaseStatus.RELEASED, releasedAt: new Date() } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'TriageCaseReview', resourceId: id, metadata: { oldStatus: triageCase.status, newStatus: 'RELEASED' }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, triageCase: updated });
  } catch (error) { next(error); }
});

// Get cases needing review
router.get('/pending', requireDoctor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const cases = await prisma.triageCase.findMany({ where: { status: TriageCaseStatus.PENDING_REVIEW, doctorId: null }, include: { patient: { select: { id: true, firstName: true, lastName: true, age: true } } }, orderBy: { createdAt: 'asc' } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'LIST', resource: 'TriageCaseReview', metadata: { count: cases.length, status: 'PENDING_REVIEW' }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, cases });
  } catch (error) { next(error); }
});

// Doctor claims a case for review
router.post('/:id/claim', requireDoctor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const triageCase = await prisma.triageCase.findUnique({ where: { id } });
    if (!triageCase) return res.status(404).json({ error: 'Triage case not found' });
    if (triageCase.doctorId && triageCase.doctorId !== req.user!.id) return res.status(403).json({ error: 'Case already claimed by another doctor' });
    const updated = await prisma.triageCase.update({ where: { id }, data: { doctorId: req.user!.id, status: TriageCaseStatus.ASSIGNED } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'TriageCaseReview', resourceId: id, metadata: { oldStatus: triageCase.status, newStatus: 'ASSIGNED', doctorId: req.user!.id }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, triageCase: updated });
  } catch (error) { next(error); }
});

export default router;
