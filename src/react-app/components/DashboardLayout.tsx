import { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "@/react-app/lib/auth-context";

interface NavItem {
  icon: string;
  label: string;
  path: string;
}

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  PATIENT: [
    { icon: "📊", label: "Dashboard",        path: "/patient/dashboard" },
    { icon: "📁", label: "Diagnostic Vault", path: "/vault" },
    { icon: "💳", label: "Payments",         path: "/payment" },
  ],
  NURSE: [
    { icon: "🏥", label: "Dashboard",     path: "/nurse/dashboard" },
    { icon: "📍", label: "Active Visit",  path: "/live-visit" },
  ],
  DOCTOR: [
    { icon: "⚕️", label: "Triage Queue",  path: "/doctor/dashboard" },
  ],
  ADMIN: [
    { icon: "⚙️", label: "Dashboard",    path: "/admin/dashboard" },
    { icon: "💳", label: "Payments",     path: "/payment" },
  ],
};

const ROLE_ICONS: Record<string, string> = {
  PATIENT: "👤",
  NURSE:   "🏥",
  DOCTOR:  "⚕️",
  ADMIN:   "⚙️",
};

interface Props {
  children: ReactNode;
  title?: string;
  subtitle?: string;
}

export default function DashboardLayout({ children, title, subtitle }: Props) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const role  = user?.role ?? "PATIENT";
  const items = NAV_BY_ROLE[role] ?? [];
  const initials = user
    ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() || user.email[0].toUpperCase()
    : "?";

  return (
    <div className="app-shell">
      {/* ── SIDEBAR ── */}
      <nav className="sidebar">
        <div className="sidebar-logo">
          <img
            src="https://019beed4-58f9-79ea-8acd-d59b2c121f81.mochausercontent.com/Ahava-on-88-logo.png"
            alt="Ahava"
            style={{ height: 28 }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
          <span className="sidebar-logo-text">Ahava Healthcare</span>
        </div>

        <div className={`sidebar-role-badge role-${role}`}>
          <span>{ROLE_ICONS[role]}</span>
          <span>{role.charAt(0) + role.slice(1).toLowerCase()}</span>
        </div>

        <div className="nav-items">
          {items.map((item) => (
            <div
              key={item.path}
              className={`nav-item${location.pathname === item.path ? " active" : ""}`}
              onClick={() => navigate(item.path)}
            >
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {user?.firstName} {user?.lastName}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {user?.email}
              </div>
            </div>
          </div>

          <div className="popia-badge">🔒 POPIA Compliant</div>

          <button
            onClick={logout}
            style={{
              background: "transparent", border: "1.5px solid var(--border)",
              borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600,
              color: "var(--text-muted)", cursor: "pointer", transition: "all 0.18s",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.background = "var(--bg)"; (e.target as HTMLButtonElement).style.color = "var(--text)"; }}
            onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.background = "transparent"; (e.target as HTMLButtonElement).style.color = "var(--text-muted)"; }}
          >
            Logout
          </button>
        </div>
      </nav>

      {/* ── MAIN ── */}
      <main className="main-content">
        {(title || subtitle) && (
          <div style={{ marginBottom: 22 }}>
            {title   && <div style={{ fontSize: 22, fontWeight: 700 }}>{title}</div>}
            {subtitle && <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
