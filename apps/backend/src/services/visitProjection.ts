import { ageFrom, displayName } from './careAccess';

/**
 * What a visit looks like to someone who may know it exists but may not
 * (or no longer) see the patient's clinical record: a nurse after the
 * documentation window, an admin doing operations, a doctor browsing the
 * unclaimed review queue. Scheduling and status only — no address, contact
 * details, vitals, treatment, reports or messages.
 */
export function redactVisit(visit: any, reason: 'ACCESS_EXPIRED' | 'NOT_CLAIMED' | 'ADMIN_VIEW') {
  const booking = visit.booking ?? {};
  const patient = booking.patient ?? {};
  return {
    id: visit.id,
    bookingId: visit.bookingId,
    nurseId: visit.nurseId,
    doctorId: visit.doctorId ?? null,
    status: visit.status,
    scheduledStart: visit.scheduledStart,
    actualStart: visit.actualStart ?? null,
    actualEnd: visit.actualEnd ?? null,
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt,
    booking: {
      patientId: booking.patientId ?? patient.id,
      scheduledDate: booking.scheduledDate,
      amountInCents: booking.amountInCents,
      patient: { id: patient.id, firstName: displayName(patient.firstName, patient.lastName) },
    },
    // Enough for a doctor to prioritise an unclaimed review, nothing more.
    ...(reason === 'NOT_CLAIMED'
      ? { patientAge: ageFrom(patient.dateOfBirth), patientSex: patient.gender ? String(patient.gender).charAt(0).toUpperCase() : null }
      : {}),
    restricted: reason,
  };
}
