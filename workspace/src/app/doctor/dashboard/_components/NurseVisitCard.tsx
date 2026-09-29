import { useState } from 'react';
import { Card } from '../../../../components/ui/Card';
import { StatusBadge } from '../../../../components/ui/StatusBadge';
import type { Visit } from '../../../../lib/api';

export function NurseVisitCard({
  visit,
  onApprove,
  onClaim,
}: {
  visit: Visit;
  onApprove: (visitId: string, review?: string) => Promise<void> | void;
  onClaim: (visitId: string) => Promise<void> | void;
}) {
  const [review, setReview] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const approve = async () => {
    setSubmitting(true);
    try {
      await onApprove(visit.id, review.trim() || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  // Unclaimed: date, age and sex only until a doctor takes the review, which
  // grants access to this one patient's record.
  if (visit.restricted) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[var(--foreground)]">
              Completed visit
              {visit.patientAge != null && <span className="font-normal text-[var(--muted)]"> · {visit.patientAge}y{visit.patientSex ? ` · ${visit.patientSex}` : ''}</span>}
            </h3>
            <p className="text-sm text-[var(--muted)]">{visit.booking?.scheduledDate ? new Date(visit.booking.scheduledDate).toLocaleString() : ''}</p>
          </div>
          {visit.restricted === 'NOT_CLAIMED' ? (
            <button
              onClick={async () => { setSubmitting(true); try { await onClaim(visit.id); } finally { setSubmitting(false); } }}
              disabled={submitting}
              className="rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: 'var(--role-doctor)' }}
            >
              {submitting ? 'Claiming…' : 'Claim for review'}
            </button>
          ) : (
            <span className="text-sm text-[var(--muted)]">Your access to this record has ended</span>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-xl font-bold text-[var(--foreground)]">
            {visit.booking?.patient?.firstName} {visit.booking?.patient?.lastName}
          </h3>
          <p className="text-sm text-[var(--muted)]">
            {visit.createdAt ? new Date(visit.createdAt).toLocaleString() : 'Date TBD'}
          </p>
          <p className="text-sm text-[var(--muted)] mt-1" style={{ wordBreak: 'break-word' }}>{visit.booking?.address ?? 'Address on file'}</p>
        </div>
        <StatusBadge variant={visit.triageLevel != null && visit.triageLevel <= 2 ? 'danger' : 'warning'}>
          {visit.triageLevel ? `Level ${visit.triageLevel}` : visit.status}
        </StatusBadge>
      </div>

      {visit.biometrics && (
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <div className="bg-slate-50 p-4 rounded-lg">
            <h4 className="font-semibold text-slate-800 mb-2">Biometric Readings</h4>
            <div className="text-sm text-slate-700 space-y-1">
              {visit.biometrics.heartRate && (
                <p>Heart Rate: {visit.biometrics.heartRate} bpm</p>
              )}
              {visit.biometrics.bloodPressure && (
                <p>BP: {visit.biometrics.bloodPressure.systolic}/{visit.biometrics.bloodPressure.diastolic}</p>
              )}
              {visit.biometrics.temperature && (
                <p>Temperature: {visit.biometrics.temperature}°C</p>
              )}
              {visit.biometrics.oxygenSaturation && (
                <p>SpO2: {visit.biometrics.oxygenSaturation}%</p>
              )}
            </div>
          </div>
          {visit.treatment && (
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
              <h4 className="font-semibold text-blue-800 mb-2">Treatment Plan</h4>
              <div className="text-sm text-blue-700">
                {visit.treatment.medications && visit.treatment.medications.length > 0 && (
                  <div className="mb-2">
                    <strong>Medications:</strong>
                    <ul className="list-disc list-inside">
                      {visit.treatment.medications.map((med, idx) => (
                        <li key={idx}>{med.name} - {med.dosage}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {visit.treatment.notes && (
                  <p><strong>Notes:</strong> {visit.treatment.notes}</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {visit.nurseReport && (
        <div className="bg-green-50 p-4 rounded-lg mb-6 border border-green-100">
          <h4 className="font-semibold text-green-800 mb-2">Nurse Report</h4>
          <p className="text-sm text-green-700">{visit.nurseReport}</p>
        </div>
      )}

      {/* "Request More Info" and "Escalate to ER" used to live here. They sent
          PENDING_REVIEW (not a visit status) and CANCELLED (meaningless on a
          visit the nurse already completed) to a nurse-only endpoint, so
          both always failed. Approval with an optional note is the review
          action the backend actually supports. */}
      <div className="border-t pt-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
        <textarea
          value={review}
          onChange={(e) => setReview(e.target.value)}
          placeholder="Review note for the patient (optional)"
          rows={2}
          maxLength={5000}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)' }}
        />
        <button
          onClick={approve}
          disabled={submitting}
          className="px-6 py-2 rounded-lg font-medium text-white transition disabled:opacity-60"
          style={{ backgroundColor: 'var(--success)' }}
        >
          {submitting ? 'Approving…' : 'Approve & Complete'}
        </button>
      </div>
    </Card>
  );
}
