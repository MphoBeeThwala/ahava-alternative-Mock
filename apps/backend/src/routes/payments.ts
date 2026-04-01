
import { Router, Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import prisma from '../lib/prisma';

const router: Router = Router();

// Create a new payment
router.post('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const payment = await prisma.payment.create({
			data: req.body,
		});
		res.status(201).json({ success: true, payment });
	} catch (error) {
		next(error);
	}
});

// Get all payments
router.get('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
	try {
    const r = req as AuthenticatedRequest;
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);

    const where: any = {};
    if (r.user?.role === 'PATIENT') {
      where.visit = { booking: { patientId: r.user.id } };
    } else if (r.user?.role === 'NURSE') {
      where.visit = { nurseId: r.user.id };
    } else if (r.user?.role === 'DOCTOR') {
      where.visit = { doctorId: r.user.id };
    }

		const payments = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
		res.json({ success: true, payments, meta: { limit, offset } });
	} catch (error) {
		next(error);
	}
});

// Get a single payment by ID
router.get('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const payment = await prisma.payment.findUnique({
			where: { id: req.params.id },
		});
		if (!payment) {
			res.status(404).json({ error: 'Payment not found' });
			return;
		}
		res.json({ success: true, payment });
	} catch (error) {
		next(error);
	}
});

// Update a payment
router.put('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const payment = await prisma.payment.update({
			where: { id: req.params.id },
			data: req.body,
		});
		res.json({ success: true, payment });
	} catch (error) {
		next(error);
	}
});

// Delete a payment

router.delete('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.payment.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
export default router;
