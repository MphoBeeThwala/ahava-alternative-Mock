import { Router } from 'express';
import crypto from 'crypto';
import { PayFastService } from '../services/payfast';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import prisma from '../lib/prisma';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware, requireAdmin } from '../middleware/auth';

const router: Router = Router();
const payfast = new PayFastService();

// Initialize payment for a nurse visit
router.post('/create', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { visitId } = req.body;

    if (!visitId) {
      return res.status(400).json({ error: 'visitId is required' });
    }

    // Verify the visit exists and the caller is authorised for it
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      select: {
        id: true,
        nurseId: true,
        doctorId: true,
        booking: { select: { patientId: true, amountInCents: true } },
      },
    });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });

    const patientId = visit.booking.patientId;
    const authorized =
      req.user!.role === UserRole.ADMIN ||
      patientId === req.user!.id ||
      visit.nurseId === req.user!.id ||
      visit.doctorId === req.user!.id;
    if (!authorized) return res.status(403).json({ error: 'Access denied' });

    // The amount comes from the booking, never from the request body. It used
    // to be read from `req.body.amount`, which let the payer name their price.
    const amountInCents = visit.booking.amountInCents;
    if (!Number.isInteger(amountInCents) || amountInCents <= 0) {
      return res.status(409).json({ error: 'This visit has no amount to pay' });
    }

    // Reject a second checkout for a visit that is already paid or in flight.
    const existing = await prisma.payment.findFirst({
      where: { visitId, status: { in: ['COMPLETED', 'PROCESSING'] } },
      select: { id: true, status: true },
    });
    if (existing) {
      return res.status(409).json({
        error: existing.status === 'COMPLETED'
          ? 'This visit has already been paid'
          : 'A payment for this visit is already in progress',
      });
    }

    // Unique per attempt. This used to be the visitId, so repeat attempts on
    // one visit collided and the ITN handler correlated to an arbitrary row.
    const reference = `AHV-${visitId}-${crypto.randomUUID()}`;

    const payfastResult = await payfast.createPayment(amountInCents, 'Nurse Visit', reference);

    // Persist payment record (paystackReference doubles as gateway correlation ref)
    const record = await prisma.payment.create({
      data: {
        visitId,
        amountInCents,
        status: 'PENDING',
        paystackReference: reference,
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

// PayFast webhook handler (ITN) — unauthenticated, protected by all four of
// PayFast's documented checks: signature, source IP, amount, and a
// server-to-server confirmation postback.
//
// Always answer 200 once a notification is genuine. PayFast retries anything
// else, and a retry storm on an already-recorded payment helps nobody.
router.post('/webhook', async (req, res) => {
  const reject = async (reason: string, meta: Record<string, unknown> = {}) => {
    await createAuditLog({
      userId: null,
      userRole: undefined,
      action: 'UPDATE',
      resource: 'Payment',
      metadata: { event: 'WEBHOOK_REJECTED', reason, ...meta },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    }).catch(() => undefined);
    console.warn(`[payments] ITN rejected: ${reason}`);
  };

  try {
    const data = req.body ?? {};

    // 1. Signature
    if (!(await payfast.verifyPayment(data))) {
      await reject('SIGNATURE_INVALID', { pfPaymentId: data?.pf_payment_id });
      return res.status(400).send('Invalid signature');
    }

    // 2. Source address
    try {
      if (!(await payfast.isValidSourceIp(req.ip))) {
        await reject('SOURCE_IP_NOT_PAYFAST', { ip: req.ip });
        return res.status(403).send('Untrusted source');
      }
    } catch {
      // DNS lookup failed. Do not accept and do not discard - 500 makes
      // PayFast retry, by which time DNS is likely back.
      await reject('SOURCE_IP_UNRESOLVABLE', { ip: req.ip });
      return res.status(500).send('Source verification unavailable');
    }

    // 3. PayFast confirms it sent this
    const rawBody: string | undefined = (req as any).rawBody?.toString('utf8');
    if (!rawBody || !(await payfast.validateWithPayFast(rawBody))) {
      await reject('POSTBACK_NOT_VALIDATED', { pfPaymentId: data.pf_payment_id });
      return res.status(400).send('Not validated by PayFast');
    }

    const correlationRef: string | undefined = data.m_payment_id || data.custom_str1;
    const payment = correlationRef
      ? await prisma.payment.findFirst({ where: { paystackReference: correlationRef } })
      : null;

    if (!payment) {
      await reject('UNKNOWN_REFERENCE', { correlationRef });
      return res.status(200).send('OK');
    }

    // Idempotency: PayFast re-sends a notification until it gets a 200, and
    // may send more than one for a single payment.
    if (payment.status === 'COMPLETED') {
      return res.status(200).send('OK');
    }

    // 4. The amount matches what was owed
    const grossCents = Math.round(Number(data.amount_gross) * 100);
    if (!Number.isFinite(grossCents) || grossCents !== payment.amountInCents) {
      await reject('AMOUNT_MISMATCH', {
        paymentId: payment.id,
        expectedCents: payment.amountInCents,
        receivedCents: Number.isFinite(grossCents) ? grossCents : null,
      });
      return res.status(200).send('OK');
    }

    // Only 'COMPLETE' means paid. The handler used to set COMPLETED for any
    // signature-valid notification, including failures and cancellations.
    const gatewayStatus = String(data.payment_status ?? '').toUpperCase();
    const nextStatus =
      gatewayStatus === 'COMPLETE'
        ? 'COMPLETED'
        : gatewayStatus === 'CANCELLED'
          ? 'FAILED'
          : gatewayStatus === 'FAILED'
            ? 'FAILED'
            : null;

    if (nextStatus === null) {
      await reject('UNRECOGNISED_STATUS', { paymentId: payment.id, gatewayStatus });
      return res.status(200).send('OK');
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: nextStatus, paystackData: data as unknown as any },
    });

    await createAuditLog({
      userId: null,
      userRole: undefined,
      action: nextStatus === 'COMPLETED' ? 'PAYMENT_COMPLETED' : 'PAYMENT_FAILED',
      resource: 'Payment',
      resourceId: payment.id,
      metadata: {
        gatewayRef: data.pf_payment_id,
        gatewayStatus,
        amountCents: payment.amountInCents,
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

// Process refund (admin only).
//
// `authMiddleware` is applied per-route here because this router is mounted
// without app-level auth (the ITN webhook cannot present a JWT). Without it,
// requireAdmin saw no req.user and this endpoint answered 401 to everyone,
// including admins.
router.post('/:id/refund', authMiddleware, requireAdmin, async (req: AuthenticatedRequest, res) => {
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
