"use client";

import { useCallback, useEffect, useRef } from 'react';
import { useToast } from '../contexts/ToastContext';
import { patientApi } from '../lib/api/patient';
import {
  MAX_QUEUE_AGE_MS,
  getQueuedReadings,
  removeQueuedReading,
} from '../lib/offlineBiometricQueue';

function isNetworkError(error: unknown): boolean {
  const e = error as { response?: unknown; request?: unknown };
  return Boolean(e?.request) && !e?.response;
}

// Replays biometric readings queued while offline (see
// lib/offlineBiometricQueue.ts). Safe because /patient/biometrics honors an
// Idempotency-Key header (apps/backend/src/middleware/idempotency.ts) — a
// retried submission with the same key can never double-write. Triage and
// prescription submissions have no such guarantee and are never queued.
export function useOfflineBiometricSync(userId: string | undefined, onSynced?: () => void) {
  const toast = useToast();
  const syncing = useRef(false);

  const sync = useCallback(async () => {
    if (!userId || syncing.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    syncing.current = true;
    try {
      const queued = await getQueuedReadings(userId);
      if (queued.length === 0) return;

      let syncedCount = 0;
      let droppedCount = 0;

      for (const entry of queued) {
        const age = Date.now() - new Date(entry.capturedAt).getTime();
        if (age > MAX_QUEUE_AGE_MS) {
          await removeQueuedReading(entry.id);
          droppedCount += 1;
          continue;
        }
        try {
          await patientApi.submitBiometrics(entry.data, entry.id);
          await removeQueuedReading(entry.id);
          syncedCount += 1;
        } catch (error) {
          if (isNetworkError(error)) {
            // Still offline/flaky — stop here, leave the rest queued for next attempt.
            break;
          }
          // Server rejected it outright — it will never succeed on retry.
          await removeQueuedReading(entry.id);
          droppedCount += 1;
        }
      }

      if (syncedCount > 0) {
        toast.success(`Synced ${syncedCount} offline reading${syncedCount > 1 ? 's' : ''}.`);
        onSynced?.();
      }
      if (droppedCount > 0) {
        toast.error(
          droppedCount > 1
            ? `${droppedCount} offline readings were too old to sync and were discarded.`
            : `1 offline reading was too old to sync and was discarded.`
        );
      }
    } finally {
      syncing.current = false;
    }
  }, [userId, toast, onSynced]);

  useEffect(() => {
    sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [sync]);
}
