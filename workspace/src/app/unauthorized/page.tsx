"use client";

import Link from "next/link";
import { useAuth } from "../../contexts/AuthContext";

const DASHBOARD: Record<string, string> = {
  PATIENT: "/patient/dashboard",
  NURSE:   "/nurse/dashboard",
  DOCTOR:  "/doctor/dashboard",
  ADMIN:   "/admin/dashboard",
};

export default function UnauthorizedPage() {
  const { user } = useAuth();
  const href = user ? (DASHBOARD[user.role] ?? "/") : "/auth/login";
  const label = user ? "Go to your dashboard" : "Sign in";

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f3ef", fontFamily: "inherit" }}>
      <div style={{ textAlign: "center", maxWidth: 420, padding: "0 24px" }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🚫</div>
        <h1 style={{ fontSize: 26, fontWeight: 900, color: "#1c1917", marginBottom: 10 }}>Access Denied</h1>
        <p style={{ fontSize: 15, color: "#57534e", lineHeight: 1.65, marginBottom: 32 }}>
          You don&apos;t have permission to view this page.
          {user && ` Your role is ${user.role}.`}
        </p>
        <Link
          href={href}
          style={{ display: "inline-block", background: "linear-gradient(135deg,#0d9488,#059669)", color: "white", borderRadius: 10, padding: "12px 28px", fontSize: 15, fontWeight: 700, textDecoration: "none", boxShadow: "0 4px 14px rgba(13,148,136,0.35)" }}
        >
          {label} →
        </Link>
      </div>
    </div>
  );
}
