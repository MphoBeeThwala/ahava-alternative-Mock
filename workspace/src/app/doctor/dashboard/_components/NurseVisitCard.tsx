import { Card } from '../../../../components/ui/Card';
import { StatusBadge } from '../../../../components/ui/StatusBadge';
import type { Visit } from '../../../../lib/api';

export function NurseVisitCard({
  visit,
  onApprove,
  onStatusUpdate,
}: {
  visit: Visit;
  onApprove: (visitId: string) => void;
  onStatusUpdate: (visitId: string, status: string) => void;
}) {
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
          <p className="text-sm text-[var(--muted)] mt-1">{visit.booking?.encryptedAddress ?? 'Address on file'}</p>
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

      <div className="flex gap-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => onApprove(visit.id)}
          className="px-6 py-2 rounded-lg font-medium text-white transition"
          style={{ backgroundColor: 'var(--success)' }}
        >
          Approve & Complete
        </button>
        <button
          onClick={() => onStatusUpdate(visit.id, 'PENDING_REVIEW')}
          className="px-6 py-2 rounded-lg border font-semibold transition bg-[var(--card)] hover:bg-slate-50"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
        >
          Request More Info
        </button>
        <button
          onClick={() => onStatusUpdate(visit.id, 'CANCELLED')}
          className="px-6 py-2 rounded-lg border font-medium transition ml-auto hover:bg-red-50"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
        >
          Escalate to ER
        </button>
      </div>
    </Card>
  );
}
