import { useEffect, useState } from "react";
import { getAuthHeaders } from "@/react-app/lib/auth-context";
import { useNavigate } from "react-router-dom";
import { getApiBase } from "@/react-app/lib/native";
import DashboardLayout from "@/react-app/components/DashboardLayout";

interface DiagnosticReport {
  id: number;
  report_type: string;
  symptoms: string;
  ai_analysis: string;
  ai_confidence: number;
  doctor_notes: string;
  diagnosis: string;
  recommendations: string;
  released_at: string;
  created_at: string;
}

export default function DiagnosticVault() {
  const navigate = useNavigate();
  const [reports, setReports] = useState<DiagnosticReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<DiagnosticReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    const base = getApiBase();
    const headers = getAuthHeaders();
    try {
      const response = await fetch(`${base}/api/patient/diagnostic-reports`, { headers });
      const data = await response.json() as any;
      setReports(data.reports || []);
    } catch (error) {
      console.error("Failed to load reports:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2" style={{ borderColor: "var(--primary)" }} />
      </div>
    );
  }

  return (
    <DashboardLayout>
      {/* ── HERO ── */}
      <div className="hero-card header-PATIENT" style={{ position: "relative", zIndex: 1 }}>
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <button
              onClick={() => navigate("/patient/dashboard")}
              style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "white", borderRadius: 8, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 10, fontFamily: "inherit" }}
            >
              ← Back to Dashboard
            </button>
            <div style={{ fontSize: 22, fontWeight: 800 }}>📁 Diagnostic Vault</div>
            <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>Your medical reports reviewed by licensed professionals</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1 }}>{reports.length}</div>
            <div style={{ fontSize: 11, opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.05em" }}>Reports</div>
          </div>
        </div>
      </div>

      {/* ── DISCLAIMER ── */}
      <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "var(--radius)", padding: "14px 18px", marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ fontSize: 20, flexShrink: 0 }}>⚠️</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#78350f", marginBottom: 2 }}>Medical Disclaimer</div>
          <div style={{ fontSize: 12, color: "#92400e" }}>
            All reports have been reviewed by licensed professionals and are for informational purposes only. Always consult your healthcare provider for treatment decisions.
          </div>
        </div>
      </div>

      {!selectedReport ? (
        /* ── REPORT LIST ── */
        reports.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {reports.map((report) => (
              <div
                key={report.id}
                className="vault-card"
                onClick={() => setSelectedReport(report)}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                      <div style={{ fontSize: 28 }}>📋</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{report.report_type}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                          Released {new Date(report.released_at).toLocaleDateString("en-ZA")}
                          {report.ai_confidence && (
                            <span style={{ marginLeft: 12, background: "#eff6ff", color: "var(--primary)", padding: "1px 8px", borderRadius: 20, fontWeight: 600 }}>
                              🤖 AI {(report.ai_confidence * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {report.diagnosis && (
                      <div className="ai-panel" style={{ padding: "10px 14px" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Diagnosis</div>
                        <div style={{ fontSize: 13, color: "#1e40af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{report.diagnosis}</div>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 18, color: "var(--text-light)", flexShrink: 0 }}>›</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="dash-card" style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>No Reports Yet</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 360, margin: "0 auto 20px" }}>
              When you request a symptom analysis, it will be reviewed by a doctor and appear here once released.
            </div>
            <button
              onClick={() => navigate("/patient/dashboard")}
              style={{ background: "var(--primary)", color: "white", border: "none", borderRadius: 8, padding: "10px 24px", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}
            >
              Go to Dashboard
            </button>
          </div>
        )
      ) : (
        /* ── REPORT DETAIL ── */
        <div className="dash-card">
          <button
            onClick={() => setSelectedReport(null)}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: 16, padding: 0, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}
          >
            ← Back to Reports
          </button>

          <div className="hero-card header-PATIENT" style={{ marginBottom: 20 }}>
            <div style={{ position: "relative", zIndex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{selectedReport.report_type}</div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>
                Released: {new Date(selectedReport.released_at).toLocaleDateString("en-ZA")}
                {selectedReport.ai_confidence && (
                  <span style={{ marginLeft: 14 }}>🤖 AI Confidence: {(selectedReport.ai_confidence * 100).toFixed(0)}%</span>
                )}
              </div>
            </div>
          </div>

          {[
            { key: "symptoms",       icon: "🩺", label: "Reported Symptoms",      bg: "#f8fafc", border: "#e2e8f0" },
            { key: "ai_analysis",   icon: "🤖", label: "AI Preliminary Analysis", bg: "#eff6ff", border: "#bfdbfe" },
            { key: "diagnosis",     icon: "📋", label: "Doctor's Diagnosis",      bg: "#eff6ff", border: "#bfdbfe" },
            { key: "doctor_notes",  icon: "👨‍⚕️", label: "Doctor's Notes",         bg: "#f0fdfa", border: "#99f6e4" },
            { key: "recommendations", icon: "💊", label: "Recommendations",       bg: "#f0fdf4", border: "#bbf7d0" },
          ].map(({ key, icon, label, bg, border }) => {
            const val = (selectedReport as any)[key];
            if (!val) return null;
            return (
              <div key={key} style={{ marginBottom: 18 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <span>{icon}</span>{label}
                </div>
                <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: "var(--radius)", padding: "14px 16px", fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                  {val}
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
            Created {new Date(selectedReport.created_at).toLocaleDateString("en-ZA")} · Released {new Date(selectedReport.released_at).toLocaleDateString("en-ZA")}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
