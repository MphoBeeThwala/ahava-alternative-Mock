import { Router } from 'express';
import * as bcrypt from '@node-rs/bcrypt';
import Joi from 'joi';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, requireAdmin, invalidateCachedUser } from '../middleware/auth';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import { emailSchema, passwordComplexitySchema } from './auth';
import { adminOverrideVerification, SancVerificationStatus } from '../services/sancVerification';
import prisma from '../lib/prisma';

const router: Router = Router();

// Get all users (Admin only)
router.get('/users', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true,
        isActive: true, isVerified: true, createdAt: true,
        hcpsaNumber: true, hcpsaVerified: true,
        sancId: true, sancVerificationStatus: true, sancCategory: true,
      },
    });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'LIST', resource: 'AdminAction', metadata: { entity: 'User', count: users.length }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, users });
  } catch (error) { next(error); }
});

// Create a user directly (Admin only) — for onboarding staff whose identity
// the admin has already vetted, so this skips the self-registration email-
// verification flow: isVerified/isActive are true immediately.
const createUserSchema = Joi.object({
  email: emailSchema,
  password: passwordComplexitySchema,
  firstName: Joi.string().min(2).required(),
  lastName: Joi.string().min(2).required(),
  role: Joi.string().valid('PATIENT', 'NURSE', 'DOCTOR', 'ADMIN').required(),
});

router.post('/users', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = createUserSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const email = value.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'User already exists' });

    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
    const passwordHash = await bcrypt.hash(value.password, saltRounds);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: value.firstName,
        lastName: value.lastName,
        role: value.role,
        isActive: true,
        isVerified: true,
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, isVerified: true, createdAt: true },
    });

    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'CREATE', resource: 'AdminAction', resourceId: user.id, metadata: { entity: 'User', role: user.role, email: user.email }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.status(201).json({ success: true, user });
  } catch (error) { return next(error); }
});

// Get system stats (Admin only)
router.get('/stats', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const [userCount, bookingCount, visitCount, triageCaseCount] = await Promise.all([
      prisma.user.count(),
      prisma.booking.count(),
      prisma.visit.count(),
      prisma.triageCase.count(),
    ]);
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'READ', resource: 'AdminAction', metadata: { entity: 'SystemStats', userCount, bookingCount, visitCount, triageCaseCount }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    res.json({ success: true, stats: { userCount, bookingCount, visitCount, triageCaseCount } });
  } catch (error) { next(error); }
});

// Suspend or reactivate a user (Admin only).
// Found via a real report, 2026-09-17: the admin dashboard's Suspend/
// Activate toggle called PATCH /admin/users/:id (this path), but the only
// route that existed was PATCH /admin/users/:id/suspend, and even that
// always set isActive: false regardless of what was asked — so the
// "Activate" side of the toggle was unimplementable no matter the path.
// This single route now does both directions, matching the frontend.
const updateStatusSchema = Joi.object({ isActive: Joi.boolean().required() });

router.patch('/users/:id', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { error, value } = updateStatusSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (id === req.user!.id && !value.isActive) {
      return res.status(400).json({ error: 'Cannot suspend your own account' });
    }

    const updated = await prisma.user.update({ where: { id }, data: { isActive: value.isActive } });
    // AH-08: without this, a suspended user stayed authenticated on
    // whichever replica(s) had already cached them — up to
    // AUTH_USER_CACHE_TTL_SECONDS (300s default), even on the single
    // replica that just handled this very request.
    await invalidateCachedUser(id);
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'AdminAction', resourceId: id, metadata: { entity: 'User', oldStatus: user.isActive ? 'active' : 'suspended', newStatus: value.isActive ? 'active' : 'suspended' }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, user: updated });
  } catch (error) { return next(error); }
});

// Get / verify a doctor's HPCSA practice number (Admin only).
// Found via the same report: the doctor dashboard tells doctors "an
// administrator will verify it shortly" after they submit a practice
// number, but no endpoint existed anywhere for an admin to actually do
// that — every doctor was permanently stuck unverified, and every
// prescription/referral they issued would never carry a verified number.
router.get('/users/:id/hpcsa', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, hcpsaNumber: true, hcpsaVerified: true, hcpsaVerifiedAt: true },
    });
    if (!user || user.role !== UserRole.DOCTOR) {
      return res.status(404).json({ error: 'Doctor not found' });
    }
    return res.json({ success: true, hcpsa: user });
  } catch (error) { return next(error); }
});

const hpcsaSchema = Joi.object({
  hcpsaNumber: Joi.string().trim().min(1).optional(),
  verify: Joi.boolean().required(),
});

router.patch('/users/:id/hpcsa', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { error, value } = hpcsaSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, hcpsaNumber: true } });
    if (!user || user.role !== UserRole.DOCTOR) {
      return res.status(404).json({ error: 'Doctor not found' });
    }
    if (!value.hcpsaNumber && !user.hcpsaNumber) {
      return res.status(400).json({ error: 'Doctor has not submitted an HPCSA number yet' });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(value.hcpsaNumber ? { hcpsaNumber: value.hcpsaNumber } : {}),
        hcpsaVerified: value.verify,
        hcpsaVerifiedAt: value.verify ? new Date() : null,
      },
      select: { id: true, hcpsaNumber: true, hcpsaVerified: true, hcpsaVerifiedAt: true },
    });
    await invalidateCachedUser(id);
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'AdminAction', resourceId: id, metadata: { entity: 'HpcsaVerification', hcpsaNumber: updated.hcpsaNumber, verified: updated.hcpsaVerified }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, hcpsa: updated });
  } catch (error) { return next(error); }
});

// Get / manually override a nurse's SANC registration verification (Admin only).
// `verifySancRegistration` (services/sancVerification.ts) already flags a
// nurse NAME_MISMATCH / EXPIRED / SUSPENDED / NOT_FOUND during sign-up, and
// `adminOverrideVerification` already existed to clear that flag out of
// band — but it was never wired to a route or any admin UI, so a flagged
// nurse had no path back to verified. Same pattern as the HPCSA fix above.
const SANC_OVERRIDABLE_STATUSES: SancVerificationStatus[] = [
  'NOT_FOUND', 'NAME_MISMATCH', 'EXPIRED', 'SUSPENDED',
];

router.get('/users/:id/sanc', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, role: true, sancId: true, sancVerificationStatus: true,
        sancVerificationDate: true, sancCategory: true, isVerified: true,
      },
    });
    if (!user || user.role !== UserRole.NURSE) {
      return res.status(404).json({ error: 'Nurse not found' });
    }
    return res.json({ success: true, sanc: user });
  } catch (error) { return next(error); }
});

const sancOverrideSchema = Joi.object({
  reason: Joi.string().trim().min(3).required(),
});

router.patch('/users/:id/sanc', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { error, value } = sancOverrideSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, sancVerificationStatus: true },
    });
    if (!user || user.role !== UserRole.NURSE) {
      return res.status(404).json({ error: 'Nurse not found' });
    }
    const status = user.sancVerificationStatus as SancVerificationStatus | null;
    if (!status || !SANC_OVERRIDABLE_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'This nurse is not flagged for manual SANC review' });
    }

    await adminOverrideVerification(id, req.user!.id, value.reason);

    const updated = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, sancId: true, sancVerificationStatus: true,
        sancVerificationDate: true, sancCategory: true, isVerified: true,
      },
    });
    await invalidateCachedUser(id);
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'AdminAction', resourceId: id, metadata: { entity: 'SancVerification', reason: value.reason, status: updated?.sancVerificationStatus }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, sanc: updated });
  } catch (error) { return next(error); }
});

// Reset trial/demo data (Admin only) — the "nuclear option" on the admin
// dashboard. Found via the same report: the button called POST
// /admin/reset-trial-data, which didn't exist at all, so it 404'd for
// every admin who ever clicked it. The frontend already double-confirms
// (a confirm() dialog, then typing "RESET" into a prompt), but those are
// both client-side and trivially bypassed by calling this endpoint
// directly — so `confirm: "RESET"` is required in the request body too,
// mirroring the --confirm flag on scripts/reset-triage-cases.ts.
// keepUsers=true wipes transactional/trial data but leaves every account
// intact; keepUsers=false additionally deletes every user except the
// admin who made the call.
const resetTrialDataSchema = Joi.object({
  keepUsers: Joi.boolean().default(true),
  confirm: Joi.string().valid('RESET').required(),
});

router.post('/reset-trial-data', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = resetTrialDataSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const callerId = req.user!.id;

    await prisma.message.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.biometricReading.deleteMany({});
    await prisma.userBaseline.deleteMany({});
    await prisma.healthAlert.deleteMany({});
    await prisma.prescription.deleteMany({});
    await prisma.referral.deleteMany({});
    await prisma.triageCase.deleteMany({});
    await prisma.visit.deleteMany({});
    await prisma.booking.deleteMany({});
    await prisma.patientConsent.deleteMany({});

    let deletedUserCount = 0;
    if (!value.keepUsers) {
      await prisma.refreshToken.deleteMany({ where: { userId: { not: callerId } } });
      const result = await prisma.user.deleteMany({ where: { id: { not: callerId } } });
      deletedUserCount = result.count;
    }

    await createAuditLog({ userId: callerId, userRole: req.user!.role, action: 'DELETE', resource: 'AdminAction', metadata: { entity: 'ResetTrialData', keepUsers: value.keepUsers, deletedUserCount }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, keepUsers: value.keepUsers, deletedUserCount });
  } catch (error) { return next(error); }
});

export default router;
