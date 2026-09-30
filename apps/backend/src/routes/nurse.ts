import { NextFunction, Response, Router } from 'express';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware, invalidateCachedUser, requireNurse } from '../middleware/auth';
import { SancRegistrationBlockedError, submitSancNumber } from '../services/sancVerification';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import { safeDecrypt } from '../utils/encryption';
import prisma from '../lib/prisma';
import { isValidCoordinate, markNurseOffline } from '../services/websocket';
import { patientsWithActiveAccess, requireVerifiedClinician } from '../services/careAccess';
import { redactVisit } from '../services/visitProjection';

// Going online, and reading any visit, needs a verified SANC registration.
const requireVerifiedNurse = requireVerifiedClinician(['NURSE']);

const router: Router = Router();

// Get nurse profile
router.get('/profile', requireNurse, async (req: AuthenticatedRequest, res, next) => {
  try {
    const nurse = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, isAvailable: true, lastKnownLat: true, lastKnownLng: true, sancId: true, sancVerificationStatus: true, sancCategory: true, sancVerificationDate: true, createdAt: true }
    });
    if (!nurse) return res.status(404).json({ error: 'Nurse not found' });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'READ', resource: 'Nurse', resourceId: nurse.id, metadata: { fields: Object.keys(nurse) }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, nurse });
  } catch (error) { return next(error); }
});

// A nurse enters or changes their own SANC registration number. Allowed
// before they are verified (that's how they get verified). It is looked up
// in the imported register; if it isn't auto-verified, an admin checks it on
// SANC's register (PATCH /admin/users/:id/sanc). Changing a verified number
// makes them unverified again, so they are taken offline.
router.patch('/profile/sanc', requireNurse, async (req: AuthenticatedRequest, res, next) => {
  try {
    const raw = typeof req.body?.sancRegistrationNumber === 'string' ? req.body.sancRegistrationNumber.trim() : '';
    if (!/^[A-Za-z0-9/-]{4,40}$/.test(raw)) {
      return res.status(400).json({ error: 'Enter your SANC registration number (letters, digits, / or -).' });
    }
    const before = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { sancId: true, sancVerificationStatus: true } });

    let result: { status: string; changed: boolean };
    try {
      result = await submitSancNumber(req.user!.id, raw);
    } catch (err) {
      if (err instanceof SancRegistrationBlockedError) {
        return res.status(409).json({ error: 'This registration is flagged as suspended or cancelled. Contact an administrator.', code: 'SANC_BLOCKED' });
      }
      throw err;
    }
    if (result.changed && result.status !== 'Active') {
      await prisma.user.update({ where: { id: req.user!.id }, data: { isAvailable: false } });
      markNurseOffline(req.user!.id);
    }
    await invalidateCachedUser(req.user!.id);
    await createAuditLog({
      userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'ProfessionalRegistration', resourceId: req.user!.id,
      metadata: { body: 'SANC', event: 'NUMBER_SUBMITTED', number: raw.toUpperCase(), previousNumber: before?.sancId ?? null, previousStatus: before?.sancVerificationStatus ?? null, status: result.status },
      ipAddress: req.ip, userAgent: req.get('User-Agent'),
    });

    const nurse = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { sancId: true, sancVerificationStatus: true, sancCategory: true, sancVerificationDate: true } });
    return res.json({ success: true, sanc: nurse });
  } catch (error) { return next(error); }
});

// Update availability.
//
// The web client has been sending POST here while only PATCH was mounted,
// so "Go online" always fell through to the 404 handler ("Route not found").
// Both verbs are accepted: PATCH is the correct one, POST keeps any already
// shipped mobile (Capacitor) build working until it is updated.
const updateAvailability = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { isAvailable, lat, lng } = req.body ?? {};
    if (typeof isAvailable !== 'boolean') {
      return res.status(400).json({ error: 'isAvailable must be a boolean' });
    }
    const hasLocation = lat !== undefined || lng !== undefined;
    if (hasLocation && !isValidCoordinate(lat, lng)) {
      return res.status(400).json({ error: 'lat/lng must be valid coordinates' });
    }
    if (isAvailable && !hasLocation) {
      return res.status(400).json({ error: 'A location (lat, lng) is required to go online' });
    }

    const before = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isAvailable: true } });
    const nurse = await prisma.user.update({
      where: { id: req.user!.id },
      // Going offline without a location leaves the last known position
      // alone — the client used to send 0,0 here, which overwrote it with a
      // point in the Atlantic.
      data: hasLocation
        ? { isAvailable, lastKnownLat: lat, lastKnownLng: lng, lastLocationUpdate: new Date() }
        : { isAvailable },
      select: { id: true, isAvailable: true, lastKnownLat: true, lastKnownLng: true }
    });
    if (!isAvailable) markNurseOffline(nurse.id);
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'UPDATE', resource: 'Nurse', resourceId: nurse.id, metadata: { oldAvailability: before?.isAvailable ?? null, newAvailability: isAvailable, lat, lng }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, nurse });
  } catch (error) { return next(error); }
};
router.patch('/availability', requireVerifiedNurse, updateAvailability);
router.post('/availability', requireVerifiedNurse, updateAvailability);

// Get nurse visits
router.get('/visits', requireVerifiedNurse, async (req: AuthenticatedRequest, res, next) => {
  try {
    const visits = await prisma.visit.findMany({
      where: { nurseId: req.user!.id },
      include: { booking: { select: { patientId: true, scheduledDate: true, amountInCents: true, encryptedAddress: true, patient: { select: { id: true, firstName: true, lastName: true, phone: true } } } } },
      orderBy: { scheduledStart: 'desc' }
    });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'LIST', resource: 'Nurse', metadata: { entity: 'Visit', count: visits.length }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    // Found via a real user report, 2026-09-14: this query never selected
    // encryptedAddress at all, so the nurse assigned to go to a patient
    // could never actually see the visit address — the frontend always
    // showed its generic "Address on file" fallback text.
    // Past visits stay listed (history, earnings) but the patient's details
    // are only shown while the nurse still has care access.
    const allowed = await patientsWithActiveAccess(req.user!.id, visits.map((v) => v.booking.patientId));
    const decryptedVisits = visits.map((visit) => {
      if (!allowed.has(visit.booking.patientId)) return redactVisit(visit, 'ACCESS_EXPIRED');
      const { encryptedAddress, ...bookingRest } = visit.booking;
      return { ...visit, booking: { ...bookingRest, address: safeDecrypt(encryptedAddress) } };
    });
    res.json({ success: true, visits: decryptedVisits });
  } catch (error) { next(error); }
});

export default router;
