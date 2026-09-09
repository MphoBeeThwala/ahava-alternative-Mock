"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";
import { authApi } from "../lib/api";
import { Icon } from "./ui/Icon";

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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
  const derivedPassportCompletionPercent = Math.round((passportChecks.filter(Boolean).length / passportChecks.length) * 100);
  const storedPassportCompletionPercent = typeof profileObject["passportCompletionPercent"] === "number"
    ? Math.max(0, Math.min(100, Math.round(profileObject["passportCompletionPercent"])))
    : null;
  const passportCompletionPercent = storedPassportCompletionPercent ?? derivedPassportCompletionPercent;
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

  const roleVar: Record<string, string> = {
    PATIENT: 'var(--role-patient)',
    DOCTOR: 'var(--role-doctor)',
    NURSE: 'var(--role-nurse)',
    ADMIN: 'var(--role-admin)',
  };
  const accent = roleVar[user.role] ?? 'var(--role-patient)';

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-[var(--border)] bg-white shadow-sm transition-transform lg:static lg:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-white"
              style={{ background: `linear-gradient(135deg,${accent},#059669)` }}
            >
              <Icon name="stethoscope" size={16} />
            </div>
            <Link href={dashboardPath} className="font-bold text-[var(--foreground)] tracking-tight text-sm leading-tight" aria-label="Ahava Healthcare home">
              Ahava<br /><span style={{ color: accent, fontWeight: 600 }}>Healthcare</span>
            </Link>
          </div>
          {/* Close button for mobile */}
          <button
            className="p-1 lg:hidden text-[var(--muted)]"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Dashboard navigation">
          <Link
            href={dashboardPath}
            className={linkClass(pathname === dashboardPath)}
            aria-current={pathname === dashboardPath ? "page" : undefined}
            onClick={() => setIsSidebarOpen(false)}
          >
            <Icon name="home" size={18} /><span>{getDashboardLabel()}</span>
          </Link>
          {user.role === "PATIENT" && (
            <>
              <Link
                href="/patient/book-visit"
                className={linkClass(pathname.startsWith("/patient/book-visit") || pathname.startsWith("/patient/visit-tracker"))}
                aria-current={pathname.startsWith("/patient/book-visit") ? "page" : undefined}
                onClick={() => setIsSidebarOpen(false)}
              >
                <Icon name="calendar" size={18} /><span>Book a Visit</span>
              </Link>
              <Link
                href="/patient/early-warning"
                className={linkClass(pathname === "/patient/early-warning")}
                aria-current={pathname === "/patient/early-warning" ? "page" : undefined}
                onClick={() => setIsSidebarOpen(false)}
              >
                <Icon name="alert-triangle" size={18} /><span>Early Warning</span>
              </Link>
              <Link
                href="/patient/ai-doctor"
                className={linkClass(pathname === "/patient/ai-doctor")}
                aria-current={pathname === "/patient/ai-doctor" ? "page" : undefined}
                onClick={() => setIsSidebarOpen(false)}
              >
                <Icon name="stethoscope" size={18} /><span>AI Doctor</span>
              </Link>
              <Link
                href="/patient/wearable"
                className={linkClass(pathname.startsWith("/patient/wearable"))}
                aria-current={pathname.startsWith("/patient/wearable") ? "page" : undefined}
                onClick={() => setIsSidebarOpen(false)}
              >
                <Icon name="watch" size={18} /><span>Smartwatch</span>
              </Link>
            </>
          )}
          {user.role === "NURSE" && (
            <div className="mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(5,150,105,0.08)', color: 'var(--role-nurse)' }}>
              <Icon name="check-circle" size={14} />
              <span>Verified Nurse</span>
            </div>
          )}
          {user.role === "DOCTOR" && (
            <div className="mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(37,99,235,0.08)', color: 'var(--role-doctor)' }}>
              <Icon name="building" size={14} />
              <span>Licensed Doctor</span>
            </div>
          )}
          {/* Profile — all roles */}
          <Link
            href="/profile"
            className={linkClass(pathname === "/profile")}
            aria-current={pathname === "/profile" ? "page" : undefined}
            onClick={() => setIsSidebarOpen(false)}
          >
            <Icon name="user" size={18} /><span>My Profile</span>
          </Link>
        </nav>

        {/* User chip + POPIA + logout */}
        <div className="space-y-2 border-t border-[var(--border)] p-3">
          {/* User chip */}
          <div className="flex items-center gap-3 rounded-xl bg-[var(--background)] px-2 py-2">
            <div
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white"
              style={{ background: `linear-gradient(135deg,${accent},#059669)` }}
            >
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-[var(--foreground)]">{user.firstName} {user.lastName}</p>
              <p className="text-[10px] font-medium" style={{ color: accent }}>{user.role}</p>
            </div>
          </div>

          {/* POPIA badge */}
          <div className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: 'rgba(13,148,136,0.07)' }}>
            <Icon name="lock" size={12} />
            <span className="text-[10px] font-semibold text-[var(--muted)]">POPIA Compliant · Encrypted</span>
          </div>

          <button
            type="button"
            onClick={() => { void logout(); }}
            className="nav-link flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-[var(--muted)] hover:bg-red-50 hover:text-red-600"
            aria-label="Log out"
          >
            <Icon name="log-out" size={16} /><span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-x-hidden" id="main-content" aria-label="Main content">
        {/* Mobile Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--border)] bg-white px-4 py-3 lg:hidden">
          <button
            className="p-2 text-[var(--muted)]"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Icon name="menu" size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div
              className="flex h-6 w-6 items-center justify-center rounded-md text-white"
              style={{ background: `linear-gradient(135deg,${accent},#059669)` }}
            >
              <Icon name="stethoscope" size={12} />
            </div>
            <span className="text-xs font-bold text-[var(--foreground)]">Ahava</span>
          </div>
          <div className="w-8" /> {/* Spacer for alignment */}
        </header>
        {showOnboardingReminder && !pathname.startsWith("/profile") && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-2.5 text-[13px]"
            style={{ background: "#eff6ff", borderColor: "#bfdbfe" }}
          >
            <span className="flex items-center gap-2" style={{ color: "#1e3a8a" }}>
              <Icon name="stethoscope" size={16} />
              <span><strong>Finish your medical passport</strong> ({passportCompletionPercent}% complete) to improve personalised risk surveillance.</span>
            </span>
            <Link
              href="/profile"
              className="rounded-[7px] px-3 py-1.5 text-xs font-bold text-white no-underline"
              style={{ background: "#2563eb" }}
            >
              Complete Passport
            </Link>
          </div>
        )}
        {showVerifyBanner && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-2.5 text-[13px]" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
            <span className="flex items-center gap-2" style={{ color: '#92400e' }}>
              <Icon name="mail" size={16} />
              <span><strong>Verify your email</strong> — check your inbox for a verification link to activate all features.</span>
            </span>
            <div className="flex shrink-0 items-center gap-2">
              {resendSent ? (
                <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: '#059669' }}>
                  <Icon name="check" size={12} /> Email sent!
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resendLoading}
                    className="rounded-[7px] border-none px-3 py-1.5 text-xs font-bold text-white disabled:opacity-70"
                    style={{ background: '#f59e0b', cursor: resendLoading ? 'not-allowed' : 'pointer' }}
                  >
                    {resendLoading ? 'Sending…' : 'Resend email'}
                  </button>
                  <button
                    type="button"
                    onClick={handleManualVerify}
                    disabled={resendLoading}
                    className="rounded-[7px] border px-2.5 py-1 text-[11px] font-bold"
                    style={{ background: 'white', borderColor: '#d97706', color: '#d97706', cursor: resendLoading ? 'not-allowed' : 'pointer' }}
                  >
                    Verify Now (Trial)
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setVerifyBannerDismissed(true)}
                aria-label="Dismiss"
                className="border-none bg-transparent px-1 leading-none"
                style={{ color: '#a16207', cursor: 'pointer' }}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
