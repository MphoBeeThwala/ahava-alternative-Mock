import { Router } from 'express';
import { UserRole, PaymentStatus } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { createAuditLog } from '../services/auditLog';
import prisma from '../lib/prisma';

const router: Router = Router();

// Get payments for user
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const where: any = {};
    if (req.user!.role === UserRole.PATIENT) {
      where.visit = { patientId: req.user!.id };
    } else if (req.user!.role === UserRole.NURSE) {
      where.visit = { nurseId: req.user!.id };
    } else if (req.user!.role === UserRole.DOCTOR) {
      where.visit = { doctorId: req.user!.id };
    }
    const payments = await prisma.payment.findMany({ where, include: { visit: { select: { id: true, patientId: true, nurseId: true, amountInCents: true } } }, orderBy: { createdAt: 'desc' } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'LIST', resource: 'Payment', metadata: { count: payments.length, role: req.user!.role }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, payments });
  } catch (error) { next(error); }
});

// Get specific payment
router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const payment = await prisma.payment.findUnique({ where: { id }, include: { visit: true } });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    const isAuthorized = req.user!.role === UserRole.ADMIN || payment.visit.patientId === req.user!.id || payment.visit.nurseId === req.user!.id || payment.visit.doctorId === req.user!.id;
    if (!isAuthorized) return res.status(403).json({ error: 'Access denied' });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'READ', resource: 'Payment', resourceId: payment.id, metadata: { visitId: payment.visitId, amountInCents: payment.amountInCents, status: payment.status }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, payment });
  } catch (error) { next(error); }
});

// Update payment status
router.patch('/:id/status', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const payment = await prisma.payment.findUnique({ where: { id }, include: { visit: true } });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    const isAuthorized = req.user!.role === UserRole.ADMIN || payment.visit.nurseId === req.user!.id;
    if (!isAuthorized) return res.status(403).json({ error: 'Access denied' });
    const updated = await prisma.payment.update({ where: { id }, data: { status } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'Payment', resourceId: id, metadata: { oldStatus: payment.status, newStatus: status }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, payment: updated });
  } catch (error) { next(error); }
});

export default router;
