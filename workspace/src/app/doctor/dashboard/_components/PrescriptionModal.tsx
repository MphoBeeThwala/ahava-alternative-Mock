import { Modal } from '../../../../components/ui/Modal';
import type { PrescriptionModalState } from '../_lib';
import { blankMed } from '../_lib';

export function PrescriptionModal({
  state,
  onChange,
  onClose,
  onSubmit,
  submitting,
}: {
  state: PrescriptionModalState | null;
  onChange: (next: PrescriptionModalState) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <Modal
      open={!!state}
      onClose={onClose}
      title="💊 Write Prescription"
      primaryLabel={submitting ? 'Issuing…' : 'Issue prescription'}
      onPrimary={onSubmit}
      primaryDisabled={submitting}
      secondaryLabel="Cancel"
      onSecondary={onClose}
    >
      <div className="space-y-4">
        <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-3">
          ⚠️ Your HPCSA practice number will be printed on this script. Ensure it is set in your profile before issuing.
        </p>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Diagnosis <span className="text-red-500">*</span></label>
          <input type="text" className="w-full rounded-lg border px-4 py-2.5" style={{ borderColor: 'var(--border)' }}
            value={state?.diagnosis ?? ''}
            onChange={e => state && onChange({ ...state, diagnosis: e.target.value })}
            placeholder="Clinical diagnosis"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-[var(--foreground)]">Medications <span className="text-red-500">*</span></label>
            <button type="button" className="text-xs text-teal-600 font-semibold"
              onClick={() => state && onChange({ ...state, medications: [...state.medications, blankMed()] })}>
              + Add medication
            </button>
          </div>
          {state?.medications.map((med, i) => (
            <div key={i} className="border rounded-lg p-3 mb-2 space-y-2" style={{ borderColor: 'var(--border)' }}>
              <div className="flex gap-2">
                <input placeholder="Drug name *" className="flex-1 rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}
                  value={med.name}
                  onChange={e => { const m = [...state.medications]; m[i] = { ...m[i], name: e.target.value }; onChange({ ...state, medications: m }); }}
                />
                <input placeholder="Dosage *" className="w-28 rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}
                  value={med.dosage}
                  onChange={e => { const m = [...state.medications]; m[i] = { ...m[i], dosage: e.target.value }; onChange({ ...state, medications: m }); }}
                />
                {state.medications.length > 1 && (
                  <button type="button" className="text-red-400 text-xs px-2"
                    onClick={() => { const m = state.medications.filter((_, idx) => idx !== i); onChange({ ...state, medications: m }); }}>✕</button>
                )}
              </div>
              <div className="flex gap-2">
                <input placeholder="Frequency (e.g. 3x daily)" className="flex-1 rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}
                  value={med.frequency}
                  onChange={e => { const m = [...state.medications]; m[i] = { ...m[i], frequency: e.target.value }; onChange({ ...state, medications: m }); }}
                />
                <input placeholder="Duration (e.g. 5 days)" className="flex-1 rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}
                  value={med.duration}
                  onChange={e => { const m = [...state.medications]; m[i] = { ...m[i], duration: e.target.value }; onChange({ ...state, medications: m }); }}
                />
              </div>
              <input placeholder="Special instructions (optional)" className="w-full rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}
                value={med.instructions}
                onChange={e => { const m = [...state.medications]; m[i] = { ...m[i], instructions: e.target.value }; onChange({ ...state, medications: m }); }}
              />
            </div>
          ))}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Additional notes</label>
          <textarea rows={2} className="w-full rounded-lg border px-4 py-2.5 text-sm" style={{ borderColor: 'var(--border)' }}
            value={state?.doctorNotes ?? ''}
            onChange={e => state && onChange({ ...state, doctorNotes: e.target.value })}
            placeholder="Dietary advice, follow-up instructions, etc."
          />
        </div>
        <p className="text-xs text-[var(--muted)]">The patient will receive a real-time notification and a downloadable PDF prescription. Valid for 30 days from issue (Schedule 0–4).</p>
      </div>
    </Modal>
  );
}
