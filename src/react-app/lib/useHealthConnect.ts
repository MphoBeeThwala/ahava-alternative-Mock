/**
 * useHealthConnect.ts
 *
 * React hook wrapping the Health Connect service.
 * Handles status polling, permission flow, and background sync.
 *
 * Usage:
 *   const { status, sync, lastSync, lastResult, requestPermissions } = useHealthConnect();
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  checkAvailability,
  requestPermissions as doRequestPermissions,
  aggregateAndSync,
  isAndroidNative,
  type HealthConnectStatus,
  type SyncResult,
} from './healthConnectService';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

function getStoredToken(): string {
  try {
    return localStorage.getItem('accessToken') ?? '';
  } catch {
    return '';
  }
}

interface UseHealthConnectReturn {
  isAndroid:          boolean;
  status:             HealthConnectStatus;
  isSyncing:          boolean;
  lastSync:           Date | null;
  lastResult:         SyncResult | null;
  sync:               () => Promise<void>;
  requestPermissions: () => Promise<void>;
}

export function useHealthConnect(): UseHealthConnectReturn {
  const isAndroid  = isAndroidNative();
  const [status,     setStatus]     = useState<HealthConnectStatus>('unavailable');
  const [isSyncing,  setIsSyncing]  = useState(false);
  const [lastSync,   setLastSync]   = useState<Date | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check availability on mount
  useEffect(() => {
    if (!isAndroid) return;
    checkAvailability().then(setStatus);
  }, [isAndroid]);

  // Auto-sync when status becomes ready
  useEffect(() => {
    if (status !== 'ready') {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Immediate sync on connect
    doSync();

    // Schedule periodic sync
    intervalRef.current = setInterval(doSync, AUTO_SYNC_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const doSync = useCallback(async () => {
    if (isSyncing) return;
    const token = getStoredToken();
    if (!token) return;

    setIsSyncing(true);
    try {
      const result = await aggregateAndSync(API_BASE_URL, token);
      setLastResult(result);
      if (result.success) setLastSync(new Date());
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing]);

  const requestPermissions = useCallback(async () => {
    const granted = await doRequestPermissions();
    if (granted) {
      setStatus('ready');
    } else {
      // Re-check — partial grants still possible
      const updated = await checkAvailability();
      setStatus(updated);
    }
  }, []);

  return {
    isAndroid,
    status,
    isSyncing,
    lastSync,
    lastResult,
    sync:               doSync,
    requestPermissions,
  };
}
