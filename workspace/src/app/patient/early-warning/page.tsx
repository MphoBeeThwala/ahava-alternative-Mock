"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import RoleGuard, { UserRole } from "../../../components/RoleGuard";
import { patientApi, EarlyWarningSummary } from "../../../lib/api";
import DashboardLayout from "../../../components/DashboardLayout";
import { Card, CardHeader, CardTitle } from "../../../components/ui/Card";

function MetricRow({ label, value, unit }: { label: string; value: string | number | null | undefined; unit?: string }) {
  const displayValue = value ?? "—";
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-slate-200 last:border-b-0">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className="font-medium text-[var(--foreground)]">
        {displayValue}
        {unit && <span className="text-[var(--muted)] font-normal ml-1">{unit}</span>}
      </span>
    </div>
  );
}

export default function EarlyWarningPage() {
  const [data, setData] = useState<EarlyWarningSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demoStarted, setDemoStarted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    
    const loadData = async () => {
      try {
        setError(null);
        const result = await patientApi.getEarlyWarningSummary();
        if (!cancelled) setData(result as EarlyWarningSummary);
      } catch (e: unknown) {
        const err = e as { response?: { status: number; data?: { error?: string } } };
        if (!cancelled) {
          if (err.response?.status === 404 && !demoStarted) {
            // Auto-start demo
            setError("No biometric data. Starting demo simulation...");
            try {
              await patientApi.startDemoStream(300, 30);
              setDemoStarted(true);
              // Retry after delay
              setTimeout(() => loadData(), 3000);
            } catch (demoErr) {
              setError("Failed to start demo. Try submitting biometrics on the dashboard.");
            }
          } else {
            setError(err.response?.data?.error ?? "Unable to load early warning data.");
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadData();
    return () => { cancelled = true; };
  }, [demoStarted]);

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
              Early Warning uses biometrics (resting heart rate, HRV, sleep, activity, ECG rhythm, temperature trend) and validated risk models
              (Framingham, QRISK3) to surface risk signals. Not a medical diagnosis — for informational purposes only.
            </p>

            {loading && (
              <div className="py-12 text-center text-[var(--muted)]">Loading your Early Warning summary…</div>
            )}

            {error && !loading && !data && (
              <Card className="mb-8">
                <div className="py-6 text-center space-y-4">
                  <p className="text-[var(--muted)]">{error}</p>
                  <Link
                    href="/patient/dashboard"
                    className="btn-primary inline-block px-4 py-2 rounded-xl font-medium"
                  >
                    Go to dashboard
                  </Link>
                </div>
              </Card>
            )}

            {data && !loading && (
              <div className="space-y-6">
                {/* Risk Level */}
                <Card>
                  <CardHeader>
                    <CardTitle>Health Status</CardTitle>
                  </CardHeader>
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[var(--muted)]">Risk Signal</span>
                      <span className={`font-bold px-3 py-1 rounded-full text-white ${
                        data.riskLevel === 'high' ? 'bg-red-500' :
                        data.riskLevel === 'moderate' ? 'bg-yellow-500' :
                        'bg-green-500'
                      }`}>
                        {String(data.riskLevel ?? 'STABLE').toUpperCase()}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      You can choose to consult a clinician if you want clarification on this risk signal.
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Link href="/patient/book-visit" className="btn-primary inline-block px-4 py-2 rounded-xl font-medium">
                        Request a Nurse Visit
                      </Link>
                      <Link href="/patient/ai-doctor" className="inline-block px-4 py-2 rounded-xl font-medium border border-slate-200 text-[var(--foreground)] hover:bg-slate-50">
                        Ask a Doctor (Remote)
                      </Link>
                    </div>
                  </div>
                </Card>

                {/* Recommendations */}
                {data.recommendations && data.recommendations.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Recommendations</CardTitle>
                    </CardHeader>
                    <div className="p-4">
                      <ul className="space-y-2">
                        {data.recommendations.map((rec: string, i: number) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-[var(--primary)] font-bold mt-1">•</span>
                            <span className="text-sm text-[var(--foreground)]">{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Card>
                )}

                {/* Trend Analysis */}
                {data.trendAnalysis && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Trend Analysis</CardTitle>
                    </CardHeader>
                    <div className="p-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="p-3 rounded-lg bg-slate-50">
                          <div className="text-xs text-[var(--muted)] mb-1">Heart Rate</div>
                          <div className="font-semibold text-[var(--foreground)]">
                            {data.trendAnalysis.heartRate || 'Stable'}
                          </div>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-50">
                          <div className="text-xs text-[var(--muted)] mb-1">Blood Oxygen</div>
                          <div className="font-semibold text-[var(--foreground)]">
                            {data.trendAnalysis.oxygenSaturation || 'Normal'}
                          </div>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-50">
                          <div className="text-xs text-[var(--muted)] mb-1">Sleep Quality</div>
                          <div className="font-semibold text-[var(--foreground)]">
                            {data.trendAnalysis.sleepQuality || 'Calibrating'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                )}

                {/* Current Metrics */}
                {data.baselineMetrics && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Current Biometrics</CardTitle>
                    </CardHeader>
                    <div className="p-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div>
                          <MetricRow label="Heart Rate (resting)" value={Math.round(data.baselineMetrics.heart_rate_resting || 0)} unit="bpm" />
                          <MetricRow label="HRV (RMSSD)" value={Math.round(data.baselineMetrics.hrv_rmssd || 0)} unit="ms" />
                          <MetricRow label="Blood Oxygen" value={Math.round(data.baselineMetrics.spo2 || 0)} unit="%" />
                        </div>
                        <div>
                          <MetricRow label="Respiratory Rate" value={Math.round(data.baselineMetrics.respiratory_rate || 0)} unit="/min" />
                          <MetricRow label="Sleep" value={data.baselineMetrics.sleep_duration_hours ? `${data.baselineMetrics.sleep_duration_hours.toFixed(1)}h` : "—"} />
                          <MetricRow label="Steps" value={data.baselineMetrics.step_count || 0} />
                        </div>
                        <div>
                          <MetricRow label="Active Calories" value={Math.round(data.baselineMetrics.active_calories || 0)} />
                          <MetricRow label="Skin Temp Offset" value={data.baselineMetrics.skin_temp_offset?.toFixed(1)} unit="°C" />
                          <MetricRow label="ECG Rhythm" value={data.baselineMetrics.ecg_rhythm || 'Unknown'} />
                        </div>
                      </div>
                    </div>
                  </Card>
                )}

                {/* Disclaimer */}
                <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                  <p className="text-xs text-blue-900">
                    <strong>Important:</strong> This is not a medical diagnosis. Risk signals are informational and may be incomplete.
                    If you feel unwell or symptoms are severe, seek urgent medical care.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
