import { useEffect, useState } from "react";
import { useAuth, getAuthHeaders } from "@/react-app/lib/auth-context";
import { useNavigate } from "react-router";
import DashboardLayout from "@/react-app/components/DashboardLayout";
import { getApiBase } from "@/react-app/lib/native";

interface Profile {
  full_name: string;
  role: string;
  sanc_id: string;
}

interface DiagnosticReport {
  id: number;
  patient_id: string;
  report_type: string;
  ai_analysis: string;
  ai_confidence: number;
  symptoms: string;
  doctor_notes: string;
  diagnosis: string;
  recommendations: string;
  is_released: number;
  created_at: string;
}

export default function DoctorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reports, setReports] = useState<DiagnosticReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<DiagnosticReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [reviewData, setReviewData] = useState({
    doctor_notes: "",
    diagnosis: "",
    recommendations: "",
  });

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    if (profile) {
      loadReports();
    }
  }, [profile, filter]);

  const loadProfile = async () => {
    const base = getApiBase();
    const headers = getAuthHeaders();
    try {
      const response = await fetch(`${base}/api/profile`, { headers });
      const data = await response.json();

      if (data.profile?.role !== "DOCTOR") {
        navigate("/onboarding");
        return;
      }

      setProfile(data.profile);
    } catch (error) {
      console.error("Failed to load profile:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadReports = async () => {
    const base = getApiBase();
    const headers = getAuthHeaders();
    try {
      const response = await fetch(`${base}/api/diagnostic-reports?status=${filter}`, { headers });
      const data = await response.json();
      setReports(data.reports || []);
    } catch (error) {
      console.error("Failed to load reports:", error);
    }
  };

  const selectReport = (report: DiagnosticReport) => {
    setSelectedReport(report);
    setReviewData({
      doctor_notes: report.doctor_notes || "",
      diagnosis: report.diagnosis || "",
      recommendations: report.recommendations || "",
    });
  };

  const handleReview = async () => {
    if (!selectedReport) return;
    const base = getApiBase();
    const headers = { ...getAuthHeaders(), "Content-Type": "application/json" };
    try {
      await fetch(`${base}/api/diagnostic-reports/${selectedReport.id}/review`, {
        method: "POST", headers, body: JSON.stringify(reviewData),
      });
      loadReports();
      setSelectedReport(null);
    } catch (error) {
      console.error("Failed to submit review:", error);
    }
  };

  const handleRelease = async () => {
    if (!selectedReport) return;
    if (!reviewData.doctor_notes || !reviewData.diagnosis) {
      alert("Please complete your review before releasing the report to the patient.");
      return;
    }
    const base = getApiBase();
    const headers = getAuthHeaders();
    try {
      await fetch(`${base}/api/diagnostic-reports/${selectedReport.id}/release`, {
        method: "POST", headers,
      });
      loadReports();
      setSelectedReport(null);
      setReviewData({ doctor_notes: "", diagnosis: "", recommendations: "" });
    } catch (error) {
      console.error("Failed to release report:", error);
    }
  };

  const firstName = user?.firstName || profile?.full_name?.split(" ")[0] || "Doctor";

  if (isLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2" style={{ borderColor: "var(--doctor)" }} />
      </div>
    );
  }

  const pendingCount = reports.filter(r => r.is_released !== 1).length;

  return (
    <DashboardLayout>
      {/* ── HERO ── */}
      <div className="hero-card header-DOCTOR" style={{ position: "relative", zIndex: 1 }}>
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>Dr. {firstName}</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>Triage &amp; Diagnostic Review</div>
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>Review AI-generated reports and provide expert oversight</div>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1 }}>{pendingCount}</div>
              <div style={{ fontSize: 11, opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.05em" }}>Pending</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1 }}>{reports.length}</div>
              <div style={{ fontSize: 11, opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── FILTER TABS ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["pending", "all"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "8px 18px", borderRadius: 8, fontWeight: 600, fontSize: 13,
              cursor: "pointer", border: "1.5px solid", fontFamily: "inherit",
              background: filter === f ? "var(--doctor)" : "var(--surface)",
              color: filter === f ? "white" : "var(--text-muted)",
              borderColor: filter === f ? "var(--doctor)" : "var(--border)",
              transition: "all 0.18s",
            }}
          >
            {f === "pending" ? `Pending (${pendingCount})` : "All Reports"}
          </button>
        ))}
      </div>

      {/* ── MAIN GRID ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* ── TRIAGE LIST ── */}
        <div className="dash-card" style={{ overflowY: "auto", maxHeight: 700 }}>
          <div className="card-section-title">⚕️ {filter === "pending" ? "Pending Reports" : "All Reports"}</div>
          {reports.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)", fontSize: 13 }}>
              📋 {filter === "pending" ? "No pending reports" : "No reports found"}
            </div>
          ) : (
            reports.map((report) => (
              <div
                key={report.id}
                onClick={() => selectReport(report)}
                className={`triage-case-card${selectedReport?.id === report.id ? " selected" : ""}`}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{report.report_type}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>👤 Patient {report.patient_id.slice(0, 8)}…</div>
                    {report.symptoms && (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {report.symptoms}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                    {report.is_released === 1 ? (
                      <span style={{ background: "#dcfce7", color: "#16a34a", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>✓ Released</span>
                    ) : (
                      <span style={{ background: "#fff7ed", color: "#d97706", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>⏳ Pending</span>
                    )}
                    {report.ai_confidence && (
                      <span style={{ background: "#eff6ff", color: "var(--primary)", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                        AI {(report.ai_confidence * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 8 }}>{new Date(report.created_at).toLocaleString("en-ZA")}</div>
              </div>
            ))
          )}
        </div>

        {/* ── REVIEW PANEL ── */}
        <div className="dash-card">
          {selectedReport ? (
            <>
              <div className="card-section-title">📋 Report Details</div>

              {/* AI Panel */}
              <div className="ai-panel" style={{ marginBottom: 18 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--primary)", marginBottom: 10 }}>🤖 AI Analysis</div>
                {selectedReport.symptoms && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Symptoms</div>
                    <div style={{ fontSize: 13, color: "#1e40af" }}>{selectedReport.symptoms}</div>
                  </div>
                )}
                {selectedReport.ai_analysis && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>AI Findings</div>
                    <div style={{ fontSize: 13, color: "#1e40af" }}>{selectedReport.ai_analysis}</div>
                  </div>
                )}
                {selectedReport.ai_confidence && (
                  <div style={{ fontSize: 12, color: "var(--primary)", marginTop: 6, fontWeight: 600 }}>
                    Confidence: {(selectedReport.ai_confidence * 100).toFixed(1)}%
                  </div>
                )}
              </div>

              {/* Review form */}
              {[{ label: "Doctor's Notes *", key: "doctor_notes", placeholder: "Clinical assessment and observations…" },
                { label: "Diagnosis *", key: "diagnosis", placeholder: "Final diagnosis…" },
                { label: "Recommendations", key: "recommendations", placeholder: "Treatment plan and follow-up…" }]
                .map(({ label, key, placeholder }) => (
                  <div key={key} style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>{label}</label>
                    <textarea
                      value={(reviewData as any)[key]}
                      onChange={(e) => setReviewData({ ...reviewData, [key]: e.target.value })}
                      rows={3}
                      placeholder={placeholder}
                      style={{ width: "100%", padding: "10px 14px", border: "1.5px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13, fontFamily: "inherit", resize: "none", outline: "none", color: "var(--text)", background: "var(--surface)", transition: "border 0.18s" }}
                      onFocus={(e) => (e.target.style.borderColor = "var(--doctor)")}
                      onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
                    />
                  </div>
                ))
              }

              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <button
                  onClick={handleReview}
                  style={{ flex: 1, padding: "10px 0", background: "var(--bg)", color: "var(--text)", border: "1.5px solid var(--border)", borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}
                >
                  Save Review
                </button>
                <button
                  onClick={handleRelease}
                  disabled={selectedReport.is_released === 1}
                  style={{ flex: 1, padding: "10px 0", background: selectedReport.is_released === 1 ? "var(--border)" : "var(--doctor)", color: "white", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: selectedReport.is_released === 1 ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                >
                  {selectedReport.is_released === 1 ? "✓ Released" : "Release to Patient"}
                </button>
              </div>

              {selectedReport.is_released === 1 && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, fontSize: 13, color: "#15803d", textAlign: "center", fontWeight: 600 }}>
                  ✓ This report has been released to the patient
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, color: "var(--text-muted)", fontSize: 13 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
              Select a case from the queue to review
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
