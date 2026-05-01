"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";
import { authApi } from "../lib/api";

/**
 * Dashboard layout: sidebar + main content.
 * Same behaviour as NavBar (role-based link, logout, user); presentation only (Phase 1).
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout, isAuthenticated, refreshUser } = useAuth();
  const pathname = usePathname();
  const [verifyBannerDismissed, setVerifyBannerDismissed] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  const handleResendVerification = async () => {
    if (!user?.email) return;
    setResendLoading(true);
    try {
      await authApi.resendVerification(user.email);
      setResendSent(true);
    } catch {
      // silently ignore — backend always returns success to avoid enumeration
      setResendSent(true);
    } finally {
      setResendLoading(false);
    }
  };

  const handleManualVerify = async () => {
     setResendLoading(true);
     try {
       await authApi.manualVerify();
       setVerifyBannerDismissed(true);
       if (refreshUser) await refreshUser();
     } catch {
       // fallback if API fails
       setVerifyBannerDismissed(true);
     } finally {
       setResendLoading(false);
     }
   };

  const showVerifyBanner = isAuthenticated && user && !(user as { isVerified?: boolean }).isVerified && !verifyBannerDismissed;
  const riskProfile = user?.riskProfile;
  const profileObject = (riskProfile && typeof riskProfile === "object") ? (riskProfile as Record<string, unknown>) : {};
  const medicalPassport = (profileObject["medicalPassport"] && typeof profileObject["medicalPassport"] === "object")
    ? (profileObject["medicalPassport"] as Record<string, unknown>)
    : {};
  const csvHasValue = (v: unknown): boolean => Array.isArray(v) && v.some((i) => typeof i === "string" && i.trim().length > 0);
  const passportChecks = [
    Boolean(user?.firstName && user?.lastName),
    Boolean(user?.phone),
    Boolean(user?.dateOfBirth),
    Boolean(user?.gender),
    typeof medicalPassport["emergencyContactName"] === "string" && medicalPassport["emergencyContactName"].trim().length > 0,
    typeof medicalPassport["emergencyContactPhone"] === "string" && medicalPassport["emergencyContactPhone"].trim().length > 0,
    typeof medicalPassport["bloodType"] === "string" && medicalPassport["bloodType"].trim().length > 0,
    csvHasValue(medicalPassport["allergies"]),
    csvHasValue(medicalPassport["chronicConditions"]),
    csvHasValue(medicalPassport["currentMedications"]),
  ];
  const passportCompletionPercent = Math.round((passportChecks.filter(Boolean).length / passportChecks.length) * 100);
  const showOnboardingReminder = isAuthenticated && user?.role === "PATIENT" && passportCompletionPercent < 80;

  const getDashboardPath = () => {
    if (!user) return "/";
    switch (user.role) {
      case "PATIENT":
        return "/patient/dashboard";
      case "DOCTOR":
        return "/doctor/dashboard";
      case "NURSE":
        return "/nurse/dashboard";
      case "ADMIN":
        return "/admin/dashboard";
      default:
        return "/";
    }
  };

  const getDashboardLabel = () => {
    if (!user) return "Dashboard";
    switch (user.role) {
      case "PATIENT":
        return "Patient Portal";
      case "DOCTOR":
        return "Doctor Dashboard";
      case "NURSE":
        return "Nurse Dashboard";
      case "ADMIN":
        return "Admin Dashboard";
      default:
        return "Dashboard";
    }
  };

  if (!isAuthenticated || !user) {
    return <>{children}</>;
  }

  const dashboardPath = getDashboardPath();

  const linkClass = (active: boolean) =>
    `nav-link flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
      active
        ? "bg-[var(--primary)] text-white shadow-sm"
        : "text-[var(--muted)] hover:bg-[var(--primary-soft)] hover:text-[var(--foreground)]"
    }`;

  const initials = user.firstName && user.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : (user.firstName?.[0] ?? '?').toUpperCase();

  const roleColor: Record<string, string> = {
    PATIENT: '#0d9488',
    DOCTOR:  '#2563eb',
    NURSE:   '#059669',
    ADMIN:   '#7c3aed',
  };
  const accent = roleColor[user.role] ?? '#0d9488';

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <aside
        className="flex w-64 flex-col"
        style={{ background: 'white', borderRight: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
      >
        {/* Brand header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(135deg,${accent},#059669)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>⚕️</div>
          <Link href={dashboardPath} className="font-bold text-[var(--foreground)] tracking-tight text-sm leading-tight" aria-label="Ahava Healthcare home">
            Ahava<br /><span style={{ color: accent, fontWeight: 600 }}>Healthcare</span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1" aria-label="Dashboard navigation">
          <Link href={dashboardPath} className={linkClass(pathname === dashboardPath)} aria-current={pathname === dashboardPath ? "page" : undefined}>
            <span aria-hidden>🏠</span>{getDashboardLabel()}
          </Link>
          {user.role === "PATIENT" && (
            <>
              <Link href="/patient/book-visit" className={linkClass(pathname.startsWith("/patient/book-visit") || pathname.startsWith("/patient/visit-tracker"))} aria-current={pathname.startsWith("/patient/book-visit") ? "page" : undefined}>
                <span aria-hidden>📅</span>Book a Visit
              </Link>
              <Link href="/patient/early-warning" className={linkClass(pathname === "/patient/early-warning")} aria-current={pathname === "/patient/early-warning" ? "page" : undefined}>
                <span aria-hidden>⚠️</span>Early Warning
              </Link>
              <Link href="/patient/ai-doctor" className={linkClass(pathname === "/patient/ai-doctor")} aria-current={pathname === "/patient/ai-doctor" ? "page" : undefined}>
                <span aria-hidden>🩺</span>AI Doctor
              </Link>
              <Link href="/patient/wearable" className={linkClass(pathname.startsWith("/patient/wearable"))} aria-current={pathname.startsWith("/patient/wearable") ? "page" : undefined}>
                <span aria-hidden>⌚</span>Smartwatch
              </Link>
            </>
          )}
          {user.role === "NURSE" && (
            <div className="mt-4 px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(5,150,105,0.08)', color: '#059669', fontWeight: 600 }}>
              🟢 Verified Nurse
            </div>
          )}
          {user.role === "DOCTOR" && (
            <div className="mt-4 px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(37,99,235,0.08)', color: '#2563eb', fontWeight: 600 }}>
              🏥 Licensed Doctor
            </div>
          )}
          {/* Profile — all roles */}
          <Link href="/profile" className={linkClass(pathname === "/profile")} aria-current={pathname === "/profile" ? "page" : undefined}>
            <span aria-hidden>👤</span>My Profile
          </Link>
        </nav>

        {/* User chip + POPIA + logout */}
        <div className="border-t p-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
          {/* User chip */}
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl" style={{ background: 'var(--background)' }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: `linear-gradient(135deg,${accent},#059669)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
              {initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <p className="truncate text-xs font-semibold text-[var(--foreground)]">{user.firstName} {user.lastName}</p>
              <p className="text-[10px] font-medium" style={{ color: accent }}>{user.role}</p>
            </div>
          </div>

          {/* POPIA badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(13,148,136,0.07)' }}>
            <span style={{ fontSize: 10 }}>🔒</span>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>POPIA Compliant · Encrypted</span>
          </div>

          <button
            type="button"
            onClick={() => { void logout(); }}
            className="nav-link w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-[var(--muted)] hover:bg-red-50 hover:text-red-600"
            aria-label="Log out"
          >
            ↩ Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto" id="main-content" aria-label="Main content">
        {showOnboardingReminder && !pathname.startsWith("/profile") && (
          <div
            role="status"
            style={{
              background: "#eff6ff",
              borderBottom: "1px solid #bfdbfe",
              padding: "10px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              fontSize: 13,
            }}
          >
              <span style={{ color: "#1e3a8a", display: "flex", alignItems: "center", gap: 8 }}>
                <span>🩺</span>
              <span><strong>Finish your medical passport</strong> ({passportCompletionPercent}% complete) to improve personalised risk surveillance.</span>
            </span>
            <Link
              href="/profile"
              style={{
                background: "#2563eb",
                color: "white",
                borderRadius: 7,
                padding: "5px 12px",
                fontSize: 12,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              Complete Passport
            </Link>
          </div>
        )}
        {showVerifyBanner && (
          <div role="alert" style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
            <span style={{ color: '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📧</span>
              <span><strong>Verify your email</strong> — check your inbox for a verification link to activate all features.</span>
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              {resendSent ? (
                <span style={{ color: '#059669', fontSize: 12, fontWeight: 600 }}>✓ Email sent!</span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resendLoading}
                    style={{ background: '#f59e0b', border: 'none', color: 'white', borderRadius: 7, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: resendLoading ? 'not-allowed' : 'pointer', opacity: resendLoading ? 0.7 : 1 }}
                  >
                    {resendLoading ? 'Sending…' : 'Resend email'}
                  </button>
                  <button
                    type="button"
                    onClick={handleManualVerify}
                    disabled={resendLoading}
                    style={{ background: 'white', border: '1px solid #d97706', color: '#d97706', borderRadius: 7, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: resendLoading ? 'not-allowed' : 'pointer' }}
                  >
                    Verify Now (Trial)
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setVerifyBannerDismissed(true)}
                aria-label="Dismiss"
                style={{ background: 'transparent', border: 'none', color: '#a16207', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
              >×</button>
            </div>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
