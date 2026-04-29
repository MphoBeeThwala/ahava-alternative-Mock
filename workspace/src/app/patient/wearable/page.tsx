"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import RoleGuard, { UserRole } from "../../../components/RoleGuard";
import DashboardLayout from "../../../components/DashboardLayout";
import { terraApi, TerraStatus, rookApi, RookStatus } from "../../../lib/api";
import { useToast } from "../../../contexts/ToastContext";

const SUPPORTED_DEVICES = [
  { name: "Apple Watch",   icon: "⌚", color: "#1c1917" },
  { name: "Fitbit",        icon: "📟", color: "#00b0b9" },
  { name: "Garmin",        icon: "🟢", color: "#007cc3" },
  { name: "Samsung Galaxy Watch", icon: "⌚", color: "#1428a0" },
  { name: "Whoop",         icon: "🔴", color: "#c8102e" },
  { name: "Oura Ring",     icon: "💍", color: "#2d2d2d" },
  { name: "Polar",         icon: "🔷", color: "#d8232a" },
  { name: "Withings",      icon: "📡", color: "#0077c8" },
];

const DATA_SHARED = [
  { icon: "❤️",  label: "Heart rate",        desc: "Resting HR, HR variability (HRV)" },
  { icon: "🩸",  label: "Blood oxygen",       desc: "SpO₂ saturation percentage" },
  { icon: "🌡️",  label: "Body temperature",   desc: "Skin temperature offset" },
  { icon: "🫁",  label: "Respiratory rate",   desc: "Breaths per minute" },
  { icon: "🚶",  label: "Activity",           desc: "Steps, active calories burned" },
  { icon: "😴",  label: "Sleep",              desc: "Duration & quality scoring" },
];

const STEPS = [
  { n: "1", title: "Connect your device",      body: "Tap the button below. A secure Terra-powered page opens where you choose your device brand and log in to that account (e.g. Fitbit, Garmin Connect, Apple Health)." },
  { n: "2", title: "Grant permissions",         body: "Your device's app or phone will ask which data types to share. Select the ones you're comfortable with — heart rate, sleep, and activity give the best AI insights." },
  { n: "3", title: "Automatic syncing starts",  body: "Data flows from your watch → your phone → Terra → Ahava every time your device syncs (usually every 15–30 min). No extra action needed from you." },
  { n: "4", title: "AI monitors in real time",  body: "Every sync triggers Ahava's early-warning model. If anything unusual is detected (RED or YELLOW alert), your care team is notified immediately." },
];

export default function WearablePage() {
  const toast = useToast();
  const [status, setStatus] = useState<TerraStatus | null>(null);
  const [rookStatus, setRookStatus] = useState<RookStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectingRook, setConnectingRook] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [s, rs] = await Promise.all([
        terraApi.getStatus().catch(() => null),
        rookApi.getStatus().catch(() => null)
      ]);
      if (s) setStatus(s);
      if (rs) setRookStatus(rs);
      return { terra: s, rook: rs };
    } catch {
      // silently ignore
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchStatus]);

  const startPolling = (type: 'terra' | 'rook') => {
    if (pollRef.current) clearInterval(pollRef.current);
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts += 1;
      const { terra, rook } = await fetchStatus() || {};
      const connected = type === 'terra' ? terra?.connected : rook?.connected;
      
      if (connected || attempts >= 30) {
        clearInterval(pollRef.current!);
        if (type === 'terra') setConnecting(false);
        else setConnectingRook(false);
        
        if (connected) toast.success(`${type === 'terra' ? 'Terra' : 'ROOK'} device connected! Data will start syncing shortly.`);
      }
    }, 3000);
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { url } = await terraApi.connect();
      if (!url) throw new Error("No widget URL returned");
      const popup = window.open(url, "terra-connect", "width=520,height=680,left=200,top=100");
      if (!popup) {
        window.location.href = url;
        return;
      }
      startPolling('terra');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(e.response?.data?.error || e.message || "Failed to start device connection.");
      setConnecting(false);
    }
  };

  const handleConnectRook = async () => {
    setConnectingRook(true);
    try {
      const { url } = await rookApi.connect();
      if (!url) throw new Error("No ROOK connection URL returned");
      const popup = window.open(url, "rook-connect", "width=520,height=680,left=200,top=100");
      if (!popup) {
        window.location.href = url;
        return;
      }
      startPolling('rook');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(e.response?.data?.error || e.message || "Failed to start ROOK connection.");
      setConnectingRook(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect your wearable? Data syncing will stop.")) return;
    setDisconnecting(true);
    try {
      await terraApi.disconnect();
      await fetchStatus();
      toast.success("Device disconnected.");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(e.response?.data?.error || "Failed to disconnect device.");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleDisconnectRook = async () => {
    if (!confirm("Disconnect ROOK? Data syncing will stop.")) return;
    setDisconnecting(true);
    try {
      await rookApi.disconnect();
      await fetchStatus();
      toast.success("ROOK disconnected.");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(e.response?.data?.error || "Failed to disconnect ROOK.");
    } finally {
      setDisconnecting(false);
    }
  };

  const isConnected = status?.connected ?? false;
  const devices = status?.devices ?? [];

  return (
    <RoleGuard allowedRoles={[UserRole.PATIENT]}>
      <DashboardLayout>
        <div style={{ background: "var(--background)", minHeight: "100vh" }}>

          {/* ── Hero ── */}
          <div style={{ background: "linear-gradient(135deg,#0a1628 0%,#0d2f5e 55%,#0a3d3a 100%)", padding: "36px 40px 32px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: -60, right: -60, width: 240, height: 240, borderRadius: "50%", background: "radial-gradient(circle,rgba(13,148,136,0.18),transparent 70%)", pointerEvents: "none" }} />
            <div style={{ maxWidth: 900, margin: "0 auto" }}>
              <Link href="/patient/dashboard" style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: 600, textDecoration: "none", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                ← Dashboard
              </Link>
              <h1 style={{ color: "white", fontSize: "clamp(22px,3vw,30px)", fontWeight: 900, margin: "12px 0 6px" }}>
                Connect Your Smartwatch ⌚
              </h1>
              <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, margin: 0 }}>
                Link your wearable device to unlock continuous AI health monitoring — no manual logging needed.
              </p>
            </div>
          </div>

          <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 28 }}>

            {/* ── Connection status card (Terra) ── */}
            <div style={{ background: "var(--card)", borderRadius: 20, border: "1.5px solid var(--border)", padding: "28px 32px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: isConnected ? "rgba(16,185,129,0.12)" : "rgba(148,163,184,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>
                  {loadingStatus ? "⏳" : isConnected ? "✅" : "⌚"}
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--foreground)", marginBottom: 4 }}>
                    {loadingStatus ? "Checking status…" : isConnected ? "Terra Connected" : "Connect via Terra"}
                  </div>
                  {isConnected && devices.length > 0 && (
                    <div style={{ fontSize: 13, color: "var(--muted)", display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {devices.map((d) => (
                        <span key={d} style={{ background: "rgba(13,148,136,0.1)", color: "var(--primary)", borderRadius: 8, padding: "2px 10px", fontWeight: 600 }}>
                          {d}
                        </span>
                      ))}
                    </div>
                  )}
                  {!isConnected && !loadingStatus && (
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>Connect Fitbit, Garmin, Oura, and more via Terra</div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {!isConnected ? (
                  <button
                    onClick={handleConnect}
                    disabled={connecting}
                    style={{ padding: "13px 28px", borderRadius: 12, border: "none", background: connecting ? "#94a3b8" : "linear-gradient(135deg,#0d9488,#059669)", color: "white", fontSize: 15, fontWeight: 700, cursor: connecting ? "not-allowed" : "pointer", fontFamily: "inherit", boxShadow: connecting ? "none" : "0 4px 16px rgba(13,148,136,0.35)", transition: "all 0.2s" }}
                  >
                    {connecting ? "Opening Terra…" : "Connect Terra →"}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleConnect}
                      disabled={connecting}
                      style={{ padding: "11px 20px", borderRadius: 12, border: "1.5px solid var(--border)", background: "transparent", color: "var(--foreground)", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                    >
                      + Add device
                    </button>
                    <button
                      onClick={handleDisconnect}
                      disabled={disconnecting}
                      style={{ padding: "11px 20px", borderRadius: 12, border: "1.5px solid #fca5a5", background: "transparent", color: "#dc2626", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                    >
                      {disconnecting ? "Disconnecting…" : "Disconnect"}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* ── Connection status card (ROOK) ── */}
            <div style={{ background: "var(--card)", borderRadius: 20, border: "1.5px solid var(--border)", padding: "28px 32px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 20, borderLeft: "4px solid #3b82f6" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: rookStatus?.connected ? "rgba(59,130,246,0.12)" : "rgba(148,163,184,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>
                  {loadingStatus ? "⏳" : rookStatus?.connected ? "✅" : "🐦"}
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--foreground)", marginBottom: 4 }}>
                    {loadingStatus ? "Checking status…" : rookStatus?.connected ? "ROOK Connected" : "Connect via ROOK (Trial)"}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>
                    {rookStatus?.connected ? "Active ROOK health data sync" : "Access more biometric sources with our new ROOK integration"}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {!rookStatus?.connected ? (
                  <button
                    onClick={handleConnectRook}
                    disabled={connectingRook}
                    style={{ padding: "13px 28px", borderRadius: 12, border: "none", background: connectingRook ? "#94a3b8" : "linear-gradient(135deg,#3b82f6,#2563eb)", color: "white", fontSize: 15, fontWeight: 700, cursor: connectingRook ? "not-allowed" : "pointer", fontFamily: "inherit", boxShadow: connectingRook ? "none" : "0 4px 16px rgba(59,130,246,0.35)", transition: "all 0.2s" }}
                  >
                    {connectingRook ? "Opening ROOK…" : "Connect ROOK →"}
                  </button>
                ) : (
                  <button
                    onClick={handleDisconnectRook}
                    disabled={disconnecting}
                    style={{ padding: "11px 20px", borderRadius: 12, border: "1.5px solid #fca5a5", background: "transparent", color: "#dc2626", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    {disconnecting ? "Disconnecting…" : "Disconnect ROOK"}
                  </button>
                )}
              </div>
            </div>

            {/* ── Polling notice (Terra) ── */}
            {connecting && (
              <div style={{ background: "rgba(13,148,136,0.08)", border: "1px solid rgba(13,148,136,0.2)", borderRadius: 14, padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 20, height: 20, border: "2.5px solid #0d9488", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.9s linear infinite", flexShrink: 0 }} />
                <div style={{ fontSize: 14, color: "var(--foreground)", lineHeight: 1.5 }}>
                  <strong>Complete the Terra connection in the popup window.</strong> Once you finish, this page will update automatically.
                </div>
              </div>
            )}

            {/* ── Polling notice (ROOK) ── */}
            {connectingRook && (
              <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 14, padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 20, height: 20, border: "2.5px solid #3b82f6", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.9s linear infinite", flexShrink: 0 }} />
                <div style={{ fontSize: 14, color: "var(--foreground)", lineHeight: 1.5 }}>
                  <strong>Complete the ROOK connection in the popup window.</strong> Once you finish, this page will update automatically.
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

              {/* ── How it works ── */}
              <div style={{ background: "var(--card)", borderRadius: 20, border: "1.5px solid var(--border)", padding: "28px" }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--foreground)", marginBottom: 20 }}>How it works</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                  {STEPS.map((s) => (
                    <div key={s.n} style={{ display: "flex", gap: 14 }}>
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#0d9488,#059669)", color: "white", fontWeight: 900, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {s.n}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)", marginBottom: 3 }}>{s.title}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>{s.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Data shared ── */}
              <div style={{ background: "var(--card)", borderRadius: 20, border: "1.5px solid var(--border)", padding: "28px" }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--foreground)", marginBottom: 6 }}>What data is shared</h2>
                <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 18, lineHeight: 1.5 }}>
                  Data is encrypted in transit and at rest. Processed under <strong>POPIA</strong>. You can disconnect at any time.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {DATA_SHARED.map((d) => (
                    <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 12, background: "var(--background)" }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>{d.icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{d.label}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{d.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Supported devices ── */}
            <div style={{ background: "var(--card)", borderRadius: 20, border: "1.5px solid var(--border)", padding: "28px" }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--foreground)", marginBottom: 18 }}>Supported devices</h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {SUPPORTED_DEVICES.map((d) => (
                  <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 12, border: "1.5px solid var(--border)", background: "var(--background)" }}>
                    <span style={{ fontSize: 18 }}>{d.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{d.name}</span>
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 12, border: "1.5px dashed var(--border)", background: "transparent" }}>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>+ 50 more via Terra</span>
                </div>
              </div>
            </div>

            {/* ── POPIA notice ── */}
            <div style={{ padding: "16px 20px", borderRadius: 14, background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)", fontSize: 12, color: "#1e40af", lineHeight: 1.65 }}>
              <strong>Privacy notice:</strong> Ahava processes your wearable data solely to provide health monitoring, early warning alerts, and care coordination services. Under <strong>POPIA section 11</strong>, you explicitly consent to this processing by connecting a device. You may withdraw consent and disconnect at any time from this page.
            </div>

          </div>
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </DashboardLayout>
    </RoleGuard>
  );
}
