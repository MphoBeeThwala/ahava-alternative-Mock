import { Router } from 'express';
import { PayFastService } from '../services/payfast';
import { AuditLog } from '../services/auditLog';
import { requireAuth } from '../middleware/auth';

const router = Router();
const payfast = new PayFastService();

// Initialize payment for booking/nurse visit
router.post('/create', requireAuth, async (req, res) => {
  try {
    const { amount, bookingId, type } = req.body;
    
    // AuditLog: Track payment initiation
    await AuditLog.create({
      userId: req.user.id,
      action: 'PAYMENT_INITIATED',
      resource: 'Payment',
      metadata: { bookingId, amount, type },
    });

    const payment = await payfast.createPayment(amount, type, bookingId);
    res.json(payment);
  } catch (error) {
    res.status(500).json({ error: 'Payment initialization failed' });
  }
});

// PayFast webhook handler
router.post('/webhook', async (req, res) => {
  try {
    const data = req.body;
    const isValid = await payfast.verifyPayment(data);

    if (isValid) {
      // Update payment status in database
      // Confirm booking/nurse visit
      
      // AuditLog: Track payment completion
      await AuditLog.create({
        userId: data.custom_str1 || 'system',
        action: 'PAYMENT_COMPLETED',
        resource: 'Payment',
        metadata: { 
          gatewayRef: data.txn_id, 
          amount: data.amount_gross 
        },
      });
    }

    res.status(200).send('OK');
  } catch (error) {
    res.status(500).send('Webhook processing failed');
  }
});

// Check payment status
router.get('/:id/status', requireAuth, async (req, res) => {
  try {
    // TODO: Implement payment status check
    res.json({ status: 'PENDING' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check payment status' });
  }
});

// Process refund
router.post('/:id/refund', requireAuth, async (req, res) => {
  try {
    // TODO: Implement refund processing
    
    // AuditLog: Track refund
    await AuditLog.create({
      userId: req.user.id,
      action: 'PAYMENT_REFUNDED',
      resource: 'Payment',
      metadata: { paymentId: req.params.id },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Refund failed' });
  }
});

export default router;
