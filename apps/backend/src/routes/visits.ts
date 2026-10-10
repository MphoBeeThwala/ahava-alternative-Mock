import { Router } from 'express';
import { AccessGrantReason, UserRole, VisitStatus } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware, requireRole } from '../middleware/auth';
import {
  ACCESS_WINDOWS, NO_ACCESS_ERROR, auditAccessDenied, checkVerifiedClinician, closeSourceGrants, grantAccess,
  hasActiveAccess, hoursFromNow, isClinicianRole, patientsWithActiveAccess, requireVerifiedClinician, syncVisitGrant,
} from '../services/careAccess';
import { redactVisit } from '../services/visitProjection';
import { notifyVisitApproved } from '../services/notifications';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import { decryptPatientLocation, safeDecrypt } from '../utils/encryption';
import { broadcastToUsers } from '../services/websocket';
import { ARRIVAL_OVERRIDE_REASONS, evaluateArrival, isVisitStatus, visitTimingFor, visitTransitionError } from '../services/visitStatus';
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

const requireVerifiedDoctor = requireVerifiedClinician(['DOCTOR']);
const requireVerifiedNurse = requireVerifiedClinician(['NURSE']);

const visitListInclude = {
  booking: { select: { patientId: true, encryptedAddress: true, scheduledDate: true, amountInCents: true, patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true, gender: true } } } },
  nurse: { select: { id: true, firstName: true, lastName: true } },
} as const;

/** Full record, minus identifiers the caller doesn't need. */
function fullVisit<T extends { booking?: { encryptedAddress?: string; patient?: any } | null }>(visit: T) {
  const out: any = withDecryptedBookingAddress(visit);
  if (out.booking?.patient) {
    const { dateOfBirth: _dob, gender: _g, ...patient } = out.booking.patient;
    out.booking = { ...out.booking, patient };
  }
  return out;
}

// Get visits for user.
//
// Patients see their own visits in full. A verified nurse or doctor sees
// the visits they're assigned to, but the patient's details only while
// they hold care access to that patient (services/careAccess.ts); older
// ones stay listed with scheduling and status only. Admins get the
// operational view (status, dates), never clinical content.
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const where: any = {};
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
    const role = req.user!.role;
    const me = req.user!.id;
    if (isClinicianRole(role)) {
      const check = await checkVerifiedClinician(me);
      if (!check.ok) return res.status(check.status).json({ error: check.error, code: check.code });
    }

    const reviewQueue = statusFilter === PENDING_REVIEW && role === UserRole.DOCTOR;
    if (reviewQueue) {
      // The doctor dashboard's nurse-visit review queue. There is no
      // PENDING_REVIEW visit status: a visit awaits review once the nurse
      // has completed it and no doctor has signed it off yet. Unclaimed ones
      // show only what's needed to pick one up; claiming (POST
      // /:id/claim-review) grants access to that patient's record.
      where.status = VisitStatus.COMPLETED;
      where.doctorReview = null;
      where.OR = [{ doctorId: null }, { doctorId: me }];
    } else {
      if (role === UserRole.PATIENT) where.booking = { patientId: me };
      else if (role === UserRole.NURSE) where.nurseId = me;
      else if (role === UserRole.DOCTOR) where.doctorId = me;
      if (statusFilter !== undefined) {
        if (!isVisitStatus(statusFilter)) return res.status(400).json({ error: 'Invalid visit status filter' });
        where.status = statusFilter;
      }
    }
    const visits = await prisma.visit.findMany({ where, include: visitListInclude, orderBy: { createdAt: 'desc' } });

    let result: any[];
    if (role === UserRole.PATIENT) {
      result = visits.map(fullVisit);
    } else if (role === UserRole.ADMIN) {
      result = visits.map((v) => redactVisit(v, 'ADMIN_VIEW'));
    } else {
      const allowed = await patientsWithActiveAccess(me, visits.map((v) => v.booking.patientId));
      result = visits.map((v) => {
        if (reviewQueue && v.doctorId !== me) return redactVisit(v, 'NOT_CLAIMED');
        return allowed.has(v.booking.patientId) ? fullVisit(v) : redactVisit(v, 'ACCESS_EXPIRED');
      });
    }
    await createAuditLog({ userId: me, userRole: role, action: 'LIST', resource: 'Visit', metadata: { count: visits.length, role, fullRecords: result.filter((v) => !v.restricted).length }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, visits: result });
  } catch (error) { return next(error); }
});

// Get specific visit
router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const me = req.user!.id;
    const role = req.user!.role;
    const visit = await prisma.visit.findUnique({ where: { id }, include: { booking: { select: { patientId: true, encryptedAddress: true, scheduledDate: true, amountInCents: true, patient: { select: { id: true, firstName: true, lastName: true } } } }, nurse: { select: { id: true, firstName: true, lastName: true } }, doctor: { select: { id: true, firstName: true, lastName: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 10 } } });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });

    if (role === UserRole.ADMIN) {
      await createAuditLog({ userId: me, userRole: role, action: 'READ', resource: 'Visit', resourceId: visit.id, metadata: { view: 'ADMIN_VIEW', status: visit.status }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
      return res.json({ success: true, visit: redactVisit(visit, 'ADMIN_VIEW') });
    }
    const isPatient = visit.booking.patientId === me;
    if (!isPatient) {
      const isAssigned = visit.nurseId === me || visit.doctorId === me;
      if (!isClinicianRole(role) || !isAssigned) return res.status(403).json({ error: 'Access denied' });
      const check = await checkVerifiedClinician(me);
      if (!check.ok) return res.status(check.status).json({ error: check.error, code: check.code });
      if (!(await hasActiveAccess(me, visit.booking.patientId))) {
        await auditAccessDenied(req, 'Visit', visit.id, visit.booking.patientId);
        return res.status(403).json(NO_ACCESS_ERROR);
      }
    }
    await createAuditLog({ userId: me, userRole: role, action: 'READ', resource: 'Visit', resourceId: visit.id, metadata: { patientId: visit.booking.patientId, nurseId: visit.nurseId, status: visit.status }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, visit: fullVisit(visit) });
  } catch (error) { return next(error); }
});

// Update visit status: the assigned nurse or doctor while they hold care
// access, or an admin correcting a stuck visit (status only — the admin
// response carries no clinical content).
router.patch('/:id/status', requireRole([UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN]), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body ?? {};
    if (!isVisitStatus(status)) return res.status(400).json({ error: 'Invalid visit status' });
    const visit = await prisma.visit.findUnique({ where: { id }, include: { booking: { select: { patientId: true, encryptedPatientLocation: true } } } });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    const isAdmin = req.user!.role === UserRole.ADMIN;
    if (!isAdmin) {
      const isAssigned = visit.nurseId === req.user!.id || visit.doctorId === req.user!.id;
      if (!isAssigned) return res.status(403).json({ error: 'Access denied' });
      const check = await checkVerifiedClinician(req.user!.id);
      if (!check.ok) return res.status(check.status).json({ error: check.error, code: check.code });
      if (!(await hasActiveAccess(req.user!.id, visit.booking.patientId))) {
        await auditAccessDenied(req, 'Visit', visit.id, visit.booking.patientId);
        return res.status(403).json(NO_ACCESS_ERROR);
      }
    }
    const transitionError = visitTransitionError(visit.status, status, isAdmin);
    if (transitionError) return res.status(409).json({ error: transitionError });
    // "Arrived" is checked against the booking's own location. Soft: a nurse
    // who isn't there may still continue, but must give a reason, and the
    // distance and reason are audited. Admins correcting a visit are exempt.
    let arrivalAudit: Record<string, unknown> | undefined;
    if (status === VisitStatus.ARRIVED && !isAdmin && visit.nurseId === req.user!.id) {
      const decision = evaluateArrival({
        target: decryptPatientLocation(visit.booking.encryptedPatientLocation),
        nurse: { lat: req.body?.lat, lng: req.body?.lng },
        reason: req.body?.arrivalReason,
      });
      if (!decision.allowed) {
        return res.status(409).json({
          error: decision.message, code: decision.code, distanceMeters: decision.distanceMeters, reasons: ARRIVAL_OVERRIDE_REASONS,
        });
      }
      arrivalAudit = { verified: decision.verified, distanceMeters: decision.distanceMeters, overrideReason: decision.overrideReason ?? null, note: decision.note ?? null };
    }
    // Conditional on the status we just read, so a double-tapped button (or
    // two devices) can't advance the same visit twice.
    const { count } = await prisma.visit.updateMany({ where: { id, status: visit.status }, data: { status, ...visitTimingFor(status) } });
    if (count === 0) return res.status(409).json({ error: 'Visit status changed in the meantime; refresh and try again' });
    await syncVisitGrant(visit, status);
    const updated = await prisma.visit.findUnique({ where: { id } });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'Visit', resourceId: id, metadata: { oldStatus: visit.status, newStatus: status, ...(arrivalAudit ? { arrival: arrivalAudit } : {}) }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    // The nurse dashboard changes status over REST, not the WebSocket, so
    // without this the patient's live visit tracker never heard about it.
    const recipients = [visit.booking.patientId];
    if (visit.doctorId) recipients.push(visit.doctorId);
    broadcastToUsers(recipients, { type: 'VISIT_STATUS_CHANGED', data: { visitId: id, status, timestamp: new Date().toISOString() } });
    return res.json({ success: true, visit: isAdmin ? { id, status: updated!.status } : updated });
  } catch (error) { return next(error); }
});

// The patient closes out a visit the nurse has finished: confirms it ended and
// may leave a 1-5 rating. Once only. Anyone else (including other patients)
// gets 404, so a visit id can't be probed.
router.post('/:id/confirm', requireRole([UserRole.PATIENT]), async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const rating = req.body?.rating;
    if (rating !== undefined && rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
      return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5' });
    }
    const visit = await prisma.visit.findUnique({ where: { id }, include: { booking: { select: { patientId: true } } } });
    if (!visit || visit.booking.patientId !== req.user!.id) return res.status(404).json({ error: 'Visit not found' });
    if (visit.status !== VisitStatus.COMPLETED) return res.status(409).json({ error: 'The visit has not been finished yet' });
    // Conditional on not yet confirmed, so a double tap can't overwrite the rating.
    const { count } = await prisma.visit.updateMany({
      where: { id, patientConfirmedAt: null },
      data: { patientConfirmedAt: new Date(), patientRating: rating ?? null },
    });
    if (count === 0) return res.status(409).json({ error: 'This visit has already been confirmed' });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'Visit', resourceId: id, metadata: { patientConfirmed: true, rated: rating != null }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true });
  } catch (error) { return next(error); }
});

// A doctor takes on review of a completed nurse visit. Assigns the visit
// and grants time-bound access to that one patient's record.
router.post('/:id/claim-review', requireVerifiedDoctor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const me = req.user!.id;
    const visit = await prisma.visit.findUnique({ where: { id }, include: { booking: { select: { patientId: true } } } });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    if (visit.status !== VisitStatus.COMPLETED || visit.doctorReview !== null) {
      return res.status(409).json({ error: 'This visit is not awaiting review' });
    }
    if (visit.doctorId !== me) {
      const { count } = await prisma.visit.updateMany({
        where: { id, status: VisitStatus.COMPLETED, doctorReview: null, doctorId: null },
        data: { doctorId: me },
      });
      if (count === 0) return res.status(409).json({ error: 'Another doctor has already taken this review' });
    }
    await grantAccess({
      clinicianId: me,
      patientId: visit.booking.patientId,
      reason: AccessGrantReason.VISIT_REVIEW,
      sourceId: id,
      expiresAt: hoursFromNow(ACCESS_WINDOWS.visitReviewHours),
    });
    await createAuditLog({ userId: me, userRole: req.user!.role, action: 'UPDATE', resource: 'Visit', resourceId: id, metadata: { action: 'CLAIM_REVIEW', patientId: visit.booking.patientId }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    const full = await prisma.visit.findUnique({ where: { id }, include: visitListInclude });
    return res.json({ success: true, visit: fullVisit(full!) });
  } catch (error) { return next(error); }
});

// Doctor sign-off on a completed nurse visit the doctor has claimed
// (POST /:id/claim-review). Emails the patient; access then winds down to
// the documentation window.
router.post('/:id/approve', requireVerifiedDoctor, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const me = req.user!.id;
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
    if (visit.doctorId !== me) {
      return res.status(409).json({ error: 'Claim this visit for review before approving it' });
    }
    if (!(await hasActiveAccess(me, visit.booking.patientId))) {
      await auditAccessDenied(req, 'Visit', visit.id, visit.booking.patientId);
      return res.status(403).json(NO_ACCESS_ERROR);
    }

    // Conditional, so a double submit can't overwrite the first review.
    const { count } = await prisma.visit.updateMany({
      where: { id, status: VisitStatus.COMPLETED, doctorReview: null, doctorId: me },
      data: { doctorReview: review },
    });
    if (count === 0) return res.status(409).json({ error: 'Visit has already been reviewed' });
    await closeSourceGrants(id, me, hoursFromNow(ACCESS_WINDOWS.documentationHours));

    await createAuditLog({ userId: me, userRole: req.user!.role, action: 'UPDATE', resource: 'Visit', resourceId: id, metadata: { action: 'DOCTOR_APPROVE', patientId: visit.booking.patientId }, ipAddress: req.ip, userAgent: req.get('User-Agent') });

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
router.post('/:id/biometrics', requireVerifiedNurse, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const visit = await prisma.visit.findUnique({
      where: { id },
      include: { booking: { select: { patientId: true } } },
    });
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    if (visit.nurseId !== req.user!.id) return res.status(403).json({ error: 'Access denied' });
    if (!(await hasActiveAccess(req.user!.id, visit.booking.patientId))) {
      await auditAccessDenied(req, 'Visit', visit.id, visit.booking.patientId);
      return res.status(403).json(NO_ACCESS_ERROR);
    }
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
