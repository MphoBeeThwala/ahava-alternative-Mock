"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import RoleGuard, { UserRole } from "../../../components/RoleGuard";
import DashboardLayout from "../../../components/DashboardLayout";
import { Card } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { EmptyState } from "../../../components/ui/EmptyState";
import { useToast } from "../../../contexts/ToastContext";
import { accessApi, ACCESS_REASON_LABEL, MyAccessGrant } from "../../../lib/api";

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / 3600_000);
  if (hours >= 48) return `${Math.floor(hours / 24)} days left`;
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min left`;
}

/**
 * The patients this nurse or doctor can currently open, and why. Access
 * comes from taking on a patient (visit, case, review, monitoring), an
 * administrator's grant, or break-glass — and it expires.
 */
export default function MyPatientsPage() {
  const toast = useToast();
  const [grants, setGrants] = useState<MyAccessGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bgPatientId, setBgPatientId] = useState("");
  const [bgReason, setBgReason] = useState("");
  const [bgSubmitting, setBgSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setGrants(await accessApi.getMine());
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error ?? "Unable to load your patient access.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const breakGlass = async () => {
    if (!bgPatientId.trim() || bgReason.trim().length < 20) {
      toast.error("Enter the patient ID and explain the emergency (at least 20 characters).");
      return;
    }
    if (!window.confirm("Emergency access is logged, shown to the patient, and reviewed by an administrator. Continue?")) return;
    setBgSubmitting(true);
    try {
      await accessApi.breakGlass(bgPatientId.trim(), bgReason.trim());
      toast.success("Emergency access granted for 4 hours.");
      setBgPatientId("");
      setBgReason("");
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error ?? "Emergency access was refused.");
    } finally {
      setBgSubmitting(false);
    }
  };

  return (
    <RoleGuard allowedRoles={[UserRole.NURSE, UserRole.DOCTOR]}>
      <DashboardLayout>
        <PageHeader title="My patients" subtitle="Patients whose records you can open right now, and for how long" />
        <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
          <Card padding="sm">
            {loading ? (
              <p className="py-6 text-center text-sm text-[var(--muted)]">Loading…</p>
            ) : error ? (
              <p className="py-6 text-center text-sm text-[var(--muted)]">{error}</p>
            ) : grants.length === 0 ? (
              <EmptyState icon="lock" message="You don't have access to any patient records right now" />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {grants.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-semibold text-[var(--foreground)]">{g.patient.name}</p>
                      <p className="text-xs text-[var(--muted)]">{ACCESS_REASON_LABEL[g.reason]} · {timeLeft(g.expiresAt)}</p>
                    </div>
                    <Link href={`/clinician/patients/${g.patient.id}`} className="text-sm font-semibold hover:underline" style={{ color: "var(--primary)" }}>
                      Open record →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padding="sm">
            <h2 className="text-sm font-bold text-[var(--foreground)]">Emergency access (break-glass)</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Only when a patient needs care now and you can&apos;t get access the normal way. Access lasts 4 hours, is
              shown to the patient, and every use is reviewed by an administrator.
            </p>
            <div className="mt-3 space-y-2">
              <input
                value={bgPatientId}
                onChange={(e) => setBgPatientId(e.target.value)}
                placeholder="Patient ID"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)" }}
              />
              <textarea
                value={bgReason}
                onChange={(e) => setBgReason(e.target.value)}
                placeholder="What is the emergency, and why can't you get access the normal way?"
                rows={3}
                maxLength={2000}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)" }}
              />
              <button
                onClick={breakGlass}
                disabled={bgSubmitting}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "var(--acuity-emergency)" }}
              >
                {bgSubmitting ? "Requesting…" : "Request emergency access"}
              </button>
            </div>
          </Card>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
