/**
 * Offline biometric queue (IndexedDB-backed) — the mechanism that lets a
 * nurse or patient capture a reading with no connectivity (a real scenario
 * for home visits in low-signal areas) and have it replay once back
 * online, via useOfflineBiometricSync. fake-indexeddb (vitest.setup.ts)
 * polyfills a real IndexedDB in this jsdom environment, so this exercises
 * the actual open/put/getAll/delete transaction logic, not a mock of it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  enqueueBiometricReading,
  getQueuedReadings,
  removeQueuedReading,
} from './offlineBiometricQueue';
import type { BiometricReading } from './api/patient';

function sampleReading(overrides: Partial<BiometricReading> = {}): BiometricReading {
  return {
    heartRate: 72,
    source: 'manual',
    ...overrides,
  } as BiometricReading;
}

afterEach(() => {
  // Each test gets a clean database — otherwise entries from one test
  // (all sharing the fixed DB_NAME/STORE_NAME) would leak into the next.
  globalThis.indexedDB = new IDBFactory();
});

describe('offlineBiometricQueue', () => {
  it('enqueues a reading and returns it with a generated id and capturedAt', async () => {
    const entry = await enqueueBiometricReading('user-1', sampleReading());

    expect(entry).not.toBeNull();
    expect(entry!.id).toBeTruthy();
    expect(entry!.userId).toBe('user-1');
    expect(entry!.data.heartRate).toBe(72);
    expect(new Date(entry!.capturedAt).getTime()).not.toBeNaN();
  });

  it('returns a queued reading via getQueuedReadings for the same user', async () => {
    await enqueueBiometricReading('user-2', sampleReading({ heartRate: 80 }));

    const queued = await getQueuedReadings('user-2');

    expect(queued).toHaveLength(1);
    expect(queued[0].data.heartRate).toBe(80);
  });

  it('never returns another user\'s queued readings (shared-device safety)', async () => {
    await enqueueBiometricReading('alice', sampleReading({ heartRate: 60 }));
    await enqueueBiometricReading('bob', sampleReading({ heartRate: 200 }));

    const aliceQueue = await getQueuedReadings('alice');
    const bobQueue = await getQueuedReadings('bob');

    expect(aliceQueue).toHaveLength(1);
    expect(aliceQueue[0].data.heartRate).toBe(60);
    expect(bobQueue).toHaveLength(1);
    expect(bobQueue[0].data.heartRate).toBe(200);
  });

  it('returns queued readings sorted oldest-first by capturedAt', async () => {
    const first = await enqueueBiometricReading('user-3', sampleReading({ heartRate: 1 }));
    // Force a distinguishable capturedAt without relying on real timing.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ahava-offline-queue', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('biometric-readings', 'readwrite');
      tx.objectStore('biometric-readings').put({
        ...first,
        capturedAt: new Date(Date.now() - 60_000).toISOString(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await enqueueBiometricReading('user-3', sampleReading({ heartRate: 2 }));

    const queued = await getQueuedReadings('user-3');

    expect(queued.map((q) => q.data.heartRate)).toEqual([1, 2]);
  });

  it('removes a queued reading by id', async () => {
    const entry = await enqueueBiometricReading('user-4', sampleReading());

    await removeQueuedReading(entry!.id);

    const queued = await getQueuedReadings('user-4');
    expect(queued).toHaveLength(0);
  });

  it('removing a non-existent id is a no-op, not an error', async () => {
    await expect(removeQueuedReading('does-not-exist')).resolves.toBeUndefined();
  });
});
