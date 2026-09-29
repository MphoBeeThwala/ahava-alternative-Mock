"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TwoFactorSettings from "../../../components/TwoFactorSettings";
import { authApi } from "../../../lib/api";
import { useAuth } from "../../../contexts/AuthContext";

const DASHBOARD: Record<string, string> = {
  PATIENT: "/patient/dashboard",
  NURSE: "/nurse/dashboard",
  DOCTOR: "/doctor/dashboard",
  ADMIN: "/admin/dashboard",
};

/**
 * Where staff land until two-factor authentication is set up: the server
 * refuses everything else for their session (MFA_ENROLLMENT_REQUIRED).
 */
export default function TwoFactorSetupPage() {
  const router = useRouter();
  const { user, isAuthenticated, loading, logout } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      router.replace("/auth/login");
      return;
    }
    authApi
      .me()
      .then((me) => setEnabled(Boolean(me?.user?.totpEnabled)))
      .catch(() => setEnabled(false));
  }, [loading, isAuthenticated, router]);

  const goToDashboard = () => {
    // Full reload so every screen starts with the now-enrolled session.
    window.location.assign(DASHBOARD[user?.role ?? ""] ?? "/");
  };

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Secure your account</h1>
        <p className="text-sm text-[var(--muted)]">
          Nurse, doctor and administrator accounts can reach patient records, so they must use two-factor
          authentication. Set it up once with an authenticator app on your phone; you&apos;ll enter a code from it
          each time you sign in.
        </p>
        {enabled === null ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : enabled ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--foreground)]">Two-factor authentication is on for your account.</p>
            <button onClick={goToDashboard} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--primary)" }}>
              Continue
            </button>
          </div>
        ) : (
          <TwoFactorSettings initiallyEnabled={false} required onEnabled={goToDashboard} />
        )}
        <button onClick={() => logout()} className="text-sm text-[var(--muted)] hover:underline">
          Sign out
        </button>
      </div>
    </main>
  );
}
