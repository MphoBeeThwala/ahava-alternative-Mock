import { useEffect, useState, useRef } from "react";
import { useAuth, getAuthHeaders } from "@/react-app/lib/auth-context";
import { useNavigate } from "react-router-dom";
import { Chart, registerables } from "chart.js";
import DashboardLayout from "@/react-app/components/DashboardLayout";
import RequestNurseModal from "@/react-app/components/RequestNurseModal";
import SymptomAnalysisModal from "@/react-app/components/SymptomAnalysisModal";
import BaselineModal from "@/react-app/components/BaselineModal";
import WearableConnectCard from "@/react-app/components/WearableConnectCard";
import { getApiBase } from "@/react-app/lib/native";

Chart.register(...registerables);

interface Profile {
  full_name: string;
  role: string;
  phone_number: string;
  address: string;
  passport_completion_percent?: number;
  next_profile_question?: string | null;
  should_remind_profile_completion?: boolean;
}

interface Biometric {
  id: number;
  type: string;
  value: number;
  recorded_at: string;
}

interface Baseline {
  hr_baseline_mean: number | null;
  hrv_baseline_mean: number | null;
  spo2_baseline_mean: number | null;
  is_complete: number;
  updated_at: string;
}

/** Typical population std-dev used to estimate sigma when baseline only has mean */
const STD: Record<string, number> = { HR: 8, HRV: 15, SPO2: 1.5, RESP: 2.5 };

function getSigma(type: string, value: number, mean: number | null): number | null {
  if (mean === null || mean === undefined) return null;
  const std = STD[type];
  if (!std) return null;
  return Math.round(((value - mean) / std) * 10) / 10;
}

function sigmaClass(sigma: number | null): string {
  if (sigma === null) return "";
  if (Math.abs(sigma) >= 2) return "sigma-red";
  if (Math.abs(sigma) >= 1) return "sigma-yellow";
  return "sigma-green";
}

function sigmaLabel(type: string, sigma: number | null): string {
  if (sigma === null) return "No baseline";
  const dir = sigma > 0 ? "↑" : "↓";
  return `${dir} ${Math.abs(sigma)}σ from baseline`;
}

export default function PatientDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const chartRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstance = useRef<Chart | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [biometrics, setBiometrics] = useState<Biometric[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [showBaselineModal, setShowBaselineModal] = useState(false);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [reportCount, setReportCount] = useState(0);

  useEffect(() => {
    loadDashboardData();
  }, []);

  useEffect(() => {
    if (biometrics.length > 0) buildChart();
    return () => { chartInstance.current?.destroy(); };
  }, [biometrics]);

  const buildChart = () => {
    if (!chartRef.current) return;
    chartInstance.current?.destroy();
    const hrPoints  = biometrics.filter(b => b.type === "HR").slice(-14).reverse();
    const labels    = hrPoints.map((_, i) => `Day ${i + 1}`);
    const hrValues  = hrPoints.map(b => b.value);
    chartInstance.current = new Chart(chartRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Heart Rate (bpm)",
          data: hrValues,
          borderColor: "#dc2626",
          backgroundColor: "rgba(220,38,38,0.08)",
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 3,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: "#1e293b", titleFont: { family: "DM Sans" }, bodyFont: { family: "DM Sans" } },
        },
        scales: {
          x: { grid: { color: "#f1f5f9" }, ticks: { font: { family: "DM Sans", size: 11 }, maxTicksLimit: 7 } },
          y: { grid: { color: "#f1f5f9" }, ticks: { font: { family: "DM Sans", size: 11 } } },
        },
      },
    });
  };

  const loadDashboardData = async () => {
    const headers = { ...getAuthHeaders() };
    try {
      const base = getApiBase();
      const [profileRes, biometricsRes, baselineRes, reportsRes] = await Promise.all([
        fetch(`${base}/api/profile`, { headers }),
        fetch(`${base}/api/biometrics?limit=20`, { headers }),
        fetch(`${base}/api/baseline`, { headers }),
        fetch(`${base}/api/patient/diagnostic-reports`, { headers }),
      ]);

      const profileData = await profileRes.json();
      const biometricsData = await biometricsRes.json();
      const baselineData = await baselineRes.json();
      const reportsData = await reportsRes.json();

      if (profileData.profile?.role !== "PATIENT") {
        navigate("/onboarding");
        return;
      }

      setProfile(profileData.profile);
      setBiometrics(biometricsData.biometrics || []);
      setBaseline(baselineData.baseline);
      setReportCount(reportsData.reports?.length || 0);
    } catch (error) {
      console.error("Failed to load dashboard:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getLatestBiometric = (type: string) => {
    return biometrics.find((b) => b.type === type);
  };

  const hrData = getLatestBiometric("HR");
  const spo2Data = getLatestBiometric("SPO2");
  const hrvData = getLatestBiometric("HRV");

  const firstName = user?.firstName || profile?.full_name?.split(" ")[0] || "there";

  const hrSigma   = hrData   ? getSigma("HR",   hrData.value,   baseline?.hr_baseline_mean ?? null)  : null;
  const hrvSigma  = hrvData  ? getSigma("HRV",  hrvData.value,  baseline?.hrv_baseline_mean ?? null) : null;
  const spo2Sigma = spo2Data ? getSigma("SPO2", spo2Data.value, baseline?.spo2_baseline_mean ?? null): null;

  const alertLevel =
    [hrSigma, hrvSigma, spo2Sigma].some(s => s !== null && Math.abs(s) >= 2)
      ? "RED"
      : [hrSigma, hrvSigma, spo2Sigma].some(s => s !== null && Math.abs(s) >= 1)
      ? "YELLOW"
      : "GREEN";

  if (isLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-[#004aad]" />
      </div>
    );
  }

  return (
    <DashboardLayout>
      {/* ── HERO CARD ── */}
      <div className={`hero-card header-PATIENT`} style={{ position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16, position: "relative", zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>Good day, {firstName} 👋</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>Health Status Overview</div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {alertLevel === "RED" && (
                <span className="pulse-alert" style={{ background: "#dc2626", color: "white", padding: "6px 14px", borderRadius: 30, fontWeight: 700, fontSize: 13 }}>
                  🔴 Biometric Alert — Check readings
                </span>
              )}
              {alertLevel === "YELLOW" && (
                <span style={{ background: "#d97706", color: "white", padding: "6px 14px", borderRadius: 30, fontWeight: 700, fontSize: 13 }}>
                  🟡 Mild deviation from baseline
                </span>
              )}
              {alertLevel === "GREEN" && (
                <span style={{ background: "rgba(255,255,255,0.2)", color: "white", padding: "6px 14px", borderRadius: 30, fontWeight: 700, fontSize: 13 }}>
                  ✅ All readings normal
                </span>
              )}
              {baseline?.is_complete ? (
                <span style={{ fontSize: 12, opacity: 0.8 }}>✓ Baseline active</span>
              ) : (
                <span style={{ fontSize: 12, opacity: 0.7 }}>⚠ No baseline yet</span>
              )}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 36, fontWeight: 900, color: "white", lineHeight: 1 }}>{biometrics.length}</div>
            <div style={{ fontSize: 11, opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.05em" }}>Readings</div>
          </div>
        </div>
      </div>

      {/* ── QUICK ACTIONS ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 22 }}>
        <button
          onClick={() => setShowAnalysisModal(true)}
          style={{ background: "var(--doctor)", color: "white", border: "none", borderRadius: "var(--radius)", padding: "14px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
        >
          <div style={{ fontSize: 22, marginBottom: 6 }}>🤖</div>
          AI Symptom Analysis
        </button>
        <button
          onClick={() => setShowRequestModal(true)}
          style={{ background: "var(--nurse)", color: "white", border: "none", borderRadius: "var(--radius)", padding: "14px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
        >
          <div style={{ fontSize: 22, marginBottom: 6 }}>🏥</div>
          Request a Nurse
        </button>
        <button
          onClick={() => navigate("/vault")}
          style={{ background: "var(--surface)", color: "var(--text)", border: "1.5px solid var(--border)", borderRadius: "var(--radius)", padding: "14px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer", textAlign: "left", fontFamily: "inherit", boxShadow: "var(--shadow)" }}
        >
          <div style={{ fontSize: 22, marginBottom: 6 }}>📁</div>
          Diagnostic Vault {reportCount > 0 && <span style={{ fontSize: 12, background: "#eff6ff", color: "var(--primary)", borderRadius: 20, padding: "2px 8px", marginLeft: 6 }}>{reportCount}</span>}
        </button>
      </div>

      {profile?.should_remind_profile_completion && (
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "var(--radius)", padding: "14px 16px", marginBottom: 18 }}>
          <div style={{ fontWeight: 700, color: "#1e40af", fontSize: 14 }}>
            Complete your medical passport ({profile.passport_completion_percent ?? 0}%)
          </div>
          <div style={{ color: "#1d4ed8", fontSize: 13, marginTop: 4 }}>
            {profile.next_profile_question || "Add a bit more profile info for better future triage and care continuity."}
          </div>
          <div style={{ color: "#1d4ed8", fontSize: 12, marginTop: 6 }}>
            You can keep using Ahava normally while completing this over time.
          </div>
        </div>
      )}

      {/* ── BIOMETRIC CARDS ── */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
        Real-time Biometrics
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 22 }}>
        {/* Heart Rate */}
        <div className="biometric-card">
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Heart Rate</div>
          {hrData ? (
            <>
              <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1, margin: "6px 0 4px", color: hrSigma !== null && Math.abs(hrSigma) >= 2 ? "#dc2626" : "var(--text)" }}>
                {hrData.value} <span style={{ fontSize: 13, color: "var(--text-muted)" }}>bpm</span>
              </div>
              {baseline?.is_complete && (
                <span className={`sigma-badge ${sigmaClass(hrSigma)}`}>{sigmaLabel("HR", hrSigma)}</span>
              )}
              {baseline?.hr_baseline_mean && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Baseline: {baseline.hr_baseline_mean} bpm</div>}
            </>
          ) : <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No data yet</p>}
        </div>

        {/* SpO2 */}
        <div className="biometric-card">
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Blood Oxygen (SpO₂)</div>
          {spo2Data ? (
            <>
              <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1, margin: "6px 0 4px", color: spo2Sigma !== null && Math.abs(spo2Sigma) >= 2 ? "#dc2626" : "var(--text)" }}>
                {spo2Data.value} <span style={{ fontSize: 13, color: "var(--text-muted)" }}>%</span>
              </div>
              {baseline?.is_complete && (
                <span className={`sigma-badge ${sigmaClass(spo2Sigma)}`}>{sigmaLabel("SPO2", spo2Sigma)}</span>
              )}
              {baseline?.spo2_baseline_mean && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Baseline: {baseline.spo2_baseline_mean}%</div>}
            </>
          ) : <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No data yet</p>}
        </div>

        {/* HRV */}
        <div className="biometric-card">
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>HRV (RMSSD)</div>
          {hrvData ? (
            <>
              <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1, margin: "6px 0 4px", color: hrvSigma !== null && Math.abs(hrvSigma) >= 2 ? "#dc2626" : "var(--text)" }}>
                {hrvData.value} <span style={{ fontSize: 13, color: "var(--text-muted)" }}>ms</span>
              </div>
              {baseline?.is_complete && (
                <span className={`sigma-badge ${sigmaClass(hrvSigma)}`}>{sigmaLabel("HRV", hrvSigma)}</span>
              )}
              {baseline?.hrv_baseline_mean && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Baseline: {baseline.hrv_baseline_mean} ms</div>}
            </>
          ) : <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No data yet</p>}
        </div>
      </div>

      {/* ── CHART + WEARABLE ROW ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 22 }}>
        <div className="dash-card">
          <div className="card-section-title">📈 Heart Rate Trend (last 14 readings)</div>
          <div style={{ position: "relative", height: 200 }}>
            {biometrics.filter(b => b.type === "HR").length > 1 ? (
              <canvas ref={chartRef} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: 13 }}>
                Not enough HR data for trend
              </div>
            )}
          </div>
        </div>
        <div className="dash-card">
          <WearableConnectCard />
        </div>
      </div>

      {/* ── BASELINE BANNER ── */}
      {!baseline?.is_complete && biometrics.length > 0 && (
        <div style={{ background: "#ecfdf5", border: "1px solid #6ee7b7", borderRadius: "var(--radius)", padding: "16px 20px", marginBottom: 22, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#065f46" }}>📊 Establish Your Health Baseline</div>
            <div style={{ fontSize: 13, color: "#047857", marginTop: 3 }}>{biometrics.length} readings collected — {biometrics.length >= 20 ? "ready to analyse!" : `${20 - biometrics.length} more needed`}</div>
          </div>
          <button
            onClick={() => setShowBaselineModal(true)}
            style={{ background: "var(--nurse)", color: "white", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
          >
            Get Started
          </button>
        </div>
      )}

      {/* ── RECENT READINGS ── */}
      <div className="dash-card">
        <div className="card-section-title">🕒 Recent Health Data</div>
        {biometrics.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Type", "Value", "Recorded"].map(h => (
                  <th key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", padding: "8px 12px", textAlign: "left", borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {biometrics.slice(0, 8).map((item) => (
                <tr key={item.id} style={{ borderBottom: "1px solid var(--bg)" }}>
                  <td style={{ padding: "10px 12px", fontSize: 13.5, fontWeight: 600 }}>{item.type}</td>
                  <td style={{ padding: "10px 12px", fontSize: 13.5, fontWeight: 700, color: "var(--primary)" }}>{item.value}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-muted)" }}>{new Date(item.recorded_at).toLocaleString("en-ZA")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "28px 0", fontSize: 13 }}>
            No health data yet. Connect your wearable to start tracking.
          </p>
        )}
      </div>

      <RequestNurseModal isOpen={showRequestModal} onClose={() => setShowRequestModal(false)} onSuccess={() => {}} userAddress={profile?.address || ""} />
      <SymptomAnalysisModal isOpen={showAnalysisModal} onClose={() => setShowAnalysisModal(false)} onSuccess={() => {}} />
      <BaselineModal isOpen={showBaselineModal} onClose={() => setShowBaselineModal(false)} onSuccess={loadDashboardData} />
    </DashboardLayout>
  );
}
