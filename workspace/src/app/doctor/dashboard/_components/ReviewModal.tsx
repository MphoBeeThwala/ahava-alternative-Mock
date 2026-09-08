import { Modal } from '../../../../components/ui/Modal';
import type { ReviewModalState } from '../_lib';

export function ReviewModal({
  state,
  onChange,
  onClose,
  onSubmit,
}: {
  state: ReviewModalState | null;
  onChange: (next: ReviewModalState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal
      open={!!state}
      onClose={onClose}
      title="Doctor review"
      primaryLabel="Save review"
      onPrimary={onSubmit}
      primaryDisabled={!state?.doctorNotes?.trim() || !state?.doctorDiagnosis?.trim()}
      secondaryLabel="Cancel"
      onSecondary={onClose}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Clinical notes <span className="text-red-500">*</span></label>
          <textarea
            placeholder="Clinical observations and reasoning"
            className="w-full rounded-lg border px-4 py-2.5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2"
            style={{ borderColor: 'var(--border)' }}
            rows={3}
            value={state?.doctorNotes ?? ''}
            onChange={(e) => state && onChange({ ...state, doctorNotes: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Diagnosis <span className="text-red-500">*</span></label>
          <input
            type="text"
            placeholder="Your clinical diagnosis"
            className="w-full rounded-lg border px-4 py-2.5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2"
            style={{ borderColor: 'var(--border)' }}
            value={state?.doctorDiagnosis ?? ''}
            onChange={(e) => state && onChange({ ...state, doctorDiagnosis: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Recommendations to patient</label>
          <textarea
            placeholder="What should the patient do next?"
            className="w-full rounded-lg border px-4 py-2.5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2"
            style={{ borderColor: 'var(--border)' }}
            rows={2}
            value={state?.doctorRecommendations ?? ''}
            onChange={(e) => state && onChange({ ...state, doctorRecommendations: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Final SATS level (AI suggested: {state?.aiTriageLevel})</label>
          <select
            className="w-full rounded-lg border px-4 py-2.5 text-[var(--foreground)] focus:outline-none focus:ring-2"
            style={{ borderColor: 'var(--border)' }}
            value={state?.finalTriageLevel ?? state?.aiTriageLevel ?? ''}
            onChange={(e) => state && onChange({ ...state, finalTriageLevel: parseInt(e.target.value) })}
          >
            <option value={1}>1 — Resuscitation (Red)</option>
            <option value={2}>2 — Emergency (Orange)</option>
            <option value={3}>3 — Urgent (Yellow)</option>
            <option value={4}>4 — Less-Urgent (Green)</option>
            <option value={5}>5 — Non-Urgent (Blue)</option>
          </select>
        </div>
        {state && state.finalTriageLevel !== state.aiTriageLevel && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Override reason <span className="text-red-500">*</span></label>
            <input
              type="text"
              placeholder="Why are you changing the AI triage level?"
              className="w-full rounded-lg border px-4 py-2.5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2"
              style={{ borderColor: 'var(--border)' }}
              value={state?.overrideReason ?? ''}
              onChange={(e) => state && onChange({ ...state, overrideReason: e.target.value })}
            />
          </div>
        )}
        <p className="text-xs text-[var(--muted)] pt-2">After saving, click <strong>Release to patient</strong> on the case card to deliver the result in real time.</p>
      </div>
    </Modal>
  );
}
