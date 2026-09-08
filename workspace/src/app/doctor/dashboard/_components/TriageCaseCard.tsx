import { Card } from '../../../../components/ui/Card';
import type { TriageCase } from '../../../../lib/api';
import { getUrgencyLevel, formatTimeAgo } from '../_lib';

export function TriageCaseCard({
  tc,
  releasing,
  onClaim,
  onOpenReview,
  onOpenFollowUp,
  onRelease,
  onOpenPrescription,
  onOpenReferral,
}: {
  tc: TriageCase;
  releasing: string | null;
  onClaim: (caseId: string) => void;
  onOpenReview: (tc: TriageCase) => void;
  onOpenFollowUp: (tc: TriageCase) => void;
  onRelease: (caseId: string) => void;
  onOpenPrescription: (tc: TriageCase) => void;
  onOpenReferral: (tc: TriageCase) => void;
}) {
  const { level, color, hoursAgo, label } = getUrgencyLevel(tc.createdAt);
  const provisionalImpression =
    (tc.aiPossibleConditions || []).find(Boolean) || 'No clear provisional impression';

  return (
    <Card style={{ borderLeft: `4px solid ${color}` }}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-xl font-bold text-[var(--foreground)]">
            {label} {tc.patient?.firstName} {tc.patient?.lastName}
          </h3>
          <p className="text-sm text-[var(--muted)]">
            {formatTimeAgo(hoursAgo)} • General
          </p>
        </div>
        <div style={{
          backgroundColor: color,
          color: 'white',
          padding: '8px 12px',
          borderRadius: '6px',
          fontWeight: 'bold'
        }}>
          {level}
        </div>
      </div>
      <p className="text-slate-700 mb-2"><strong>Symptoms:</strong> {tc.symptoms}</p>
      <p className="text-slate-700 text-sm mb-2"><strong>AI provisional impression:</strong> {provisionalImpression}</p>
      <p className="text-slate-600 text-sm mb-2"><strong>AI recommendation:</strong> {tc.aiRecommendedAction}</p>
      <p className="text-slate-500 text-sm mb-2"><strong>Possible conditions:</strong> {(tc.aiPossibleConditions || []).join(', ')}</p>
      <p className="text-slate-500 text-sm mb-2"><strong>AI reasoning:</strong> {tc.aiReasoning}</p>
      {tc.attachments && tc.attachments.length > 0 && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-sm font-semibold text-slate-800">Clinical attachments</p>
          <div className="flex flex-wrap gap-2">
            {tc.attachments.map((attachment) => (
              <a
                key={attachment.id}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-blue-400 hover:text-blue-700"
              >
                <span>{attachment.kind === 'symptom_image' ? '📸' : attachment.kind === 'lab_result' ? '🧪' : '📎'}</span>
                <span>{attachment.fileName}</span>
              </a>
            ))}
          </div>
        </div>
      )}
      {(tc.medicalPassport || tc.reviewSafety) && (
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-2 text-sm font-semibold text-slate-800">Medical passport</p>
            <div className="space-y-1 text-xs text-slate-600">
              <p><strong>Allergies:</strong> {tc.medicalPassport?.allergies?.length ? tc.medicalPassport.allergies.join(', ') : 'Not recorded'}</p>
              <p><strong>Current meds:</strong> {tc.medicalPassport?.currentMedications?.length ? tc.medicalPassport.currentMedications.join(', ') : 'Not recorded'}</p>
              <p><strong>Chronic conditions:</strong> {tc.medicalPassport?.chronicConditions?.length ? tc.medicalPassport.chronicConditions.join(', ') : 'Not recorded'}</p>
              <p><strong>Blood type:</strong> {tc.medicalPassport?.bloodType || 'Not recorded'}</p>
              <p><strong>Pregnancy:</strong> {tc.medicalPassport?.pregnancy === null || tc.medicalPassport?.pregnancy === undefined ? 'Not recorded' : tc.medicalPassport?.pregnancy ? 'Yes' : 'No'}</p>
            </div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="mb-2 text-sm font-semibold text-amber-900">Safety review</p>
            {tc.reviewSafety?.warnings?.length ? (
              <ul className="space-y-1 text-xs text-amber-800">
                {tc.reviewSafety.warnings.map((warning, idx) => (
                  <li key={idx}>• {warning}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-emerald-700">Medical-passport review checks are complete.</p>
            )}
            {!!tc.medicalPassport?.missingFields?.length && (
              <p className="mt-2 text-xs text-amber-700">
                Missing: {tc.medicalPassport.missingFields.join(', ')}
              </p>
            )}
          </div>
        </div>
      )}
      {tc.followUpRequestedAt && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
          <p className="font-semibold text-blue-900">
            {tc.status === 'AWAITING_PATIENT_RESPONSE' ? 'Awaiting patient response' : 'Most recent follow-up request'}
          </p>
          {tc.followUpRequestMessage && (
            <p className="mt-1 text-blue-800">{tc.followUpRequestMessage}</p>
          )}
          {!!tc.followUpQuestions?.length && (
            <p className="mt-2 text-xs text-blue-700">
              Questions: {tc.followUpQuestions.join(' | ')}
            </p>
          )}
          {!!tc.requestedInvestigations?.length && (
            <p className="mt-1 text-xs text-blue-700">
              Investigations: {tc.requestedInvestigations.join(' | ')}
            </p>
          )}
          {tc.patientFollowUpResponse && (
            <div className="mt-3 rounded-md bg-white p-3 text-slate-700">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Patient response</p>
              <p className="mt-1 text-sm">{tc.patientFollowUpResponse}</p>
            </div>
          )}
        </div>
      )}
      {tc.aiModel && (
        <p className="text-xs text-slate-400 mb-4">AI model: {tc.aiModel}</p>
      )}
      <div className="flex flex-wrap gap-3 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        {tc.status === 'PENDING_REVIEW' && (
          <button
            onClick={() => onClaim(tc.id)}
            className="px-4 py-2 rounded-lg font-medium text-white transition"
            style={{ backgroundColor: '#2196f3' }}
          >
            Claim case
          </button>
        )}
        {(tc.status === 'ASSIGNED' || tc.status === 'REVIEWED') && (
          <button
            onClick={() => onOpenReview(tc)}
            className="px-4 py-2 rounded-lg font-medium text-white transition"
            style={{ backgroundColor: '#ff9800' }}
          >
            ✎ Write review
          </button>
        )}
        {(tc.status === 'ASSIGNED' || tc.status === 'REVIEWED') && (
          <button
            onClick={() => onOpenFollowUp(tc)}
            className="px-4 py-2 rounded-lg font-medium text-white transition"
            style={{ backgroundColor: '#2563eb' }}
          >
            Request more info
          </button>
        )}
        {tc.status === 'REVIEWED' && (<>
          <button
            onClick={() => onRelease(tc.id)}
            disabled={releasing === tc.id}
            className="px-4 py-2 rounded-lg font-medium text-white transition disabled:opacity-60"
            style={{ backgroundColor: '#4caf50' }}
          >
            {releasing === tc.id ? 'Releasing…' : '✅ Release result'}
          </button>
          <button
            onClick={() => onOpenPrescription(tc)}
            className="px-4 py-2 rounded-lg font-medium text-white transition"
            style={{ backgroundColor: '#0d9488' }}
          >
            💊 Write prescription
          </button>
          <button
            onClick={() => onOpenReferral(tc)}
            className="px-4 py-2 rounded-lg font-medium text-white transition"
            style={{ backgroundColor: '#dc2626' }}
          >
            🚨 Emergency referral
          </button>
        </>)}
      </div>
    </Card>
  );
}
