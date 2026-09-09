import { useState, useMemo } from 'react';
import type { TriageCase } from '../../../../lib/api';
import { AcuityRow } from '../../../../components/ui/AcuityRow';
import { Icon } from '../../../../components/ui/Icon';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { triageLevelToAcuity, formatWaitingClock, ageFromDateOfBirth } from '../_lib';

type SortMode = 'urgency' | 'longest-wait' | 'mine';

export function Worklist({
  cases,
  selectedId,
  onSelect,
  currentDoctorId,
}: {
  cases: TriageCase[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  currentDoctorId: string | undefined;
}) {
  const [sortMode, setSortMode] = useState<SortMode>('urgency');

  const visible = useMemo(() => {
    const list = sortMode === 'mine' ? cases.filter((c) => c.doctorId === currentDoctorId) : cases;
    const sorted = [...list];
    if (sortMode === 'longest-wait') {
      sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else {
      // urgency (default) and mine both sort by clinical severity first, then oldest first
      sorted.sort((a, b) => {
        const levelA = a.finalTriageLevel ?? a.aiTriageLevel;
        const levelB = b.finalTriageLevel ?? b.aiTriageLevel;
        if (levelA !== levelB) return levelA - levelB;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
    }
    return sorted;
  }, [cases, sortMode, currentDoctorId]);

  return (
    <div className="flex h-full flex-col" style={{ width: 386, borderRight: '1px solid var(--border)' }}>
      <div className="flex shrink-0 gap-1 border-b border-[var(--border)] p-3">
        {([
          ['urgency', 'By urgency'],
          ['longest-wait', 'Longest wait'],
          ['mine', 'Mine'],
        ] as [SortMode, string][]).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => setSortMode(mode)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition"
            style={{
              background: sortMode === mode ? 'var(--primary)' : 'transparent',
              color: sortMode === mode ? 'white' : 'var(--muted)',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {visible.length === 0 ? (
          <EmptyState icon="check-circle" message="No cases in this view" />
        ) : (
          <div className="space-y-2">
            {visible.map((tc) => {
              const level = tc.finalTriageLevel ?? tc.aiTriageLevel;
              const age = ageFromDateOfBirth(tc.patient?.dateOfBirth);
              const sexInitial = tc.patient?.gender ? tc.patient.gender.charAt(0).toUpperCase() : null;
              return (
                <button
                  key={tc.id}
                  type="button"
                  onClick={() => onSelect(tc.id)}
                  className="block w-full text-left"
                  aria-current={selectedId === tc.id ? 'true' : undefined}
                >
                  <AcuityRow
                    level={triageLevelToAcuity(level)}
                    className={selectedId === tc.id ? 'ring-2' : ''}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                        {tc.patient?.firstName} {tc.patient?.lastName}
                        {age != null && <span className="font-normal text-[var(--muted)]"> · {age}{sexInitial ? ` · ${sexInitial}` : ''}</span>}
                      </p>
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--ink-3)]">
                        <Icon name="clock" size={12} /> {formatWaitingClock(tc.createdAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{tc.symptoms}</p>
                  </AcuityRow>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
