
import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const router: Router = Router();
const prisma = new PrismaClient();

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
		const payments = await prisma.payment.findMany();
		res.json({ success: true, payments });
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
