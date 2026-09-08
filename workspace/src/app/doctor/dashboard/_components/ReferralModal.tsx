import { Modal } from '../../../../components/ui/Modal';
import type { ReferralModalState } from '../_lib';

export function ReferralModal({
  state,
  onChange,
  onClose,
  onSubmit,
  submitting,
}: {
  state: ReferralModalState | null;
  onChange: (next: ReferralModalState) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <Modal
      open={!!state}
      onClose={onClose}
      title="🚨 Emergency Referral"
      primaryLabel={submitting ? 'Issuing…' : 'Issue referral'}
      onPrimary={onSubmit}
      primaryDisabled={submitting}
      secondaryLabel="Cancel"
      onSecondary={onClose}
    >
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm font-semibold text-red-700">⚠️ Emergency referral</p>
          <p className="text-xs text-red-600 mt-1">The patient will receive an immediate alert with SA emergency numbers (10177 / 112) and a downloadable referral letter they can present at any facility — even without platform access.</p>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Referral type</label>
            <select className="w-full rounded-lg border px-4 py-2.5 text-sm" style={{ borderColor: 'var(--border)' }}
              value={state?.referralType ?? 'EMERGENCY'}
              onChange={e => state && onChange({ ...state, referralType: e.target.value })}>
              <option value="EMERGENCY">🔴 Emergency</option>
              <option value="URGENT">🟠 Urgent</option>
              <option value="SPECIALIST">🔵 Specialist</option>
              <option value="ROUTINE">🟢 Routine</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Recommended facility</label>
            <select className="w-full rounded-lg border px-4 py-2.5 text-sm" style={{ borderColor: 'var(--border)' }}
              value={state?.recommendedFacility ?? 'HOSPITAL'}
              onChange={e => state && onChange({ ...state, recommendedFacility: e.target.value })}>
              <option value="HOSPITAL">Hospital (Emergency)</option>
              <option value="CLINIC">Clinic / CHC</option>
              <option value="SPECIALIST">Specialist rooms</option>
              <option value="EMS">EMS / Ambulance</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Provisional diagnosis <span className="text-red-500">*</span></label>
          <input type="text" className="w-full rounded-lg border px-4 py-2.5" style={{ borderColor: 'var(--border)' }}
            value={state?.provisionalDiagnosis ?? ''}
            onChange={e => state && onChange({ ...state, provisionalDiagnosis: e.target.value })}
            placeholder="e.g. Suspected bacterial meningitis"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Clinical assessment / referral notes <span className="text-red-500">*</span></label>
          <textarea rows={5} className="w-full rounded-lg border px-4 py-2.5 text-sm" style={{ borderColor: 'var(--border)' }}
            value={state?.clinicalNotes ?? ''}
            onChange={e => state && onChange({ ...state, clinicalNotes: e.target.value })}
            placeholder="Describe the patient's presentation, vitals, AI assessment findings, and your clinical reasoning for this referral. This text appears verbatim on the referral letter."
          />
        </div>
        <p className="text-xs text-[var(--muted)]">Your HPCSA practice number will be printed on the referral. The letter is legally valid under the National Health Act 61 of 2003.</p>
      </div>
    </Modal>
  );
}
