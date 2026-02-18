import { Router } from 'express';
import { PrismaClient, PaymentStatus } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import { notifyPaymentReceipt } from '../services/notifications';

const router: Router = Router();
const prisma = new PrismaClient();

// Payment webhook (e.g. Paystack: event=charge.success, data.reference=paystack_reference)
router.post('/payment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = req.body?.event as string | undefined;
    const reference = req.body?.data?.reference as string | undefined;

    if (event === 'charge.success' && reference) {
      const payment = await prisma.payment.findFirst({
        where: { paystackReference: reference },
        include: {
          visit: {
            include: {
              booking: {
                include: {
                  patient: {
                    select: { email: true, firstName: true, lastName: true },
                  },
                },
              },
            },
          },
        },
      });

      if (payment && payment.status !== PaymentStatus.COMPLETED) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.COMPLETED, paystackData: req.body },
        });
        const patient = payment.visit?.booking?.patient;
        if (patient?.email) {
          await notifyPaymentReceipt({
            to: patient.email,
            recipientName: `${patient.firstName} ${patient.lastName}`,
            amountCents: payment.amountInCents,
            currency: payment.currency,
            paymentId: payment.id,
            description: 'Visit payment',
          });
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// List webhook events (for debugging; optional)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, events: [] });
  } catch (error) {
    next(error);
  }
});

export default router;
