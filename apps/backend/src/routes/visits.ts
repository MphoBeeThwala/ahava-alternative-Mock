import { Router } from 'express';
import { UserRole, VisitStatus } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware, requireDoctor, requireNurse, requireRole } from '../middleware/auth';
import { notifyVisitApproved } from '../services/notifications';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import { safeDecrypt } from '../utils/encryption';
import { broadcastToUsers } from '../services/websocket';
import { isVisitStatus, visitTimingFor, visitTransitionError } from '../services/visitStatus';
import prisma from '../lib/prisma';

// Found via a real user report, 2026-09-14: these queries never selected
// encryptedAddress at all, so every caller (patient, nurse, doctor) always
// saw the frontend's generic "Address on file" fallback, never the real
// visit address. Decrypts in place rather than shipping raw ciphertext to
// the client for no purpose.
type WithDecryptedAddress<T extends { booking?: { encryptedAddress?: string } | null }> = T & {
  booking?: (Omit<NonNullable<T['booking']>, 'encryptedAddress'> & { address: string | null }) | null;
};

function withDecryptedBookingAddress<T extends { booking?: { encryptedAddress?: string } | null }>(
  entity: T,
): WithDecryptedAddress<T> {
  if (!entity.booking) return entity as WithDecryptedAddress<T>;
  const { encryptedAddress, ...bookingRest } = entity.booking;
  return { ...entity, booking: { ...bookingRest, address: safeDecrypt(encryptedAddress) } } as WithDecryptedAddress<T>;
}

const router: Router = Router();

const PENDING_REVIEW = 'PENDING_REVIEW';

// Get visits for user
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const where: any = {};
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
    const role = req.user!.role;
    if (statusFilter === PENDING_REVIEW && (role === UserRole.DOCTOR || role === UserRole.ADMIN)) {
      // The doctor dashboard's nurse-visit review queue. There is no
      // PENDING_REVIEW visit status: a visit awaits review once the nurse
      // has completed it and no doctor has signed it off yet. Like the
      // triage queue it's a shared pool — any doctor can pick one up, and
      // approving it assigns it to them (POST /:id/approve).
      where.status = VisitStatus.COMPLETED;
      where.doctorReview = null;
      if (role === UserRole.DOCTOR) where.OR = [{ doctorId: null }, { doctorId: req.user!.id }];
    } else {
      if (role === UserRole.PATIENT) where.booking = { patientId: req.user!.id };
      else if (role === UserRole.NURSE) where.nurseId = req.user!.id;
      else if (role === UserRole.DOCTOR) where.doctorId = req.user!.id;
      if (statusFilter !== undefined) {
        if (!isVisitStatus(statusFilter)) return res.status(400).json({ error: 'Invalid visit status filter' });
        where.status = statusFilter;
      }
    }
    const visits = await prisma.visit.findMany({ where, include: { booking: { select: { patientId: true, encryptedAddress: true, patient: { select: { id: true, firstName: true, lastName: true } } } }, nurse: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'LIST', resource: 'Visit', metadata: { count: visits.length, role: req.user!.role }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, visits: visits.map(withDecryptedBookingAddress) });
  } catch (error) { return next(error); }
});

// Get specific visit
router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const visit = await prisma.visit.findUnique({ where: { id }, include: { booking: { select: { patientId: true, encryptedAddress: true, patient: { select: { id: true, firstName: true, lastName: true } } } }, nurse: true, doctor: true, messages: { orderBy: { createdAt: 'desc' }, take: 10 } } });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    const isAuthorized = req.user!.role === UserRole.ADMIN || visit.booking.patientId === req.user!.id || visit.nurseId === req.user!.id || visit.doctorId === req.user!.id;
    if (!isAuthorized) return res.status(403).json({ error: 'Access denied' });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'READ', resource: 'Visit', resourceId: visit.id, metadata: { patientId: visit.booking.patientId, nurseId: visit.nurseId, status: visit.status }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, visit: withDecryptedBookingAddress(visit) });
  } catch (error) { return next(error); }
});

// Update visit status (assigned nurse, assigned doctor, or admin). Was
// nurse-only, so the doctor dashboard's status actions always got a 403.
router.patch('/:id/status', requireRole([UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN]), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body ?? {};
    if (!isVisitStatus(status)) return res.status(400).json({ error: 'Invalid visit status' });
    const visit = await prisma.visit.findUnique({ where: { id }, include: { booking: { select: { patientId: true } } } });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    const isAdmin = req.user!.role === UserRole.ADMIN;
    const isAssigned = visit.nurseId === req.user!.id || visit.doctorId === req.user!.id;
    if (!isAdmin && !isAssigned) return res.status(403).json({ error: 'Access denied' });
    const transitionError = visitTransitionError(visit.status, status, isAdmin);
    if (transitionError) return res.status(409).json({ error: transitionError });
    // Conditional on the status we just read, so a double-tapped button (or
    // two devices) can't advance the same visit twice.
    const { count } = await prisma.visit.updateMany({ where: { id, status: visit.status }, data: { status, ...visitTimingFor(status) } });
    if (count === 0) return res.status(409).json({ error: 'Visit status changed in the meantime; refresh and try again' });
    const updated = await prisma.visit.findUnique({ where: { id } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'Visit', resourceId: id, metadata: { oldStatus: visit.status, newStatus: status }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    // The nurse dashboard changes status over REST, not the WebSocket, so
    // without this the patient's live visit tracker never heard about it.
    const recipients = [visit.booking.patientId];
    if (visit.doctorId) recipients.push(visit.doctorId);
    broadcastToUsers(recipients, { type: 'VISIT_STATUS_CHANGED', data: { visitId: id, status, timestamp: new Date().toISOString() } });
    return res.json({ success: true, visit: updated });
  } catch (error) { return next(error); }
});

// Doctor sign-off on a completed nurse visit. The doctor dashboard has
// called this since it was built, but the route never existed (404), and
// nothing else ever set Visit.doctorId — so the review queue was always
// empty and "Approve & Complete" always failed.
router.post('/:id/approve', requireDoctor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const rawReview = req.body?.review;
    if (rawReview !== undefined && typeof rawReview !== 'string') {
      return res.status(400).json({ error: 'review must be a string' });
    }
    const review = rawReview?.trim() || 'Approved';
    if (review.length > 5000) return res.status(400).json({ error: 'review is too long' });

    const visit = await prisma.visit.findUnique({
      where: { id },
      include: { booking: { select: { patientId: true, patient: { select: { email: true, firstName: true, lastName: true } } } } },
    });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    if (visit.status !== VisitStatus.COMPLETED) {
      return res.status(409).json({ error: 'Only a completed visit can be approved' });
    }

    const isAdmin = req.user!.role === UserRole.ADMIN;
    // Claim-and-approve in one conditional write, so two doctors can't both
    // sign off the same visit and a visit already claimed by another doctor
    // can't be taken over (admins may approve any unreviewed visit).
    const { count } = await prisma.visit.updateMany({
      where: {
        id,
        status: VisitStatus.COMPLETED,
        doctorReview: null,
        ...(isAdmin ? {} : { OR: [{ doctorId: null }, { doctorId: req.user!.id }] }),
      },
      data: { doctorReview: review, ...(isAdmin ? {} : { doctorId: req.user!.id }) },
    });
    if (count === 0) {
      return res.status(409).json({ error: 'Visit has already been reviewed or is assigned to another doctor' });
    }

    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'Visit', resourceId: id, metadata: { action: 'DOCTOR_APPROVE', patientId: visit.booking.patientId }, ipAddress: req.ip, userAgent: req.get('User-Agent') });

    const patient = visit.booking.patient;
    if (patient?.email) {
      // Email is best-effort: the sign-off is already recorded.
      notifyVisitApproved({ to: patient.email, patientName: `${patient.firstName} ${patient.lastName}`, doctorReview: review })
        .catch((err) => console.warn('[visits] approval email failed:', (err as Error)?.message ?? err));
    }
    const updated = await prisma.visit.findUnique({ where: { id } });
    return res.json({ success: true, visit: updated });
  } catch (error) { return next(error); }
});

// Record a BP-calibration reading during a visit (Nurse only). Fills the
// gap identified 2026-09-24 (docs/ENGINEERING_PLAN.md #32): visitId on
// BiometricReading existed since AH-45.5a's follow-up (#26) as the link
// for exactly this, but nothing ever wrote to it. Deliberately does not
// use Visit.biometrics (the dead JSON field — see #26 for why) or a
// separate table; writes a normal BiometricReading, source "manual",
// deviceType "nurse_calibration" so it's distinguishable from an arbitrary
// self-reported entry without a parallel schema.
router.post('/:id/biometrics', requireNurse, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const visit = await prisma.visit.findUnique({
      where: { id },
      include: { booking: { select: { patientId: true } } },
    });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    if (visit.nurseId !== req.user!.id) return res.status(403).json({ error: 'Access denied' });
    if (visit.status !== VisitStatus.IN_PROGRESS) {
      return res.status(400).json({ error: 'Biometrics can only be recorded while the visit is in progress' });
    }

    const b = req.body ?? {};
    const systolic = Number(b.bloodPressureSystolic);
    const diastolic = Number(b.bloodPressureDiastolic);
    if (!Number.isFinite(systolic) || systolic < 60 || systolic > 300) {
      return res.status(400).json({ error: 'bloodPressureSystolic must be a number between 60 and 300' });
    }
    if (!Number.isFinite(diastolic) || diastolic < 30 || diastolic > 200) {
      return res.status(400).json({ error: 'bloodPressureDiastolic must be a number between 30 and 200' });
    }
    const optionalVital = (v: unknown, min: number, max: number): number | null => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= min && n <= max ? n : null;
    };

    const reading = await prisma.biometricReading.create({
      data: {
        userId: visit.booking.patientId,
        visitId: visit.id,
        source: 'manual',
        deviceType: 'nurse_calibration',
        bloodPressureSystolic: systolic,
        bloodPressureDiastolic: diastolic,
        heartRate: optionalVital(b.heartRate, 30, 250) ?? undefined,
        temperature: optionalVital(b.temperature, 30, 45) ?? undefined,
        oxygenSaturation: optionalVital(b.oxygenSaturation, 50, 100) ?? undefined,
      },
    });

    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'CREATE',
      resource: 'BiometricReading',
      resourceId: reading.id,
      metadata: { visitId: visit.id, patientId: visit.booking.patientId, deviceType: 'nurse_calibration' },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    return res.status(201).json({ success: true, reading });
  } catch (error) { return next(error); }
});

export default router;
