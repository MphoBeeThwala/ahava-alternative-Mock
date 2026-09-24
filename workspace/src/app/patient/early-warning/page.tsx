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
              Early Warning uses biometrics (resting heart rate, HRV, sleep, activity, ECG rhythm, temperature trend) and the WHO 2019
              non-laboratory cardiovascular risk chart (Southern sub-Saharan Africa) to surface risk signals. Not a medical diagnosis —
              for informational purposes only.
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
                {/* Alert Level */}
                <Card>
                  <CardHeader>
                    <CardTitle>Health Status</CardTitle>
                  </CardHeader>
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[var(--muted)]">Alert Level</span>
                      <span className={`font-bold px-3 py-1 rounded-full text-white ${
                        data.alert_level === 'RED' ? 'bg-red-500' :
                        data.alert_level === 'YELLOW' ? 'bg-yellow-500' :
                        'bg-green-500'
                      }`}>
                        {data.alert_level ?? 'GREEN'}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      You can choose to consult a clinician if you want clarification on this signal.
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

                {/* BP check prompt — AH-45.5a. prompt_bp_check can only be
                    true once BP_CHECK_PROMPT_SIGNED_OFF is set server-side
                    (docs/CLINICAL_SIGNOFF_CHECKLIST.md row 10), so this
                    card is inert today by design, not because it's
                    unfinished. Deliberately checks prompt_bp_check, not
                    signed_off, as the render condition — signed_off alone
                    without real signals present should show nothing. */}
                {data.bp_risk?.prompt_bp_check && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Blood Pressure Check Recommended</CardTitle>
                    </CardHeader>
                    <div className="p-4 space-y-3">
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                        <p className="text-sm text-amber-900">
                          {data.bp_risk.disclaimer ?? 'Not a blood pressure measurement or a hypertension risk score. A measured blood pressure reading is recommended to follow up.'}
                        </p>
                      </div>
                      {data.bp_risk.contributing_signals && data.bp_risk.contributing_signals.length > 0 && (
                        <div className="text-xs text-[var(--muted)]">
                          Based on: {data.bp_risk.contributing_signals.map((s) => s.replaceAll('_', ' ').toLowerCase()).join(', ')}
                        </div>
                      )}
                      <Link href="/patient/book-visit" className="btn-primary inline-block px-4 py-2 rounded-xl font-medium text-sm">
                        Book a Cuff Reading
                      </Link>
                    </div>
                  </Card>
                )}

                {/* CVD risk category — WHO_2019_CHART_SIGNED_OFF gated
                    (CLINICAL_SIGNOFF_CHECKLIST.md row 7). Shows the "why
                    not available" state explicitly rather than hiding the
                    card, since a silent absence reads as "nothing to see"
                    rather than "awaiting review". */}
                <Card>
                  <CardHeader>
                    <CardTitle>10-Year Cardiovascular Risk</CardTitle>
                  </CardHeader>
                  <div className="p-4 space-y-2">
                    {data.cvd_risk?.computable ? (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-[var(--muted)]">WHO 2019 non-laboratory risk category</span>
                        <span className="font-bold px-3 py-1 rounded-full text-white bg-slate-700">
                          {data.cvd_risk.risk_category}
                        </span>
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--muted)]">
                        Not yet available for your profile
                        {data.cvd_risk?.reasons_not_computable?.length
                          ? ` (${data.cvd_risk.reasons_not_computable.join(', ').toLowerCase().replaceAll('_', ' ')})`
                          : ''}.
                      </p>
                    )}
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
                <Card>
                  <CardHeader>
                    <CardTitle>Trend Analysis</CardTitle>
                  </CardHeader>
                  <div className="p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div className="p-3 rounded-lg bg-slate-50">
                        <div className="text-xs text-[var(--muted)] mb-1">Resting Heart Rate</div>
                        <div className="font-semibold text-[var(--foreground)] capitalize">
                          {data.hr_trend_2w || 'Stable'}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-50">
                        <div className="text-xs text-[var(--muted)] mb-1">HRV vs. Baseline</div>
                        <div className="font-semibold text-[var(--foreground)] capitalize">
                          {data.hrv_vs_baseline || 'At baseline'}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-50">
                        <div className="text-xs text-[var(--muted)] mb-1">Sleep Pattern</div>
                        <div className="font-semibold text-[var(--foreground)] capitalize">
                          {data.sleep_pattern || 'Calibrating'}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Current Metrics */}
                <Card>
                  <CardHeader>
                    <CardTitle>Current Biometrics</CardTitle>
                  </CardHeader>
                  <div className="p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div>
                        <MetricRow label="Heart Rate (resting)" value={data.heart_rate_resting != null ? Math.round(data.heart_rate_resting) : null} unit="bpm" />
                        <MetricRow label="HRV (RMSSD)" value={data.hrv_rmssd != null ? Math.round(data.hrv_rmssd) : null} unit="ms" />
                        <MetricRow label="Blood Oxygen" value={data.spo2 != null ? Math.round(data.spo2) : null} unit="%" />
                      </div>
                      <div>
                        <MetricRow label="Sleep" value={data.sleep_duration_hours ? `${data.sleep_duration_hours.toFixed(1)}h` : null} />
                        <MetricRow label="Steps" value={data.step_count ?? null} />
                        <MetricRow label="ECG Rhythm" value={data.ecg_rhythm ?? null} />
                      </div>
                      <div>
                        <MetricRow label="HR Baseline" value={data.hr_baseline != null ? Math.round(data.hr_baseline) : null} unit="bpm" />
                        <MetricRow label="HRV Baseline" value={data.hrv_baseline != null ? Math.round(data.hrv_baseline) : null} unit="ms" />
                        <MetricRow label="Temperature Trend" value={data.temperature_trend ?? null} />
                      </div>
                    </div>
                  </div>
                </Card>

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
