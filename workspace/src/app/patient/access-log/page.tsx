"use client";

import { useEffect, useState } from "react";
import RoleGuard, { UserRole } from "../../../components/RoleGuard";
import DashboardLayout from "../../../components/DashboardLayout";
import { Card } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { EmptyState } from "../../../components/ui/EmptyState";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { accessApi, ACCESS_REASON_LABEL, PatientAccessLogEntry } from "../../../lib/api";

/**
 * POPIA-style transparency: every nurse or doctor who has had access to
 * this patient's record, why, and for how long.
 */
export default function PatientAccessLogPage() {
  const [entries, setEntries] = useState<PatientAccessLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    accessApi
      .getMyRecordAccess()
      .then(setEntries)
      .catch(() => setError("Unable to load your access history."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <RoleGuard allowedRoles={[UserRole.PATIENT]}>
      <DashboardLayout>
        <PageHeader
          title="Who accessed my record"
          subtitle="Only verified nurses and doctors caring for you can open your record, for a limited time. Every access is listed here."
        />
        <div className="mx-auto max-w-3xl p-4 sm:p-6">
          <Card padding="sm">
            {loading ? (
              <p className="py-6 text-center text-sm text-[var(--muted)]">Loading…</p>
            ) : error ? (
              <p className="py-6 text-center text-sm text-[var(--muted)]">{error}</p>
            ) : entries.length === 0 ? (
              <EmptyState icon="lock" message="No clinician has had access to your record yet" />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {entries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div>
                      <p className="font-semibold text-[var(--foreground)]">
                        {e.clinician.name}
                        <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                          {e.clinician.role === "NURSE" ? "Nurse" : "Doctor"}
                          {e.clinician.registration.number ? ` · ${e.clinician.registration.body} ${e.clinician.registration.number}` : ""}
                        </span>
                      </p>
                      <p className="text-sm text-[var(--muted)]">{ACCESS_REASON_LABEL[e.reason]}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {new Date(e.startsAt).toLocaleString()} – {new Date(e.revokedAt ?? e.expiresAt).toLocaleString()}
                      </p>
                    </div>
                    <StatusBadge variant={e.reason === "BREAK_GLASS" ? "warning" : e.status === "ACTIVE" ? "success" : "neutral"}>
                      {e.status === "ACTIVE" ? "Active" : e.status === "REVOKED" ? "Revoked" : "Ended"}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
