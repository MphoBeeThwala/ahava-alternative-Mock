import { NextFunction, Response, Router } from 'express';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest, authMiddleware, requireNurse } from '../middleware/auth';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import { safeDecrypt } from '../utils/encryption';
import prisma from '../lib/prisma';
import { isValidCoordinate, markNurseOffline } from '../services/websocket';

const router: Router = Router();

// Get nurse profile
router.get('/profile', requireNurse, async (req: AuthenticatedRequest, res, next) => {
  try {
    const nurse = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, isAvailable: true, lastKnownLat: true, lastKnownLng: true, sancId: true, sancVerificationStatus: true, sancCategory: true, createdAt: true }
    });
    if (!nurse) return res.status(404).json({ error: 'Nurse not found' });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'READ', resource: 'Nurse', resourceId: nurse.id, metadata: { fields: Object.keys(nurse) }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    return res.json({ success: true, nurse });
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
router.patch('/availability', requireNurse, updateAvailability);
router.post('/availability', requireNurse, updateAvailability);

// Get nurse visits
router.get('/visits', requireNurse, async (req: AuthenticatedRequest, res, next) => {
  try {
    const visits = await prisma.visit.findMany({
      where: { nurseId: req.user!.id },
      include: { booking: { select: { scheduledDate: true, amountInCents: true, encryptedAddress: true, patient: { select: { id: true, firstName: true, lastName: true, phone: true } } } } },
      orderBy: { scheduledStart: 'desc' }
    });
    await createAuditLog({ userId: req.user!.id, userRole: req.user!.role, action: 'LIST', resource: 'Nurse', metadata: { entity: 'Visit', count: visits.length }, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    // Found via a real user report, 2026-09-14: this query never selected
    // encryptedAddress at all, so the nurse assigned to go to a patient
    // could never actually see the visit address — the frontend always
    // showed its generic "Address on file" fallback text.
    const decryptedVisits = visits.map((visit) => {
      if (!visit.booking) return visit;
      const { encryptedAddress, ...bookingRest } = visit.booking;
      return { ...visit, booking: { ...bookingRest, address: safeDecrypt(encryptedAddress) } };
    });
    res.json({ success: true, visits: decryptedVisits });
  } catch (error) { next(error); }
});

export default router;
