"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import RoleGuard, { UserRole } from "../../../../components/RoleGuard";
import DashboardLayout from "../../../../components/DashboardLayout";
import { Card, CardHeader, CardTitle } from "../../../../components/ui/Card";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { StatusBadge } from "../../../../components/ui/StatusBadge";
import { accessApi, ACCESS_REASON_LABEL, AccessGrantReason } from "../../../../lib/api";

interface PatientRecord {
  access: { reason: AccessGrantReason; expiresAt: string };
  patient: { id: string; firstName: string; lastName: string; dateOfBirth: string | null; gender: string | null; phone: string | null };
  medicalPassport: { chronicConditions?: string[]; allergies?: string[]; currentMedications?: string[]; bloodType?: string | null } | null;
  vitals: Array<{
    id: string; createdAt: string; source: string; alertLevel: string | null;
    heartRate: number | null; bloodPressureSystolic: number | null; bloodPressureDiastolic: number | null;
    oxygenSaturation: number | null; temperature: number | null; glucose: number | null;
  }>;
  triageCases: Array<{ id: string; createdAt: string; status: string; symptoms: string; aiTriageLevel: number; finalTriageLevel: number | null; doctorDiagnosis: string | null; doctorNotes: string | null }>;
  visits: Array<{ id: string; status: string; scheduledStart: string; nurseReport: string | null; doctorReview: string | null }>;
  prescriptions: Array<{ id: string; issuedAt: string; diagnosis: string; medications: Array<{ name?: string; dosage?: string; frequency?: string }> }>;
  referrals: Array<{ id: string; issuedAt: string; referralType: string; provisionalDiagnosis: string; recommendedFacility: string }>;
}

const fmt = (v: number | null, unit = "") => (v == null ? "—" : `${Math.round(v * 10) / 10}${unit}`);

/**
 * A patient's current and historical record, for a clinician who holds
 * care access to them right now. The server refuses (403) otherwise and
 * audits every open.
 */
export default function PatientRecordPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    accessApi
      .getPatientRecord(patientId)
      .then((data) => setRecord(data))
      .catch((e: { response?: { data?: { error?: string } } }) =>
        setError(e.response?.data?.error ?? "Unable to open this record."),
      );
  }, [patientId]);

  return (
    <RoleGuard allowedRoles={[UserRole.NURSE, UserRole.DOCTOR]}>
      <DashboardLayout>
        <PageHeader
          title={record ? `${record.patient.firstName} ${record.patient.lastName}` : "Patient record"}
          subtitle={record ? `${ACCESS_REASON_LABEL[record.access.reason]} · access until ${new Date(record.access.expiresAt).toLocaleString()}` : undefined}
          right={<Link href="/clinician/patients" className="text-sm font-medium hover:underline" style={{ color: "var(--primary)" }}>← My patients</Link>}
        />
        <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
          {error && <Card><p className="py-6 text-center text-sm text-[var(--muted)]">{error}</p></Card>}
          {!error && !record && <p className="py-12 text-center text-sm text-[var(--muted)]">Loading record…</p>}
          {record && (
            <>
              <Card padding="sm">
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div><p className="text-xs text-[var(--muted)]">Date of birth</p><p className="font-medium">{record.patient.dateOfBirth ? new Date(record.patient.dateOfBirth).toLocaleDateString() : "—"}</p></div>
                  <div><p className="text-xs text-[var(--muted)]">Sex</p><p className="font-medium">{record.patient.gender ?? "—"}</p></div>
                  <div><p className="text-xs text-[var(--muted)]">Phone</p><p className="font-medium">{record.patient.phone ?? "—"}</p></div>
                  <div><p className="text-xs text-[var(--muted)]">Allergies</p><p className="font-medium">{record.medicalPassport?.allergies?.join(", ") || "None recorded"}</p></div>
                </div>
                {record.medicalPassport?.currentMedications?.length ? (
                  <p className="mt-3 text-sm"><span className="text-[var(--muted)]">Current medication: </span>{record.medicalPassport.currentMedications.join(", ")}</p>
                ) : null}
                {record.medicalPassport?.chronicConditions?.length ? (
                  <p className="mt-3 text-sm"><span className="text-[var(--muted)]">Chronic conditions: </span>{record.medicalPassport.chronicConditions.join(", ")}</p>
                ) : null}
              </Card>

              <Card padding="sm">
                <CardHeader><CardTitle>Vitals (last 90 days)</CardTitle></CardHeader>
                {record.vitals.length === 0 ? <p className="text-sm text-[var(--muted)]">No readings.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs text-[var(--muted)]">
                        <tr><th className="py-1 pr-3">When</th><th className="pr-3">Alert</th><th className="pr-3">HR</th><th className="pr-3">BP</th><th className="pr-3">SpO₂</th><th className="pr-3">Temp</th><th className="pr-3">Glucose</th><th>Source</th></tr>
                      </thead>
                      <tbody>
                        {record.vitals.slice(0, 50).map((v) => (
                          <tr key={v.id} className="border-t border-[var(--border)]">
                            <td className="py-1 pr-3 whitespace-nowrap">{new Date(v.createdAt).toLocaleString()}</td>
                            <td className="pr-3">{v.alertLevel ?? "—"}</td>
                            <td className="pr-3">{fmt(v.heartRate)}</td>
                            <td className="pr-3">{v.bloodPressureSystolic != null ? `${Math.round(v.bloodPressureSystolic)}/${Math.round(v.bloodPressureDiastolic ?? 0)}` : "—"}</td>
                            <td className="pr-3">{fmt(v.oxygenSaturation, "%")}</td>
                            <td className="pr-3">{fmt(v.temperature, "°C")}</td>
                            <td className="pr-3">{fmt(v.glucose)}</td>
                            <td>{v.source}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card padding="sm">
                <CardHeader><CardTitle>Triage history</CardTitle></CardHeader>
                {record.triageCases.length === 0 ? <p className="text-sm text-[var(--muted)]">None.</p> : (
                  <ul className="space-y-3">
                    {record.triageCases.map((c) => (
                      <li key={c.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-[var(--muted)]">{new Date(c.createdAt).toLocaleString()}</span>
                          <StatusBadge variant="neutral">{c.status.replace(/_/g, " ")} · SATS {c.finalTriageLevel ?? c.aiTriageLevel}</StatusBadge>
                        </div>
                        <p className="mt-1">&ldquo;{c.symptoms}&rdquo;</p>
                        {c.doctorDiagnosis && <p className="mt-1"><span className="text-[var(--muted)]">Diagnosis: </span>{c.doctorDiagnosis}</p>}
                        {c.doctorNotes && <p className="mt-1 text-[var(--muted)]">{c.doctorNotes}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card padding="sm">
                <CardHeader><CardTitle>Home visits</CardTitle></CardHeader>
                {record.visits.length === 0 ? <p className="text-sm text-[var(--muted)]">None.</p> : (
                  <ul className="space-y-3">
                    {record.visits.map((v) => (
                      <li key={v.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-[var(--muted)]">{new Date(v.scheduledStart).toLocaleString()}</span>
                          <StatusBadge variant={v.status === "COMPLETED" ? "success" : "neutral"}>{v.status}</StatusBadge>
                        </div>
                        {v.nurseReport && <p className="mt-1"><span className="text-[var(--muted)]">Nurse report: </span>{v.nurseReport}</p>}
                        {v.doctorReview && <p className="mt-1"><span className="text-[var(--muted)]">Doctor review: </span>{v.doctorReview}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {(record.prescriptions.length > 0 || record.referrals.length > 0) && (
                <Card padding="sm">
                  <CardHeader><CardTitle>Prescriptions and referrals</CardTitle></CardHeader>
                  <ul className="space-y-2 text-sm">
                    {record.prescriptions.map((p) => (
                      <li key={p.id}>
                        <span className="text-xs text-[var(--muted)]">{new Date(p.issuedAt).toLocaleDateString()} · Prescription · </span>
                        {p.diagnosis}: {(Array.isArray(p.medications) ? p.medications : []).map((m) => [m.name, m.dosage, m.frequency].filter(Boolean).join(" ")).join("; ")}
                      </li>
                    ))}
                    {record.referrals.map((r) => (
                      <li key={r.id}>
                        <span className="text-xs text-[var(--muted)]">{new Date(r.issuedAt).toLocaleDateString()} · {r.referralType} referral · </span>
                        {r.provisionalDiagnosis} → {r.recommendedFacility}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
