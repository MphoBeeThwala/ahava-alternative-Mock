import { Router } from 'express';import { PayFastService } from '../services/payfast';
import { createAuditLog } from '../services/auditLog';
import prisma from '../lib/prisma';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware, requireAdmin } from '../middleware/auth';

const router: Router = Router();
const payfast = new PayFastService();

// Initialize payment for a nurse visit
router.post('/create', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { visitId, amount } = req.body;

    if (!visitId || !amount) {
      return res.status(400).json({ error: 'visitId and amount are required' });
    }

    // Verify the visit exists and the caller is authorised for it
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      select: { id: true, nurseId: true, doctorId: true, booking: { select: { patientId: true } } },
    });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });

    const patientId = visit.booking.patientId;
    const authorized =
      req.user!.role === UserRole.ADMIN ||
      patientId === req.user!.id ||
      visit.nurseId === req.user!.id ||
      visit.doctorId === req.user!.id;
    if (!authorized) return res.status(403).json({ error: 'Access denied' });

    const payfastResult = await payfast.createPayment(amount, 'Nurse Visit', visitId);

    // Persist payment record (paystackReference doubles as gateway correlation ref)
    const record = await prisma.payment.create({
      data: {
        visitId,
        amountInCents: Math.round(Number(amount)),
        status: 'PENDING',
        paystackReference: visitId,
        paystackData: payfastResult.data as unknown as any,
      },
    });

    // Audit log: track payment initiation
    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'PAYMENT_INITIATED',
      resource: 'Payment',
      resourceId: record.id,
      metadata: { visitId, amountInCents: record.amountInCents },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    res.json({ success: true, payment: record, payfast: payfastResult });
  } catch (error) {
    console.error('[payments] Payment initialization failed:', error);
    res.status(500).json({ error: 'Payment initialization failed' });
  }
});

// PayFast webhook handler (ITN) - unauthenticated but signature-verified
router.post('/webhook', async (req, res) => {
  try {
    const data = req.body;
    const isValid = await payfast.verifyPayment(data);

    if (!isValid) {
      // Log rejected webhook attempts for security review
      await createAuditLog({
        userId: null,
        userRole: undefined,
        action: 'UPDATE',
        resource: 'Payment',
        metadata: { event: 'WEBHOOK_SIGNATURE_INVALID', txn_id: data?.txn_id },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      }).catch(() => undefined);
      return res.status(400).send('Invalid signature');
    }

    // Update payment status in database (custom_str1 carries our visitId)
    const correlationRef: string | undefined = data.custom_str1;
    const payment = correlationRef
      ? await prisma.payment.findFirst({ where: { paystackReference: correlationRef } })
      : null;

    if (payment) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'COMPLETED',
          paystackData: data as unknown as any,
        },
      });
    }

    // Audit log: track payment completion
    await createAuditLog({
      userId: null,
      userRole: undefined,
      action: 'PAYMENT_COMPLETED',
      resource: 'Payment',
      resourceId: payment?.id ?? null,
      metadata: {
        gatewayRef: data.txn_id,
        amountGross: data.amount_gross,
        correlated: !!payment,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error('[payments] Webhook processing failed:', error);
    res.status(500).send('Webhook processing failed');
  }
});

// Check payment status
router.get('/:id/status', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        visitId: true,
        amountInCents: true,
        currency: true,
        status: true,
        visit: { select: { nurseId: true, doctorId: true, booking: { select: { patientId: true } } } },
      },
    });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const patientId = payment.visit.booking.patientId;
    const authorized =
      req.user!.role === UserRole.ADMIN ||
      patientId === req.user!.id ||
      payment.visit.nurseId === req.user!.id ||
      payment.visit.doctorId === req.user!.id;
    if (!authorized) return res.status(403).json({ error: 'Access denied' });

    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'READ',
      resource: 'Payment',
      resourceId: payment.id,
      metadata: { status: payment.status },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    res.json({ success: true, payment });
  } catch (error) {
    console.error('[payments] Status check failed:', error);
    res.status(500).json({ error: 'Failed to check payment status' });
  }
});

// Process refund (admin only)
router.post('/:id/refund', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Only completed payments can be refunded' });
    }

    // TODO: Call PayFast refund API once credentials are provisioned
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED' },
    });

    // Audit log: track refund
    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'PAYMENT_REFUNDED',
      resource: 'Payment',
      resourceId: payment.id,
      metadata: { visitId: payment.visitId, amountInCents: payment.amountInCents },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    res.json({ success: true, payment: updated });
  } catch (error) {
    console.error('[payments] Refund failed:', error);
    res.status(500).json({ error: 'Refund failed' });
  }
});

export default router;
