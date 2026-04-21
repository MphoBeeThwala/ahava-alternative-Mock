"use client";

import { useState } from "react";
import Link from "next/link";
import { authApi } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#0f172a 0%,#134e4a 60%,#0d9488 100%)", padding: 24 }}>
      <div style={{ background: "white", borderRadius: 24, maxWidth: 440, width: "100%", padding: "44px 36px", boxShadow: "0 24px 80px rgba(0,0,0,0.2)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg,#0d9488,#059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 16px" }}>🔑</div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "#0f172a", margin: 0 }}>Forgot Password?</h1>
          <p style={{ color: "#64748b", fontSize: 14, marginTop: 8 }}>Enter your email and we&apos;ll send you a reset link.</p>
        </div>

        {sent ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "20px 16px", marginBottom: 24 }}>
              <p style={{ color: "#166534", fontWeight: 600, margin: 0 }}>✓ Reset link sent!</p>
              <p style={{ color: "#16a34a", fontSize: 13, marginTop: 6, margin: "6px 0 0" }}>Check your inbox at <strong>{email}</strong>. The link expires in 1 hour.</p>
            </div>
            <Link href="/auth/login" style={{ color: "#0d9488", fontWeight: 600, fontSize: 14 }}>← Back to login</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 14px", marginBottom: 20, color: "#dc2626", fontSize: 14 }}>{error}</div>
            )}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", padding: "14px", background: loading ? "#94a3b8" : "linear-gradient(135deg,#0d9488,#059669)", color: "white", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}
            >
              {loading ? "Sending…" : "Send Reset Link"}
            </button>
            <p style={{ textAlign: "center", marginTop: 20, fontSize: 14, color: "#64748b" }}>
              <Link href="/auth/login" style={{ color: "#0d9488", fontWeight: 600 }}>← Back to login</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
