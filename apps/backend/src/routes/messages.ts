
import { Router, Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import prisma from '../lib/prisma';

const router: Router = Router();

// Create a new message
router.post('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const message = await prisma.message.create({
      data: req.body,
    });
    res.status(201).json({ success: true, message });
  } catch (error) {
    next(error);
  }
});

// Get all messages
router.get('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
	try {
    const r = req as AuthenticatedRequest;
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);
    const visitId = (req.query.visitId as string | undefined) || undefined;

    const where: any = {};
    if (visitId) where.visitId = visitId;

    if (r.user?.role !== 'ADMIN') {
      where.OR = [
        { senderId: r.user!.id },
        { recipientId: r.user!.id },
      ];
    }

		const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
		res.json({ success: true, messages, meta: { limit, offset } });
	} catch (error) {
		next(error);
	}
});

// Get a single message by ID
router.get('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const message = await prisma.message.findUnique({
      where: { id: req.params.id },
    });
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    res.json({ success: true, message });
  } catch (error) {
    next(error);
  }
});

// Update a message
router.put('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const message = await prisma.message.update({
			where: { id: req.params.id },
			data: req.body,
		});
		res.json({ success: true, message });
	} catch (error) {
		next(error);
	}
});

// Delete a message
router.delete('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.message.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
