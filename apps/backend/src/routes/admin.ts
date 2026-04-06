import { Router } from 'express';
import { UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { requireAdmin } from '../middleware/auth';
import prisma from '../lib/prisma';

const router: Router = Router();

const createUserSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  firstName: Joi.string().min(2).required(),
  lastName: Joi.string().min(2).required(),
  role: Joi.string().valid('PATIENT', 'NURSE', 'DOCTOR', 'ADMIN').required(),
  phone: Joi.string().allow('').optional(),
  preferredLanguage: Joi.string().default('en-ZA'),
});

// All admin routes require admin role (authMiddleware already applied in index)
router.use(requireAdmin);

// Stats for admin dashboard
router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const totalUsers = await prisma.user.count();
    res.json({ success: true, totalUsers });
  } catch (error) {
    next(error);
  }
});

// Create user (including admin) – password is hashed
router.post('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { error, value } = createUserSchema.validate(req.body);
    if (error) {
      res.status(400).json({ error: error.details[0].message });
      return;
    }
    const existing = await prisma.user.findUnique({ where: { email: value.email } });
    if (existing) {
      res.status(400).json({ error: 'User with this email already exists' });
      return;
    }
    const passwordHash = await bcrypt.hash(value.password, 12);
    const user = await prisma.user.create({
      data: {
        email: value.email,
        passwordHash,
        firstName: value.firstName,
        lastName: value.lastName,
        role: value.role as UserRole,
        phone: value.phone || null,
        preferredLanguage: value.preferredLanguage,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
      },
    });
    res.status(201).json({ success: true, user });
  } catch (err) {
    next(err);
  }
});

// Get all users
router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 50));
    const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    res.json({ success: true, users, meta: { limit, offset } });
  } catch (error) {
    next(error);
  }
});

// Get a single user by ID
router.get('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
      },
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

const updateUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = ['firstName', 'lastName', 'role', 'isActive', 'isVerified', 'phone', 'preferredLanguage'];
    const data: Record<string, unknown> = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) data[k] = req.body[k];
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        isVerified: true,
      },
    });
    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

// Update a user (e.g. isActive, role) – no password update here
router.put('/users/:id', updateUser);
router.patch('/users/:id', updateUser);

// Delete a user
router.delete('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// PATCH /api/admin/users/:id/hpcsa
// Admin sets or verifies a doctor's HPCSA practice number.
// Body: { hcpsaNumber: string, verify?: boolean }
// -----------------------------------------------------------------------
router.patch('/users/:id/hpcsa', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { hcpsaNumber, verify } = req.body as { hcpsaNumber?: string; verify?: boolean };

    if (!hcpsaNumber || typeof hcpsaNumber !== 'string' || !hcpsaNumber.trim()) {
      res.status(400).json({ error: 'hcpsaNumber is required.' });
      return;
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    if (target.role !== 'DOCTOR') {
      res.status(400).json({ error: 'HPCSA numbers can only be set on DOCTOR accounts.' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        hcpsaNumber: hcpsaNumber.trim().toUpperCase(),
        hcpsaVerified: verify === true,
        hcpsaVerifiedAt: verify === true ? new Date() : undefined,
      } as Record<string, unknown>,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        hcpsaNumber: true,
        hcpsaVerified: true,
        hcpsaVerifiedAt: true,
      } as any,
    });

    res.json({ success: true, user: updated });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------
// GET /api/admin/users/:id/hpcsa  — retrieve a doctor's HPCSA status
// -----------------------------------------------------------------------
router.get('/users/:id/hpcsa', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        hcpsaNumber: true,
        hcpsaVerified: true,
        hcpsaVerifiedAt: true,
      } as any,
    });
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
});

export default router;
