
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';

const router: Router = Router();
const prisma = new PrismaClient();

// Create a new admin user (example)
router.post('/users', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const user = await prisma.user.create({
			data: req.body,
		});
		res.status(201).json({ success: true, user });
	} catch (error) {
		next(error);
	}
});

// Get all users
router.get('/users', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const users = await prisma.user.findMany();
		res.json({ success: true, users });
	} catch (error) {
		next(error);
	}
});

// Get a single user by ID
router.get('/users/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const user = await prisma.user.findUnique({
			where: { id: req.params.id },
		});
		if (!user) {
			res.status(404).json({ error: 'User not found' });
			return;
		}
		res.json({ success: true, user });
	} catch (error) {
		next(error);
	}
});

// Update a user
router.put('/users/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const user = await prisma.user.update({
			where: { id: req.params.id },
			data: req.body,
		});
		res.json({ success: true, user });
	} catch (error) {
		next(error);
	}
});

// Delete a user
router.delete('/users/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
	try {
		await prisma.user.delete({ where: { id: req.params.id } });
		res.json({ success: true });
	} catch (error) {
		next(error);
	}
});

export default router;
