"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { authApi } from "@/lib/api";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) setError("Invalid reset link. Please request a new one.");
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    setError("");
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.push("/auth/login"), 3000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "Reset failed. The link may have expired.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#0f172a 0%,#134e4a 60%,#0d9488 100%)", padding: 24 }}>
      <div style={{ background: "white", borderRadius: 24, maxWidth: 440, width: "100%", padding: "44px 36px", boxShadow: "0 24px 80px rgba(0,0,0,0.2)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg,#0d9488,#059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 16px" }}>🔒</div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "#0f172a", margin: 0 }}>Set New Password</h1>
          <p style={{ color: "#64748b", fontSize: 14, marginTop: 8 }}>Choose a strong password for your account.</p>
        </div>

        {done ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "20px 16px", marginBottom: 24 }}>
              <p style={{ color: "#166534", fontWeight: 600, margin: 0 }}>✓ Password updated!</p>
              <p style={{ color: "#16a34a", fontSize: 13, margin: "6px 0 0" }}>Redirecting you to login…</p>
            </div>
            <Link href="/auth/login" style={{ color: "#0d9488", fontWeight: 600, fontSize: 14 }}>Go to login →</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 14px", marginBottom: 20, color: "#dc2626", fontSize: 14 }}>{error}</div>
            )}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Min 8 characters"
                style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                placeholder="Repeat password"
                style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !token}
              style={{ width: "100%", padding: "14px", background: (loading || !token) ? "#94a3b8" : "linear-gradient(135deg,#0d9488,#059669)", color: "white", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: (loading || !token) ? "not-allowed" : "pointer" }}
            >
              {loading ? "Saving…" : "Save New Password"}
            </button>
            <p style={{ textAlign: "center", marginTop: 20, fontSize: 14 }}>
              <Link href="/auth/forgot-password" style={{ color: "#0d9488", fontWeight: 600 }}>Request a new link</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
