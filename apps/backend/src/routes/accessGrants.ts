/**
 * Managing who may see a patient's record (services/careAccess.ts):
 *  - admins grant, revoke and review access — they don't use it;
 *  - verified clinicians see their own active access and can invoke
 *    break-glass in an emergency (short, justified, reviewed afterwards);
 *  - patients see everyone who has had access to their record, and why.
 */
import { Router } from 'express';
import Joi from 'joi';
import { AccessGrantReason, UserRole } from '@prisma/client';
import { AuthenticatedRequest, requireAdmin, requireRole } from '../middleware/auth';
import { writeRequestAudit } from '../services/clinicalAudit';
import { notifyEmergencyAccess } from '../services/notifications';
import {
  ACCESS_WINDOWS, checkVerifiedClinician, displayName, grantAccess, hoursFromNow, requireVerifiedClinician,
} from '../services/careAccess';
import { encryptData, safeDecrypt } from '../utils/encryption';
import prisma from '../lib/prisma';

const router: Router = Router();

// Justifications can name the patient's condition, so they're encrypted at
// rest like other written clinical text, under their own AAD label.
const JUSTIFICATION_AAD = 'access-grant:justification';
const encryptJustification = (text: string) => encryptData(text, JUSTIFICATION_AAD);
const decryptJustification = (value: string | null) => safeDecrypt(value, JUSTIFICATION_AAD);

const clinicianSelect = {
  id: true, firstName: true, lastName: true, role: true, sancId: true, hcpsaNumber: true,
} as const;

function grantStatus(g: { revokedAt: Date | null; expiresAt: Date; startsAt: Date }, now = new Date()) {
  if (g.revokedAt) return 'REVOKED';
  if (g.expiresAt <= now) return 'EXPIRED';
  if (g.startsAt > now) return 'PENDING';
  return 'ACTIVE';
}

async function audit(req: AuthenticatedRequest, action: string, resourceId: string, metadata: Record<string, unknown>) {
  await writeRequestAudit({
    userId: req.user!.id,
    userRole: req.user!.role,
    action,
    resource: 'PatientAccessGrant',
    resourceId,
    metadata,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
  });
}

async function requirePatientUser(patientId: string) {
  const patient = await prisma.user.findUnique({ where: { id: patientId }, select: { id: true, role: true } });
  return patient?.role === UserRole.PATIENT ? patient : null;
}

// ---------------------------------------------------------------------------
// Clinician: my current access
// ---------------------------------------------------------------------------
router.get('/mine', requireVerifiedClinician(), async (req: AuthenticatedRequest, res, next) => {
  try {
    const now = new Date();
    const grants = await prisma.patientAccessGrant.findMany({
      where: { clinicianId: req.user!.id, revokedAt: null, startsAt: { lte: now }, expiresAt: { gt: now } },
      include: { patient: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { expiresAt: 'asc' },
    });
    return res.json({
      success: true,
      grants: grants.map((g) => ({
        id: g.id,
        patient: { id: g.patient.id, name: displayName(g.patient.firstName, g.patient.lastName) },
        reason: g.reason,
        sourceId: g.sourceId,
        startsAt: g.startsAt,
        expiresAt: g.expiresAt,
      })),
    });
  } catch (error) { return next(error); }
});

async function notifyPatientOfEmergencyAccess(clinicianId: string, patientId: string, grantedAt: Date, expiresAt: Date) {
  const [patient, clinician] = await Promise.all([
    prisma.user.findUnique({ where: { id: patientId }, select: { email: true, firstName: true, lastName: true } }),
    prisma.user.findUnique({ where: { id: clinicianId }, select: clinicianSelect }),
  ]);
  if (!patient?.email || !clinician) return;
  await notifyEmergencyAccess({
    to: patient.email,
    patientName: `${patient.firstName} ${patient.lastName}`,
    clinicianName: `${clinician.firstName} ${clinician.lastName}`,
    clinicianRole: clinician.role === UserRole.NURSE ? 'Nurse' : 'Doctor',
    registration: clinician.role === UserRole.NURSE
      ? (clinician.sancId ? `SANC ${clinician.sancId}` : null)
      : (clinician.hcpsaNumber ? `HPCSA ${clinician.hcpsaNumber}` : null),
    grantedAt,
    expiresAt,
  });
}

// ---------------------------------------------------------------------------
// Clinician: break-glass (emergency access)
// ---------------------------------------------------------------------------
const breakGlassSchema = Joi.object({
  patientId: Joi.string().required(),
  justification: Joi.string().trim().min(20).max(2000).required()
    .messages({ 'string.min': 'Explain the emergency (at least 20 characters). This is reviewed by an administrator.' }),
});

router.post('/break-glass', requireVerifiedClinician(), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = breakGlassSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    if (!(await requirePatientUser(value.patientId))) return res.status(404).json({ error: 'Patient not found' });

    const grant = await grantAccess({
      clinicianId: req.user!.id,
      patientId: value.patientId,
      reason: AccessGrantReason.BREAK_GLASS,
      expiresAt: hoursFromNow(ACCESS_WINDOWS.breakGlassHours),
      justification: encryptJustification(value.justification),
    });
    await audit(req, 'BREAK_GLASS', grant.id, { patientId: value.patientId, expiresAt: grant.expiresAt.toISOString() });
    // Tell the patient, at their registered email. Best-effort: the access
    // is already granted and logged, and appears in their access history
    // whether or not the email goes out.
    notifyPatientOfEmergencyAccess(req.user!.id, value.patientId, grant.startsAt, grant.expiresAt)
      .catch((err) => console.warn('[access-grants] emergency-access email failed:', (err as Error)?.message ?? err));
    return res.status(201).json({
      success: true,
      grant: { id: grant.id, patientId: grant.patientId, reason: grant.reason, expiresAt: grant.expiresAt },
      notice: 'Emergency access is logged, visible to the patient, and reviewed by an administrator.',
    });
  } catch (error) { return next(error); }
});

// ---------------------------------------------------------------------------
// Patient: who has had access to my record
// ---------------------------------------------------------------------------
router.get('/my-record', requireRole([UserRole.PATIENT]), async (req: AuthenticatedRequest, res, next) => {
  try {
    const grants = await prisma.patientAccessGrant.findMany({
      where: { patientId: req.user!.id },
      include: { clinician: { select: clinicianSelect } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    await audit(req, 'LIST', req.user!.id, { view: 'PATIENT_ACCESS_LOG', count: grants.length });
    return res.json({
      success: true,
      access: grants.map((g) => ({
        id: g.id,
        clinician: {
          name: `${g.clinician.firstName} ${g.clinician.lastName}`,
          role: g.clinician.role,
          registration: g.clinician.role === UserRole.NURSE ? { body: 'SANC', number: g.clinician.sancId } : { body: 'HPCSA', number: g.clinician.hcpsaNumber },
        },
        reason: g.reason,
        startsAt: g.startsAt,
        expiresAt: g.expiresAt,
        revokedAt: g.revokedAt,
        status: grantStatus(g),
      })),
    });
  } catch (error) { return next(error); }
});

// ---------------------------------------------------------------------------
// Admin: list, grant, revoke, review
// ---------------------------------------------------------------------------
router.get('/', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const view = String(req.query.view ?? 'active');
    const now = new Date();
    const where: any = {};
    if (view === 'active') Object.assign(where, { revokedAt: null, startsAt: { lte: now }, expiresAt: { gt: now } });
    else if (view === 'break-glass-review') Object.assign(where, { reason: AccessGrantReason.BREAK_GLASS, reviewedAt: null });
    else if (view !== 'all') return res.status(400).json({ error: 'view must be active, break-glass-review or all' });
    if (typeof req.query.patientId === 'string') where.patientId = req.query.patientId;
    if (typeof req.query.clinicianId === 'string') where.clinicianId = req.query.clinicianId;

    const grants = await prisma.patientAccessGrant.findMany({
      where,
      include: {
        clinician: { select: clinicianSelect },
        patient: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    await audit(req, 'LIST', 'all', { view, count: grants.length });
    return res.json({
      success: true,
      grants: grants.map((g) => ({
        id: g.id,
        clinician: g.clinician,
        patient: { id: g.patient.id, name: `${g.patient.firstName} ${g.patient.lastName}` },
        reason: g.reason,
        sourceId: g.sourceId,
        justification: decryptJustification(g.justification),
        grantedById: g.grantedById,
        startsAt: g.startsAt,
        expiresAt: g.expiresAt,
        revokedAt: g.revokedAt,
        reviewedAt: g.reviewedAt,
        reviewNote: g.reviewNote,
        status: grantStatus(g, now),
      })),
    });
  } catch (error) { return next(error); }
});

const adminGrantSchema = Joi.object({
  clinicianId: Joi.string().required(),
  patientId: Joi.string().required(),
  hours: Joi.number().integer().min(1).max(ACCESS_WINDOWS.adminGrantMaxHours).default(72),
  justification: Joi.string().trim().min(10).max(2000).required(),
});

router.post('/', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = adminGrantSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    // Admins can authorise only verified clinicians — never themselves or
    // other non-clinical staff.
    const check = await checkVerifiedClinician(value.clinicianId);
    if (!check.ok) return res.status(400).json({ error: `Cannot grant access: ${check.error}`, code: check.code });
    if (!(await requirePatientUser(value.patientId))) return res.status(404).json({ error: 'Patient not found' });

    const grant = await grantAccess({
      clinicianId: value.clinicianId,
      patientId: value.patientId,
      reason: AccessGrantReason.ADMIN_GRANT,
      expiresAt: hoursFromNow(value.hours),
      grantedById: req.user!.id,
      justification: encryptJustification(value.justification),
    });
    await audit(req, 'GRANT', grant.id, { clinicianId: value.clinicianId, patientId: value.patientId, hours: value.hours });
    return res.status(201).json({ success: true, grant: { id: grant.id, expiresAt: grant.expiresAt, reason: grant.reason } });
  } catch (error) { return next(error); }
});

const revokeSchema = Joi.object({ reason: Joi.string().trim().min(3).max(1000).required() });

router.post('/:id/revoke', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = revokeSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const { count } = await prisma.patientAccessGrant.updateMany({
      where: { id: req.params.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: req.user!.id },
    });
    if (count === 0) return res.status(404).json({ error: 'Grant not found or already revoked' });
    await audit(req, 'REVOKE', req.params.id, { reason: value.reason });
    return res.json({ success: true });
  } catch (error) { return next(error); }
});

const reviewSchema = Joi.object({ note: Joi.string().trim().min(3).max(2000).required() });

router.post('/:id/review', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = reviewSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const { count } = await prisma.patientAccessGrant.updateMany({
      where: { id: req.params.id, reason: AccessGrantReason.BREAK_GLASS, reviewedAt: null },
      data: { reviewedAt: new Date(), reviewedById: req.user!.id, reviewNote: value.note },
    });
    if (count === 0) return res.status(404).json({ error: 'No unreviewed break-glass access with that id' });
    await audit(req, 'REVIEW', req.params.id, { note: value.note });
    return res.json({ success: true });
  } catch (error) { return next(error); }
});

export default router;
