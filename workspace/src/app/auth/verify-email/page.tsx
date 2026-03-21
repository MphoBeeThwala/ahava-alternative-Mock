"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { authApi } from "@/lib/api";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("No verification token found in the link.");
      return;
    }
    authApi.verifyEmail(token)
      .then(() => setStatus("success"))
      .catch((err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setStatus("error");
        setMessage(msg ?? "Verification failed. The link may have already been used.");
      });
  }, [token]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#0f172a 0%,#134e4a 60%,#0d9488 100%)", padding: 24 }}>
      <div style={{ background: "white", borderRadius: 24, maxWidth: 440, width: "100%", padding: "44px 36px", textAlign: "center", boxShadow: "0 24px 80px rgba(0,0,0,0.2)" }}>
        {status === "loading" && (
          <>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 20px" }}>⏳</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>Verifying your email…</h1>
            <p style={{ color: "#64748b", fontSize: 14 }}>Please wait a moment.</p>
          </>
        )}
        {status === "success" && (
          <>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg,#0d9488,#059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 20px" }}>✓</div>
            <h1 style={{ fontSize: 26, fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>Email Verified!</h1>
            <p style={{ color: "#475569", fontSize: 14, marginBottom: 28 }}>Your email address has been verified. Your account is now fully active.</p>
            <Link href="/auth/login" style={{ display: "inline-block", background: "linear-gradient(135deg,#0d9488,#059669)", color: "white", borderRadius: 12, padding: "13px 32px", fontSize: 15, fontWeight: 700, textDecoration: "none" }}>
              Go to Login →
            </Link>
          </>
        )}
        {status === "error" && (
          <>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg,#ef4444,#dc2626)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 20px" }}>✗</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginBottom: 10 }}>Verification Failed</h1>
            <p style={{ color: "#64748b", fontSize: 14, marginBottom: 24 }}>{message}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
              <Link href="/auth/login" style={{ color: "#0d9488", fontWeight: 600, fontSize: 14 }}>Go to login</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
