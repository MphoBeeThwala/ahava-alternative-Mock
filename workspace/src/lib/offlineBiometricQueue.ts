import type { BiometricReading } from './api/patient';

const DB_NAME = 'ahava-offline-queue';
const DB_VERSION = 1;
const STORE_NAME = 'biometric-readings';

// Monitoring/alerting (apps/backend/src/services/monitoring.ts) assumes
// readings arrive close to real time — a reading queued longer than this is
// discarded on sync rather than silently skewing alertLevel/readiness trends
// with a stale value. See docs/ENGINEERING_PLAN.md Phase 7 gap report.
export const MAX_QUEUE_AGE_MS = 60 * 60 * 1000;

export interface QueuedBiometricReading {
  id: string; // also sent as the Idempotency-Key header on replay
  userId: string;
  data: BiometricReading;
  capturedAt: string; // ISO timestamp when the user submitted the form
}

function isSupported(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueBiometricReading(
  userId: string,
  data: BiometricReading
): Promise<QueuedBiometricReading | null> {
  if (!isSupported()) return null;
  const entry: QueuedBiometricReading = {
    id: generateId(),
    userId,
    data,
    capturedAt: new Date().toISOString(),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return entry;
}

// Scoped to the current user — on a shared browser, a reading queued while
// logged in as one patient must never be replayed under a different
// patient's session.
export async function getQueuedReadings(userId: string): Promise<QueuedBiometricReading[]> {
  if (!isSupported()) return [];
  const db = await openDb();
  const all = await new Promise<QueuedBiometricReading[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as QueuedBiometricReading[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return all
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export async function removeQueuedReading(id: string): Promise<void> {
  if (!isSupported()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
