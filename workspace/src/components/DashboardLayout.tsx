"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";

/**
 * Dashboard layout: sidebar + main content.
 * Same behaviour as NavBar (role-based link, logout, user); presentation only (Phase 1).
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout, isAuthenticated } = useAuth();
  const pathname = usePathname();

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

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      {/* Sidebar – design tokens, primary for active state */}
      <aside
        className="flex w-56 flex-col border-r bg-white"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex h-14 items-center px-4 border-b" style={{ borderColor: "var(--border)" }}>
          <Link
            href={dashboardPath}
            className="text-lg font-bold tracking-tight text-[var(--foreground)]"
            aria-label="Ahava Healthcare home"
          >
            Ahava Healthcare
          </Link>
        </div>
        <nav className="flex-1 p-3" aria-label="Dashboard navigation">
          <Link
            href={dashboardPath}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              pathname === dashboardPath
                ? "bg-[var(--primary)] text-white"
                : "text-[var(--muted)] hover:bg-slate-100 hover:text-[var(--foreground)]"
            }`}
            aria-current={pathname === dashboardPath ? "page" : undefined}
          >
            <span aria-hidden>◉</span>
            {getDashboardLabel()}
          </Link>
          {user.role === "PATIENT" && (
            <>
              <Link
                href="/patient/early-warning"
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition mt-1 ${
                  pathname === "/patient/early-warning"
                    ? "bg-[var(--primary)] text-white"
                    : "text-[var(--muted)] hover:bg-slate-100 hover:text-[var(--foreground)]"
                }`}
                aria-current={pathname === "/patient/early-warning" ? "page" : undefined}
              >
                <span aria-hidden>⚠</span>
                Early Warning
              </Link>
              <Link
                href="/patient/ai-doctor"
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition mt-1 ${
                  pathname === "/patient/ai-doctor"
                    ? "bg-[var(--primary)] text-white"
                    : "text-[var(--muted)] hover:bg-slate-100 hover:text-[var(--foreground)]"
                }`}
                aria-current={pathname === "/patient/ai-doctor" ? "page" : undefined}
              >
                <span aria-hidden>🩺</span>
                AI Doctor
              </Link>
            </>
          )}
        </nav>
        <div
          className="border-t p-3"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="truncate px-3 py-1 text-xs font-medium text-[var(--muted)]">
            {user.firstName} {user.lastName}
          </p>
          <p className="truncate px-3 text-xs text-[var(--muted)]">{user.role}</p>
          <button
            type="button"
            onClick={() => logout()}
            className="mt-2 w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--muted)] hover:bg-slate-100 hover:text-[var(--foreground)]"
            aria-label="Log out"
          >
            Logout
          </button>
        </div>
      </aside>
      {/* Main content */}
      <main className="flex-1 overflow-auto" id="main-content" aria-label="Main content">
        {children}
      </main>
    </div>
  );
}
