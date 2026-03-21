"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function WearableFailedPage() {
  const [isPopup, setIsPopup] = useState(false);

  useEffect(() => {
    if (window.opener) {
      setIsPopup(true);
      setTimeout(() => window.close(), 4000);
    }
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#1c0a0a 0%,#450a0a 60%,#7f1d1d 100%)", fontFamily: "inherit", padding: 24 }}>
      <div style={{ background: "white", borderRadius: 24, maxWidth: 460, width: "100%", padding: "44px 36px", textAlign: "center", boxShadow: "0 24px 80px rgba(0,0,0,0.2)" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg,#ef4444,#dc2626)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 20px" }}>⚠️</div>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: "#1c1917", marginBottom: 10 }}>Connection Failed</h1>
        <p style={{ fontSize: 14, color: "#57534e", lineHeight: 1.65, marginBottom: 24 }}>
          The device could not be linked — you may have cancelled, or there was a temporary issue with the device provider.
        </p>
        <div style={{ background: "#fef2f2", borderRadius: 14, padding: "14px 18px", marginBottom: 28, textAlign: "left" }}>
          <p style={{ fontSize: 13, color: "#991b1b", margin: 0, lineHeight: 1.6 }}>
            <strong>Common reasons:</strong><br />
            • Cancelled before completing sign-in to your device account<br />
            • Incorrect credentials for Fitbit / Garmin / Apple<br />
            • Temporary issue with the device provider&apos;s servers<br />
            • Pop-up blocker prevented the connection window
          </p>
        </div>
        {isPopup ? (
          <p style={{ fontSize: 13, color: "#a8a29e" }}>This window will close automatically…</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Link
              href="/patient/wearable"
              style={{ display: "inline-block", background: "linear-gradient(135deg,#0d9488,#059669)", color: "white", borderRadius: 12, padding: "13px 32px", fontSize: 15, fontWeight: 700, textDecoration: "none", boxShadow: "0 4px 16px rgba(13,148,136,0.35)" }}
            >
              Try Again →
            </Link>
            <Link
              href="/patient/dashboard"
              style={{ display: "inline-block", color: "#a8a29e", fontSize: 13, fontWeight: 600, textDecoration: "none" }}
            >
              Back to dashboard
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
