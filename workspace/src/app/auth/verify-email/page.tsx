"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authApi } from "@/lib/api";

const ROLE_PATHS: Record<string, string> = {
  PATIENT: "/patient/dashboard",
  DOCTOR:  "/doctor/dashboard",
  NURSE:   "/nurse/dashboard",
  ADMIN:   "/admin/dashboard",
};

function getRedirectPath(): string {
  try {
    const user = JSON.parse(localStorage.getItem("user") ?? "{}");
    if (user?.role && ROLE_PATHS[user.role]) return ROLE_PATHS[user.role];
  } catch { /* ignore */ }
  return "/auth/login";
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";

  const [status, setStatus] = useState<"loading" | "success" | "error">(token ? "loading" : "error");
  const [message, setMessage] = useState(token ? "" : "No verification token found in the link.");
  const [countdown, setCountdown] = useState(4);
  const [redirectPath, setRedirectPath] = useState("/auth/login");

  const startCountdown = useCallback((path: string) => {
    setRedirectPath(path);
    const interval = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          clearInterval(interval);
          router.push(path);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [router]);

  useEffect(() => {
    if (!token) return;
    authApi.verifyEmail(token)
      .then(() => {
        setStatus("success");
        const path = getRedirectPath();
        startCountdown(path);
      })
      .catch((err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setStatus("error");
        setMessage(msg ?? "Verification failed. The link may have already been used.");
      });
  }, [token, startCountdown]);

  const destinationLabel = redirectPath === "/auth/login" ? "Login" : "your dashboard";

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
            <p style={{ color: "#475569", fontSize: 14, marginBottom: 20 }}>
              Your email address has been verified. Your account is now fully active.
            </p>
            <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 24 }}>
              Redirecting you to {destinationLabel} in <strong style={{ color: "#0d9488" }}>{countdown}</strong>s…
            </p>
            <Link href={redirectPath} style={{ display: "inline-block", background: "linear-gradient(135deg,#0d9488,#059669)", color: "white", borderRadius: 12, padding: "13px 32px", fontSize: 15, fontWeight: 700, textDecoration: "none" }}>
              Go now →
            </Link>
          </>
        )}
        {status === "error" && (
          <>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg,#ef4444,#dc2626)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 20px" }}>✗</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginBottom: 10 }}>Verification Failed</h1>
            <p style={{ color: "#64748b", fontSize: 14, marginBottom: 24 }}>{message}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
              <Link href="/auth/login" style={{ display: "inline-block", background: "linear-gradient(135deg,#0d9488,#059669)", color: "white", borderRadius: 12, padding: "13px 32px", fontSize: 15, fontWeight: 700, textDecoration: "none" }}>
                Go to Login →
              </Link>
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
