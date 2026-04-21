/**
 * WearableConnectCard.tsx
 *
 * Shows Google Health Connect status on the PatientDashboard.
 * On Android native: shows connect/sync controls.
 * On web: shows a prompt to use the Android app.
 */

import React from 'react';
import { useHealthConnect } from '../lib/useHealthConnect';

function AlertBadge({ level }: { level?: string }) {
  const colours: Record<string, string> = {
    GREEN:  'bg-green-100 text-green-800',
    YELLOW: 'bg-yellow-100 text-yellow-800',
    RED:    'bg-red-100 text-red-800',
  };
  const cls = colours[level ?? 'GREEN'] ?? colours.GREEN;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {level ?? 'GREEN'}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const colours: Record<string, string> = {
    ready:            'bg-green-500',
    needs_permission: 'bg-yellow-500',
    not_installed:    'bg-orange-500',
    unavailable:      'bg-gray-400',
    error:            'bg-red-500',
  };
  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full ${colours[status] ?? 'bg-gray-400'}`} />
  );
}

export default function WearableConnectCard() {
  const { isAndroid, status, isSyncing, lastSync, lastResult, sync, requestPermissions } =
    useHealthConnect();

  // ── Web fallback ──────────────────────────────────────────────────────────
  if (!isAndroid) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">⌚</span>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">Wearable Sync</h3>
            <p className="text-xs text-gray-500">Google Health Connect</p>
          </div>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed">
          Automatic health data sync is available on the <strong>Ahava Android app</strong>.
          Download it to connect your Fitbit, Samsung, Garmin, or any other Android-compatible wearable — free, no extra subscription needed.
        </p>
        <div className="mt-3 flex gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
            <span>✓</span> Fitbit
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
            <span>✓</span> Samsung
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
            <span>✓</span> Garmin
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
            <span>✓</span> Xiaomi
          </span>
        </div>
      </div>
    );
  }

  // ── Android native ────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⌚</span>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">Health Connect</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <StatusDot status={status} />
              <span className="text-xs text-gray-500 capitalize">
                {status === 'ready'            ? 'Connected'
                  : status === 'needs_permission' ? 'Needs permission'
                  : status === 'not_installed'    ? 'App not installed'
                  : status === 'error'            ? 'Error'
                  : 'Not available'}
              </span>
            </div>
          </div>
        </div>
        {lastResult?.alertLevel && (
          <AlertBadge level={lastResult.alertLevel} />
        )}
      </div>

      {/* Last sync info */}
      {lastSync && (
        <div className="text-xs text-gray-500 mb-3">
          Last synced: {lastSync.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
          {lastResult?.readinessScore != null && (
            <span className="ml-2 font-medium text-gray-700">
              · Readiness: {lastResult.readinessScore}/100
            </span>
          )}
        </div>
      )}

      {/* Anomalies */}
      {lastResult?.anomalies?.length ? (
        <div className="mb-3 rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2">
          <p className="text-xs font-medium text-yellow-800">Anomalies detected:</p>
          <ul className="mt-1 space-y-0.5">
            {lastResult.anomalies.map((a, i) => (
              <li key={i} className="text-xs text-yellow-700">• {a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Not installed */}
      {status === 'not_installed' && (
        <div className="mb-3 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2">
          <p className="text-xs text-orange-800">
            Health Connect is not installed on your device. Install it from the{' '}
            <a
              href="https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata"
              target="_blank"
              rel="noreferrer"
              className="font-semibold underline"
            >
              Google Play Store
            </a>
            {' '}(free).
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {status === 'needs_permission' && (
          <button
            onClick={requestPermissions}
            className="flex-1 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            Grant Permissions
          </button>
        )}

        {status === 'ready' && (
          <button
            onClick={sync}
            disabled={isSyncing}
            className="flex-1 rounded-xl bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {isSyncing ? (
              <>
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Syncing…
              </>
            ) : (
              'Sync Now'
            )}
          </button>
        )}
      </div>

      {/* Supported devices */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {['Fitbit', 'Samsung', 'Garmin', 'Xiaomi', 'Withings', 'Whoop'].map((d) => (
          <span key={d} className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}
