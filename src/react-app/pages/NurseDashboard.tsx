import { useEffect, useState } from "react";
import { useAuth, getAuthHeaders } from "@/react-app/lib/auth-context";
import { useNavigate } from "react-router";
import DashboardLayout from "@/react-app/components/DashboardLayout";
import PanicButton from "../components/PanicButton";
import { getApiBase } from "@/react-app/lib/native";

interface Profile {
  full_name: string;
  role: string;
  is_online: number;
  sanc_id: string;
  is_verified: number;
}

interface Appointment {
  id: number;
  patient_id: string;
  service_type: string;
  patient_address: string;
  notes: string;
  status: string;
  created_at: string;
}

export default function NurseDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [nearbyRequests, setNearbyRequests] = useState<Appointment[]>([]);

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    if (isOnline && profile?.is_verified === 1) {
      loadNearbyRequests();
      const interval = setInterval(loadNearbyRequests, 10000); // Refresh every 10 seconds
      return () => clearInterval(interval);
    }
  }, [isOnline, profile]);

  const loadProfile = async () => {
    const base = getApiBase();
    const headers = getAuthHeaders();
    try {
      const response = await fetch(`${base}/api/profile`, { headers });
      const data = await response.json() as any;
      if (data.profile?.role !== "NURSE") { navigate("/onboarding"); return; }
      setProfile(data.profile);
      setIsOnline(data.profile.is_online === 1);
    } catch (error) {
      console.error("Failed to load profile:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadNearbyRequests = async () => {
    const base = getApiBase();
    const headers = getAuthHeaders();
    try {
      const response = await fetch(`${base}/api/appointments/nearby`, { headers });
      const data = await response.json() as any;
      setNearbyRequests(data.appointments || []);
    } catch (error) {
      console.error("Failed to load requests:", error);
    }
  };

  const acceptAppointment = async (appointmentId: number) => {
    const base = getApiBase();
    const headers = getAuthHeaders();
    try {
      await fetch(`${base}/api/appointments/${appointmentId}/accept`, { method: "POST", headers });
      loadNearbyRequests();
    } catch (error) {
      console.error("Failed to accept appointment:", error);
    }
  };

  const toggleAvailability = async () => {
    const base = getApiBase();
    const headers = { ...getAuthHeaders(), "Content-Type": "application/json" };
    try {
      const newStatus = !isOnline;
      await fetch(`${base}/api/nurse/availability`, {
        method: "POST", headers,
        body: JSON.stringify({ is_online: newStatus }),
      });
      setIsOnline(newStatus);
    } catch (error) {
      console.error("Failed to update availability:", error);
    }
  };

  const firstName = user?.firstName || profile?.full_name?.split(" ")[0] || "Nurse";

  if (isLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2" style={{ borderColor: "var(--nurse)" }} />
      </div>
    );
  }

  return (
    <DashboardLayout>
      {/* ── HERO ── */}
      <div className="hero-card header-NURSE" style={{ position: "relative", zIndex: 1 }}>
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>Welcome, {firstName} 👋</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>Nurse Dashboard</div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {isOnline ? (
                <span className="pulse-alert" style={{ background: "rgba(255,255,255,0.25)", color: "white", padding: "6px 14px", borderRadius: 30, fontWeight: 700, fontSize: 13 }}>
                  🟢 Online — Accepting Requests
                </span>
              ) : (
                <span style={{ background: "rgba(0,0,0,0.2)", color: "white", padding: "6px 14px", borderRadius: 30, fontWeight: 700, fontSize: 13 }}>
                  ⚫ Offline
                </span>
              )}
              {profile?.sanc_id && <span style={{ fontSize: 12, opacity: 0.8 }}>SANC: {profile.sanc_id}</span>}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1 }}>{nearbyRequests.length}</div>
            <div style={{ fontSize: 11, opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.05em" }}>Requests</div>
          </div>
        </div>
      </div>

      {/* ── TOP ROW: PANIC + AVAILABILITY ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
        <div className="dash-card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 32 }}>🚨</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Emergency Panic</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>Alert control centre immediately</div>
            <PanicButton />
          </div>
        </div>
        <div
          className={`availability-toggle${isOnline ? " online" : ""}`}
          onClick={toggleAvailability}
          style={{ justifyContent: "space-between" }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: isOnline ? "var(--nurse)" : "var(--text)" }}>
              {isOnline ? "You're Online" : "You're Offline"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
              {isOnline ? "Receiving appointment requests" : "Toggle to start receiving requests"}
            </div>
          </div>
          <div className={`toggle-track${isOnline ? " on" : ""}`}>
            <div className="toggle-knob" />
          </div>
        </div>
      </div>

      {/* ── VERIFICATION WARNING ── */}
      {profile?.is_verified === 0 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "var(--radius)", padding: "14px 18px", marginBottom: 20, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 24 }}>⚠️</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#78350f" }}>SANC Verification Pending</div>
            <div style={{ fontSize: 13, color: "#92400e", marginTop: 2 }}>
              Registration <strong>{profile?.sanc_id}</strong> is being verified. Appointments unlock after verification.
            </div>
          </div>
        </div>
      )}

      {/* ── VISIT WORKFLOW ── */}
      <div className="dash-card" style={{ marginBottom: 20 }}>
        <div className="card-section-title">📍 Visit Workflow</div>
        <div className="visit-steps">
          {["Dispatched", "En Route", "On Site", "Treating", "Complete"].map((step, i) => (
            <div key={step} className={`visit-step${i === 0 ? " done" : i === 1 ? " active" : ""}`}>
              <div className="step-dot">{i < 1 ? "✓" : i + 1}</div>
              <div className="step-label">{step}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, textAlign: "center" }}>
          No active visit — go online to accept requests
        </div>
      </div>

      {/* ── REQUESTS + STATS ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="dash-card">
          <div className="card-section-title">📊 Your Stats</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { icon: "👤", label: "Total Patients", value: "0" },
              { icon: "✅", label: "Completed Visits", value: "0" },
              { icon: "📍", label: "Service Radius", value: "5 km" },
              { icon: "⭐", label: "Rating", value: "—" },
            ].map(({ icon, label, value }) => (
              <div key={label} style={{ background: "var(--bg)", borderRadius: 10, padding: "14px", textAlign: "center" }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="dash-card" style={{ overflowY: "auto", maxHeight: 400 }}>
          <div className="card-section-title">🏥 Active Requests</div>
          {profile?.is_verified === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "28px 0", fontSize: 13 }}>Complete verification to see requests</div>
          ) : !isOnline ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "28px 0", fontSize: 13 }}>Toggle availability on to see requests</div>
          ) : nearbyRequests.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "28px 0", fontSize: 13 }}>No active requests in your area</div>
          ) : (
            nearbyRequests.map((request) => (
              <div key={request.id} style={{ background: "var(--bg)", borderRadius: "var(--radius)", padding: "14px", marginBottom: 12, border: "1.5px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{request.service_type.replace(/_/g, " ")}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>📍 {request.patient_address}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-light)", whiteSpace: "nowrap" }}>{new Date(request.created_at).toLocaleTimeString("en-ZA")}</div>
                </div>
                {request.notes && (
                  <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 10 }}>"{request.notes}"</div>
                )}
                <button
                  onClick={() => acceptAppointment(request.id)}
                  style={{ width: "100%", padding: "9px 0", background: "var(--nurse)", color: "white", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
                >
                  Accept Appointment
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
