"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import RoleGuard, { UserRole } from "../../../components/RoleGuard";
import DashboardLayout from "../../../components/DashboardLayout";
import { Card } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { doctorApi, MonitoringWorklistPatient } from "../../../lib/api";

function alertVariant(level: string): "danger" | "warning" | "success" {
  if (level === "RED") return "danger";
  if (level === "YELLOW") return "warning";
  return "success";
}

function age(dateOfBirth: string | null): string {
  if (!dateOfBirth) return "—";
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return "—";
  const years = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return `${years}y`;
}

export default function DoctorMonitoringPage() {
  const [patients, setPatients] = useState<MonitoringWorklistPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const data = await doctorApi.getMonitoringWorklist();
      setPatients(data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error ?? "Unable to load the monitoring worklist.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <RoleGuard allowedRoles={[UserRole.DOCTOR]}>
      <DashboardLayout>
        <PageHeader
          title="Patient Monitoring"
          subtitle="Patients whose latest wearable/biometric reading needs review — consented patients only"
          right={
            <Link
              href="/doctor/dashboard"
              className="text-sm font-medium hover:underline"
              style={{ color: "var(--primary)" }}
            >
              ← Triage queue
            </Link>
          }
        />

        <div className="p-6 sm:p-8 bg-[var(--background)]">
          <div className="max-w-6xl mx-auto space-y-4">
            {/* Not a diagnostic surface — same Tier-2 framing as the
                patient-facing page. cvd_risk/bp_risk are both still gated
                server-side; both columns below read "—" for every patient
                until WHO_2019_CHART_SIGNED_OFF / BP_CHECK_PROMPT_SIGNED_OFF
                are set (CLINICAL_SIGNOFF_CHECKLIST.md rows 7/10). That's
                expected, not a bug in this page. */}
            <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
              <p className="text-xs text-blue-900">
                <strong>Not a diagnosis.</strong> Alert levels and risk signals here are derived from wearable/manual
                biometrics and are informational. Amber/Red indicate a deviation from the patient&apos;s own baseline
                or an absolute physiological threshold — clinical correlation is recommended.
              </p>
            </div>

            {loading && (
              <div className="py-12 text-center text-[var(--muted)]">Loading monitoring worklist…</div>
            )}

            {error && !loading && (
              <Card>
                <div className="py-6 text-center text-[var(--muted)]">{error}</div>
              </Card>
            )}

            {!loading && !error && patients.length === 0 && (
              <Card>
                <div className="py-8 text-center text-[var(--muted)]">
                  No consented patients currently flagged. This list shows only patients with an Amber/Red alert
                  level or an active risk signal on their most recent reading.
                </div>
              </Card>
            )}

            {!loading && !error && patients.length > 0 && (
              <div className="space-y-3">
                {patients.map((p) => (
                  <Card key={p.userId}>
                    <div className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-[var(--foreground)]">
                            {p.firstName} {p.lastName}
                            <span className="ml-2 text-sm font-normal text-[var(--muted)]">{age(p.dateOfBirth)}</span>
                          </div>
                          <div className="text-xs text-[var(--muted)] mt-0.5">
                            Latest reading: {new Date(p.latestReadingAt).toLocaleString()}
                          </div>
                        </div>
                        <StatusBadge variant={alertVariant(p.alertLevel)}>{p.alertLevel}</StatusBadge>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm">
                        <div>
                          <div className="text-xs text-[var(--muted)]">Resting HR</div>
                          <div className="font-medium text-[var(--foreground)]">
                            {p.heartRateResting != null ? `${Math.round(p.heartRateResting)} bpm` : "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--muted)]">HRV</div>
                          <div className="font-medium text-[var(--foreground)]">
                            {p.hrvRmssd != null ? `${Math.round(p.hrvRmssd)} ms` : "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--muted)]">SpO₂</div>
                          <div className="font-medium text-[var(--foreground)]">
                            {p.oxygenSaturation != null ? `${Math.round(p.oxygenSaturation)}%` : "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--muted)]">Readiness</div>
                          <div className="font-medium text-[var(--foreground)]">{p.readinessScore ?? "—"}</div>
                        </div>
                      </div>

                      {p.anomalies.length > 0 && (
                        <div className="mt-3 text-xs text-[var(--muted)]">
                          <span className="font-medium text-[var(--foreground)]">Anomalies: </span>
                          {p.anomalies.join("; ")}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-slate-100">
                        <div className="text-xs">
                          <span className="text-[var(--muted)]">BP check: </span>
                          <span className="font-medium text-[var(--foreground)]">
                            {p.bpPromptCheck ? "Recommended" : "—"}
                          </span>
                          {!p.bpPromptCheck && p.bpContributingSignals.length > 0 && (
                            <span className="text-[var(--muted)]"> (pending sign-off — row 10)</span>
                          )}
                        </div>
                        <div className="text-xs">
                          <span className="text-[var(--muted)]">10-yr CVD risk (WHO): </span>
                          <span className="font-medium text-[var(--foreground)]">
                            {p.cvdRiskCategory ?? "— (pending sign-off — row 7)"}
                          </span>
                        </div>
                        <div className="text-xs">
                          <span className="text-[var(--muted)]">10-yr CVD risk (Framingham): </span>
                          <span className="font-medium text-[var(--foreground)]">
                            {p.framinghamRiskPct != null
                              ? `${p.framinghamRiskPct}%`
                              : p.framinghamRiskBound ?? "— (pending sign-off — row 11)"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
