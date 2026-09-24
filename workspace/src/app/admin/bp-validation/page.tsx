"use client";

import React, { useState, useEffect, useCallback } from "react";
import RoleGuard, { UserRole } from "../../../components/RoleGuard";
import DashboardLayout from "../../../components/DashboardLayout";
import { Card } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { adminApi, BpFlagValidationReport } from "../../../lib/api";

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export default function BpValidationPage() {
  const [report, setReport] = useState<BpFlagValidationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const data = await adminApi.getBpFlagValidationReport();
      setReport(data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error ?? "Unable to load the validation report.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <RoleGuard allowedRoles={[UserRole.ADMIN]}>
      <DashboardLayout>
        <PageHeader
          title="BP-Check Flag Validation"
          subtitle="Retrospective comparison of bp_risk.prompt_bp_check against nurse-recorded cuff calibration readings"
        />
        <div className="p-6 sm:p-8 bg-[var(--background)]">
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
              <p className="text-xs text-blue-900">
                <strong>Internal QA report, not a clinical tool.</strong> This does not feed back into any
                patient-facing signal — it only measures whether the existing, already-signed-off flag correlates
                with real cuff readings. Elevated is defined as systolic ≥ 140 or diastolic ≥ 90 mmHg (standard
                clinical convention), used only for this comparison.
              </p>
            </div>

            {loading && <div className="py-12 text-center text-[var(--muted)]">Loading report…</div>}

            {error && !loading && (
              <Card>
                <div className="py-6 text-center text-[var(--muted)]">{error}</div>
              </Card>
            )}

            {!loading && !error && report && (
              <>
                {report.sampleSize === 0 ? (
                  <Card>
                    <div className="py-8 text-center text-[var(--muted)]">
                      {report.message ?? "No paired data yet."}
                    </div>
                  </Card>
                ) : (
                  <>
                    <Card>
                      <div className="p-4">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          <div>
                            <div className="text-xs text-[var(--muted)]">Paired samples</div>
                            <div className="text-2xl font-bold text-[var(--foreground)]">{report.sampleSize}</div>
                          </div>
                          <div>
                            <div className="text-xs text-[var(--muted)]">Sensitivity</div>
                            <div className="text-2xl font-bold text-[var(--foreground)]">{pct(report.sensitivity)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-[var(--muted)]">Specificity</div>
                            <div className="text-2xl font-bold text-[var(--foreground)]">{pct(report.specificity)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-[var(--muted)]">PPV</div>
                            <div className="text-2xl font-bold text-[var(--foreground)]">{pct(report.positivePredictiveValue)}</div>
                          </div>
                        </div>
                        {report.caveat && (
                          <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                            {report.caveat}
                          </div>
                        )}
                      </div>
                    </Card>

                    <Card>
                      <div className="p-4">
                        <div className="text-sm font-semibold text-[var(--foreground)] mb-2">Confusion matrix</div>
                        <table className="w-full text-sm">
                          <tbody>
                            <tr>
                              <td className="p-2"></td>
                              <td className="p-2 font-medium text-center">Cuff elevated</td>
                              <td className="p-2 font-medium text-center">Cuff normal</td>
                            </tr>
                            <tr className="border-t border-slate-100">
                              <td className="p-2 font-medium">Flagged</td>
                              <td className="p-2 text-center">{report.confusionMatrix?.truePositive ?? 0}</td>
                              <td className="p-2 text-center">{report.confusionMatrix?.falsePositive ?? 0}</td>
                            </tr>
                            <tr className="border-t border-slate-100">
                              <td className="p-2 font-medium">Not flagged</td>
                              <td className="p-2 text-center">{report.confusionMatrix?.falseNegative ?? 0}</td>
                              <td className="p-2 text-center">{report.confusionMatrix?.trueNegative ?? 0}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </Card>

                    <div className="text-xs text-[var(--muted)]">
                      {report.unpairedCalibrationReadings ?? 0} of {report.totalCalibrationReadings ?? 0} calibration
                      readings had no bp_risk-bearing reading within {report.pairingWindowDays ?? 7} days and were excluded.
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
