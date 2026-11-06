import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import prisma from '../lib/prisma';
import Joi from 'joi';

const router: Router = Router();

// No unknown keys, bounded lengths, no markup in names (they are printed in
// emails, prescriptions and referrals).
const updateProfileSchema = Joi.object({
  firstName: Joi.string().trim().min(2).max(80).pattern(/^[^<>]*$/),
  lastName: Joi.string().trim().min(2).max(80).pattern(/^[^<>]*$/),
  phone: Joi.string().trim().pattern(/^\+?[0-9 ()-]{7,20}$/).allow(null),
  dateOfBirth: Joi.date().max('now').min('1900-01-01').allow(null),
  gender: Joi.string().trim().max(30).allow(null),
}).unknown(false);

// Get user profile
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, dateOfBirth: true, gender: true, profileImage: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'READ', resource: 'Profile', resourceId: user.id, metadata: { fields: Object.keys(user) }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, user });
  } catch (error) { return next(error); }
});

// Update profile
router.patch('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const { firstName, lastName, phone, dateOfBirth, gender } = value;
    // A nurse's or doctor's name was checked against the SANC / HPCSA register.
    // Changing it afterwards would put an unverified name on prescriptions.
    if ((req.user!.role === UserRole.NURSE || req.user!.role === UserRole.DOCTOR) && (firstName !== undefined || lastName !== undefined)) {
      return res.status(403).json({ error: 'Clinician names are verified against the professional register. Contact an administrator to change yours.' });
    }
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { firstName, lastName, phone, dateOfBirth, gender },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, dateOfBirth: true, gender: true },
    });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'Profile', resourceId: user.id, metadata: { updatedFields: Object.keys(value) }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, user });
  } catch (error) {
    // The phone number is unique; do not reveal that another account uses it.
    if ((error as { code?: string })?.code === 'P2002') return res.status(400).json({ error: 'That value could not be saved. Please check it and try again.' });
    return next(error);
  }
});

export default router;
