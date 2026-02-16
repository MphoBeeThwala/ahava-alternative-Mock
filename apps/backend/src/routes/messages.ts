
import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const router: Router = Router();
const prisma = new PrismaClient();

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
		const messages = await prisma.message.findMany();
		res.json({ success: true, messages });
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
