"use client";

import React, { useCallback, useEffect, useState } from "react";
import { phoneHealthApi } from "../lib/api";
import {
  getPhoneHealthAvailability,
  readPhoneHealth,
  requestPhoneHealthAccess,
  type PhoneHealthAvailability,
} from "../lib/phoneHealth";
import { useToast } from "../contexts/ToastContext";

const LAST_SYNC_KEY = "ahava.phoneHealth.lastSync";

function readLastSync(): string | null {
  try { return localStorage.getItem(LAST_SYNC_KEY); } catch { return null; }
}
function writeLastSync(iso: string) {
  try { localStorage.setItem(LAST_SYNC_KEY, iso); } catch { /* private mode: just don't remember it */ }
}

/**
 * Direct phone-health sync: Health Connect (Android) / Apple Health (iPhone).
 * Free, and works with any watch that syncs to the phone's health app.
 * In a normal browser it only explains how to get it.
 */
export default function PhoneHealthCard() {
  const toast = useToast();
  const [availability, setAvailability] = useState<PhoneHealthAvailability | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    setLastSync(readLastSync());
    getPhoneHealthAvailability().then(setAvailability);
  }, []);

  const sync = useCallback(async (askPermission: boolean) => {
    if (availability?.state !== "ready") return;
    setBusy(true);
    try {
      if (askPermission) {
        const allowed = await requestPhoneHealthAccess();
        if (allowed.length === 0) {
          toast.error("No health data was shared. You can allow it in the Health Connect / Apple Health settings.");
          return;
        }
      }
      const payload = await readPhoneHealth(availability.platform);
      if (!payload) {
        toast.error("Your phone has no recent readings to share yet. Wear your watch, let it sync to your phone's health app, then try again.");
        return;
      }
      const result = await phoneHealthApi.sync(payload, `phone-${payload.syncedAt}`);
      writeLastSync(payload.syncedAt);
      setLastSync(payload.syncedAt);
      toast.success(
        result.alertLevel === "GREEN"
          ? "Synced. Your readings look normal."
          : "Synced. Your readings need attention; check your alerts.",
      );
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(e.response?.data?.error || e.message || "Could not sync your phone's health data.");
    } finally {
      setBusy(false);
    }
  }, [availability, toast]);

  if (!availability) return null;

  const store = availability.state === "ready" && availability.platform === "ios" ? "Apple Health" : "Health Connect";

  return (
    <div style={{ background: "var(--card)", borderRadius: 20, border: "1.5px solid var(--border)", padding: "24px 28px" }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--foreground)", marginBottom: 6 }}>
        Sync from your phone&apos;s health app
      </div>

      {availability.state === "web" && (
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
          Open Ahava in the phone app to share heart rate, blood oxygen, sleep and more straight from your watch via
          Health Connect (Android) or Apple Health (iPhone). It&apos;s free and works with most smartwatches.
        </p>
      )}

      {availability.state === "unavailable" && (
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{availability.reason}</p>
      )}

      {availability.state === "ready" && (
        <>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 14px" }}>
            Ahava reads what your watch has already saved to {store}. We only read the data you allow, and never write to it.
            {lastSync ? ` Last synced ${new Date(lastSync).toLocaleString()}.` : ""}
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => sync(true)}
              style={{ background: "var(--primary)", color: "white", border: "none", borderRadius: 12, padding: "10px 18px", fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
            >
              {busy ? "Syncing…" : lastSync ? `Sync ${store} now` : `Connect ${store}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
