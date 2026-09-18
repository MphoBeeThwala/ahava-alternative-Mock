/**
 * useOfflineBiometricSync — replays biometric readings captured while
 * offline once the app is back online. Three behaviors matter clinically:
 * a stale reading (captured more than MAX_QUEUE_AGE_MS ago) must be
 * dropped rather than silently skewing a trend with an old value; a
 * genuine network failure mid-sync must leave the rest of the queue
 * intact for the next attempt, not lose readings; and a submission the
 * server outright rejects must be dropped (it will never succeed on
 * retry), not retried forever.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { useOfflineBiometricSync } from './useOfflineBiometricSync';
import { enqueueBiometricReading, MAX_QUEUE_AGE_MS } from '../lib/offlineBiometricQueue';
import type { BiometricReading } from '../lib/api/patient';

const submitBiometrics = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('../lib/api/patient', () => ({
  patientApi: {
    submitBiometrics: (...args: unknown[]) => submitBiometrics(...args),
  },
}));

vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}));

async function seedQueuedReading(userId: string, capturedAt: Date, heartRate: number) {
  const data: BiometricReading = { heartRate, source: 'manual' };
  const entry = await enqueueBiometricReading(userId, data);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('ahava-offline-queue', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('biometric-readings', 'readwrite');
    tx.objectStore('biometric-readings').put({ ...entry, capturedAt: capturedAt.toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return entry!.id;
}

beforeEach(() => {
  submitBiometrics.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

afterEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('useOfflineBiometricSync', () => {
  it('syncs a fresh queued reading and reports success', async () => {
    submitBiometrics.mockResolvedValue({ success: true });
    await seedQueuedReading('user-1', new Date(), 75);

    renderHook(() => useOfflineBiometricSync('user-1'));

    await waitFor(() => expect(submitBiometrics).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('Synced 1'));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('drops a reading older than MAX_QUEUE_AGE_MS without submitting it', async () => {
    const staleDate = new Date(Date.now() - MAX_QUEUE_AGE_MS - 60_000);
    await seedQueuedReading('user-2', staleDate, 80);

    renderHook(() => useOfflineBiometricSync('user-2'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('too old')));
    expect(submitBiometrics).not.toHaveBeenCalled();
  });

  it('stops on a network error and leaves the remaining queue intact', async () => {
    const networkError = { request: {}, response: undefined };
    submitBiometrics.mockRejectedValueOnce(networkError);
    await seedQueuedReading('user-3', new Date(), 60);
    await seedQueuedReading('user-3', new Date(), 61);

    renderHook(() => useOfflineBiometricSync('user-3'));

    await waitFor(() => expect(submitBiometrics).toHaveBeenCalledTimes(1));
    // Give any (incorrect) further processing a chance to happen before asserting it didn't.
    await new Promise((r) => setTimeout(r, 20));
    expect(submitBiometrics).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('drops a reading the server rejects outright, and continues with the rest', async () => {
    const serverError = { response: { status: 400, data: { error: 'invalid' } } };
    submitBiometrics.mockRejectedValueOnce(serverError).mockResolvedValueOnce({ success: true });
    await seedQueuedReading('user-4', new Date(), 90);
    await seedQueuedReading('user-4', new Date(), 91);

    renderHook(() => useOfflineBiometricSync('user-4'));

    // Both readings are attempted: the rejected one is dropped (never
    // retried — the server will reject it again), the next one still syncs.
    await waitFor(() => expect(submitBiometrics).toHaveBeenCalledTimes(2));
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('Synced 1'));
    // Note: the hook's dropped-count toast text always says "too old to
    // sync", even for a drop caused by an outright server rejection like
    // this one, not staleness — pre-existing message wording, not
    // something introduced or fixed here.
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('too old'));
  });

  it('does nothing when the device is offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await seedQueuedReading('user-5', new Date(), 70);

    renderHook(() => useOfflineBiometricSync('user-5'));

    await new Promise((r) => setTimeout(r, 20));
    expect(submitBiometrics).not.toHaveBeenCalled();
  });

  it('does nothing when there is no userId yet (not logged in)', async () => {
    renderHook(() => useOfflineBiometricSync(undefined));

    await new Promise((r) => setTimeout(r, 20));
    expect(submitBiometrics).not.toHaveBeenCalled();
  });
});
