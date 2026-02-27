"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import RoleGuard, { UserRole } from "../../../components/RoleGuard";
import { patientApi, EarlyWarningSummary } from "../../../lib/api";
import DashboardLayout from "../../../components/DashboardLayout";
import { Card, CardHeader, CardTitle } from "../../../components/ui/Card";
import { StatusBadge } from "../../../components/ui/StatusBadge";

function MetricRow({ label, value, unit, baseline }: { label: string; value: string | number; unit?: string; baseline?: string }) {
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-slate-200 last:border-b-0">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className="font-medium text-[var(--foreground)]">
        {value}
        {unit && <span className="text-[var(--muted)] font-normal ml-1">{unit}</span>}
        {baseline && <span className="text-xs text-[var(--muted)] ml-2">(baseline: {baseline})</span>}
      </span>
    </div>
  );
}

export default function EarlyWarningPage() {
  const [summary, setSummary] = useState<EarlyWarningSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const data = await patientApi.getEarlyWarningSummary();
        if (!cancelled) setSummary(data);
      } catch (e: unknown) {
        const err = e as { response?: { status: number; data?: { error?: string } } };
        if (!cancelled) {
          if (err.response?.status === 404) {
            setError(err.response?.data?.error ?? "No biometric data yet.");
          } else if (err.response?.status === 503) {
            setError("Early warning service is temporarily unavailable. Try again later.");
          } else if (err.response?.status === 400) {
            setError(err.response?.data?.error ?? "Invalid request. Submit biometrics on the dashboard first.");
          } else {
            setError("Failed to load Early Warning summary. Please try again.");
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <RoleGuard allowedRoles={[UserRole.PATIENT]}>
      <DashboardLayout>
        <div className="p-6 sm:p-8 bg-[var(--background)]">
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] tracking-tight">
                Early Warning — Cardiovascular & Wellness
              </h1>
              <Link
                href="/patient/dashboard"
                className="text-sm font-medium hover:underline"
                style={{ color: "var(--primary)" }}
              >
                ← Back to dashboard
              </Link>
            </div>

            <p className="text-sm text-[var(--muted)] mb-6 max-w-2xl">
              Resting heart rate, HRV, sleep, activity, single-lead ECG, and temperature trend are combined with
              validated risk models (Framingham, QRISK3) and a custom ML model. Not a medical diagnosis — for
              informational purposes only. Always follow clinical advice.
            </p>

            {loading && (
              <div className="py-12 text-center text-[var(--muted)]">Loading your Early Warning summary…</div>
            )}

            {error && !loading && (
              <Card className="mb-8">
                <div className="py-6 text-center space-y-4">
                  <p className="text-[var(--muted)]">{error}</p>
                  <p className="text-sm text-[var(--muted)] max-w-md mx-auto">
                    To see the full Early Warning demo with risk scores and baselines, submit biometrics on the dashboard, or run the seed with history: in <code className="bg-slate-100 px-1 rounded">apps/backend</code> run{" "}
                    <code className="bg-slate-100 px-1 rounded text-xs">MOCK_WITH_HISTORY=1 MOCK_PATIENT_COUNT=50 pnpm run seed:mock-patients</code>, then log in as <code className="bg-slate-100 px-1 rounded">patient_0001@mock.ahava.test</code> / <code className="bg-slate-100 px-1 rounded">MockPatient1!</code>.
                  </p>
                  <Link
                    href="/patient/dashboard"
                    className="inline-block px-4 py-2 rounded-lg font-medium text-white"
                    style={{ backgroundColor: "var(--primary)" }}
                  >
                    Go to dashboard & submit biometrics
                  </Link>
                </div>
              </Card>
            )}

            {summary && !loading && (
              <>
                {/* Alert level & fusion message */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <Card>
                    <CardHeader>
                      <CardTitle>Status</CardTitle>
                    </CardHeader>
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <StatusBadge
                        variant={
                          summary.alert_level === "GREEN"
                            ? "success"
                            : summary.alert_level === "YELLOW"
                              ? "warning"
                              : "danger"
                        }
                      >
                        {summary.alert_level}
                      </StatusBadge>
                      <span className="text-sm text-[var(--muted)]">
                        Last updated: {new Date(summary.processed_at).toLocaleString()}
                      </span>
                    </div>
                    {summary.fusion.alert_triggered && summary.fusion.alert_message && (
                      <div className="mt-4 p-4 rounded-lg bg-amber-50 border border-amber-200">
                        <p className="text-sm font-medium text-amber-900">{summary.fusion.alert_message}</p>
                      </div>
                    )}
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Risk trajectory</CardTitle>
                    </CardHeader>
                    <p className="text-sm text-[var(--muted)] mb-2">
                      If current trends persist, estimated 2-year cardiovascular risk:
                    </p>
                    <p className="text-2xl font-bold text-[var(--foreground)]">
                      {summary.fusion.trajectory_risk_2y_pct != null
                        ? `${summary.fusion.trajectory_risk_2y_pct}%`
                        : "—"}
                    </p>
                  </Card>
                </div>

                {/* Current metrics */}
                <Card className="mb-8">
                  <CardHeader>
                    <CardTitle>Current metrics (from latest reading)</CardTitle>
                  </CardHeader>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div>
                      <MetricRow
                        label="Resting heart rate"
                        value={summary.heart_rate_resting}
                        unit="bpm"
                        baseline={summary.hr_baseline != null ? `${summary.hr_baseline} bpm` : undefined}
                      />
                      <MetricRow label="Heart rate variability" value={summary.hrv_rmssd} unit="ms" baseline={summary.hrv_baseline != null ? `${summary.hrv_baseline} ms` : undefined} />
                      <MetricRow label="Blood oxygen (SpO₂)" value={summary.spo2} unit="%" />
                    </div>
                    <div>
                      <MetricRow label="Sleep duration" value={summary.sleep_duration_hours ? `${summary.sleep_duration_hours} h/night` : "—"} />
                      <MetricRow label="Activity (steps)" value={summary.step_count ?? "—"} />
                      <MetricRow label="ECG (single-lead)" value={summary.ecg_rhythm} />
                    </div>
                    <div>
                      <MetricRow label="Temperature trend" value={summary.temperature_trend.replace(/_/g, " ")} />
                      {summary.hr_trend_2w && (
                        <MetricRow label="HR trend (2 weeks)" value={summary.hr_trend_2w} />
                      )}
                      {summary.sleep_pattern && (
                        <MetricRow label="Sleep pattern" value={summary.sleep_pattern} />
                      )}
                    </div>
                  </div>
                </Card>

                {/* Risk scores */}
                <Card className="mb-8">
                  <CardHeader>
                    <CardTitle>10-year cardiovascular risk</CardTitle>
                  </CardHeader>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 rounded-lg border bg-slate-50/50" style={{ borderColor: "var(--border)" }}>
                      <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Framingham (adapted)</p>
                      <p className="text-xl font-bold text-[var(--foreground)] mt-1">{summary.risk_scores.framingham_10y_pct}%</p>
                    </div>
                    <div className="p-4 rounded-lg border bg-slate-50/50" style={{ borderColor: "var(--border)" }}>
                      <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">QRISK3 (adapted)</p>
                      <p className="text-xl font-bold text-[var(--foreground)] mt-1">{summary.risk_scores.qrisk3_10y_pct}%</p>
                    </div>
                    <div className="p-4 rounded-lg border bg-slate-50/50" style={{ borderColor: "var(--border)" }}>
                      <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">ML model</p>
                      <p className="text-xl font-bold text-[var(--foreground)] mt-1">{summary.risk_scores.ml_cvd_risk_pct}%</p>
                      <p className="text-xs text-[var(--muted)]">{(summary.risk_scores.ml_confidence * 100).toFixed(0)}% confidence</p>
                    </div>
                  </div>
                </Card>

                {/* Clinical flags & anomalies */}
                {(summary.clinical_flags.length > 0 || summary.anomalies.length > 0) && (
                  <Card className="mb-8">
                    <CardHeader>
                      <CardTitle>Clinical flags &amp; anomalies</CardTitle>
                    </CardHeader>
                    <ul className="list-disc list-inside space-y-1 text-sm text-[var(--foreground)]">
                      {summary.clinical_flags.map((f, i) => (
                        <li key={`flag-${i}`}>{f}</li>
                      ))}
                      {summary.anomalies.map((a, i) => (
                        <li key={`anom-${i}`}>{a}</li>
                      ))}
                    </ul>
                  </Card>
                )}

                {/* Recommendations */}
                {summary.recommendations.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Recommendations</CardTitle>
                    </CardHeader>
                    <ul className="list-disc list-inside space-y-2 text-sm text-[var(--foreground)]">
                      {summary.recommendations.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
