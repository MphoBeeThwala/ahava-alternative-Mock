import { Modal } from '../../../../components/ui/Modal';
import type { FollowUpModalState } from '../_lib';

export function FollowUpRequestModal({
  state,
  onChange,
  onClose,
  onSubmit,
  submitting,
}: {
  state: FollowUpModalState | null;
  onChange: (next: FollowUpModalState) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <Modal
      open={!!state}
      onClose={onClose}
      title="Request more information"
      primaryLabel={submitting ? 'Sending…' : 'Send request'}
      onPrimary={onSubmit}
      primaryDisabled={submitting}
      secondaryLabel="Cancel"
      onSecondary={onClose}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Request type</label>
          <select
            className="w-full rounded-lg border px-4 py-2.5 text-sm"
            style={{ borderColor: 'var(--border)' }}
            value={state?.requestType ?? 'MORE_INFO'}
            onChange={(e) => state && onChange({ ...state, requestType: e.target.value as 'MORE_INFO' | 'INVESTIGATION' })}
          >
            <option value="MORE_INFO">More information</option>
            <option value="INVESTIGATION">Investigation / results request</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Patient-facing message</label>
          <textarea
            rows={3}
            className="w-full rounded-lg border px-4 py-2.5 text-sm"
            style={{ borderColor: 'var(--border)' }}
            value={state?.message ?? ''}
            onChange={(e) => state && onChange({ ...state, message: e.target.value })}
            placeholder="Explain what you still need from the patient."
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Questions</label>
          <textarea
            rows={4}
            className="w-full rounded-lg border px-4 py-2.5 text-sm"
            style={{ borderColor: 'var(--border)' }}
            value={state?.questionsText ?? ''}
            onChange={(e) => state && onChange({ ...state, questionsText: e.target.value })}
            placeholder={"One question per line\nHow long have you had the fever?\nHave you started any new medication?"}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Requested investigations</label>
          <textarea
            rows={4}
            className="w-full rounded-lg border px-4 py-2.5 text-sm"
            style={{ borderColor: 'var(--border)' }}
            value={state?.investigationsText ?? ''}
            onChange={(e) => state && onChange({ ...state, investigationsText: e.target.value })}
            placeholder={"One item per line\nUpload latest glucose log\nAttach chest X-ray report"}
          />
        </div>
      </div>
    </Modal>
  );
}
