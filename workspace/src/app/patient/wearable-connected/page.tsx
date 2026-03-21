"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { terraApi } from "../../../lib/api";

export default function WearableConnectedPage() {
  const [devices, setDevices] = useState<string[]>([]);

  useEffect(() => {
    terraApi.getStatus().then((s) => setDevices(s.devices ?? [])).catch(() => {});
    if (window.opener) {
      setTimeout(() => window.close(), 3000);
    }
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#064e3b 0%,#065f46 60%,#047857 100%)", fontFamily: "inherit", padding: 24 }}>
      <div style={{ background: "white", borderRadius: 24, maxWidth: 460, width: "100%", padding: "44px 36px", textAlign: "center", boxShadow: "0 24px 80px rgba(0,0,0,0.2)" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg,#10b981,#059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 20px" }}>✅</div>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: "#1c1917", marginBottom: 10 }}>Device Connected!</h1>
        <p style={{ fontSize: 14, color: "#57534e", lineHeight: 1.65, marginBottom: 20 }}>
          Your smartwatch is now linked to Ahava. Data will start syncing automatically every time your device connects to your phone.
        </p>
        {devices.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginBottom: 24 }}>
            {devices.map((d) => (
              <span key={d} style={{ background: "rgba(16,185,129,0.1)", color: "#059669", borderRadius: 8, padding: "4px 12px", fontSize: 13, fontWeight: 700 }}>
                ✓ {d}
              </span>
            ))}
          </div>
        )}
        <div style={{ background: "#f0fdf4", borderRadius: 14, padding: "14px 18px", marginBottom: 28, textAlign: "left" }}>
          <p style={{ fontSize: 13, color: "#166534", margin: 0, lineHeight: 1.6 }}>
            <strong>What happens next:</strong><br />
            Your biometric data (heart rate, sleep, SpO₂) will flow to Ahava automatically. The AI early-warning model will start monitoring within the next sync cycle.
          </p>
        </div>
        <Link
          href="/patient/wearable"
          style={{ display: "inline-block", background: "linear-gradient(135deg,#0d9488,#059669)", color: "white", borderRadius: 12, padding: "13px 32px", fontSize: 15, fontWeight: 700, textDecoration: "none", boxShadow: "0 4px 16px rgba(13,148,136,0.35)" }}
        >
          Back to Wearable Settings →
        </Link>
      </div>
    </div>
  );
}
