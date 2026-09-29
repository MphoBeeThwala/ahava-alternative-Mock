"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import RoleGuard, { UserRole } from "../../../components/RoleGuard";
import DashboardLayout from "../../../components/DashboardLayout";
import { Card, CardHeader, CardTitle } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { EmptyState } from "../../../components/ui/EmptyState";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { useToast } from "../../../contexts/ToastContext";
import { accessApi, ACCESS_REASON_LABEL, AdminAccessGrant, adminApi, User } from "../../../lib/api";

type View = "active" | "break-glass-review" | "all";

const VIEW_LABEL: Record<View, string> = {
  active: "Active access",
  "break-glass-review": "Break-glass to review",
  all: "All history",
};

const isVerifiedClinician = (u: User) =>
  u.isActive && ((u.role === "NURSE" && u.sancVerificationStatus === "Active") || (u.role === "DOCTOR" && !!u.hcpsaVerified && !!u.hcpsaNumber));

/**
 * Admins manage who can see which patient; they don't read records
 * themselves. Grants go to verified clinicians only, for one patient, for
 * a limited time, with a recorded reason.
 */
export default function AdminAccessPage() {
  const toast = useToast();
  const [view, setView] = useState<View>("active");
  const [grants, setGrants] = useState<AdminAccessGrant[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ clinicianId: "", patientId: "", hours: 72, justification: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (v: View) => {
    setLoading(true);
    try {
      setGrants(await accessApi.list(v));
    } catch {
      toast.error("Unable to load access grants.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(view); }, [view, load]);
  useEffect(() => { adminApi.getAllUsers().then(setUsers).catch(() => setUsers([])); }, []);

  const clinicians = useMemo(() => users.filter(isVerifiedClinician), [users]);
  const patients = useMemo(() => users.filter((u) => u.role === "PATIENT" && u.isActive), [users]);

  const grant = async () => {
    if (!form.clinicianId || !form.patientId || form.justification.trim().length < 10) {
      toast.error("Choose a clinician and a patient, and give a reason (at least 10 characters).");
      return;
    }
    setSaving(true);
    try {
      await accessApi.grant({ ...form, justification: form.justification.trim() });
      toast.success("Access granted.");
      setForm({ clinicianId: "", patientId: "", hours: 72, justification: "" });
      await load(view);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error ?? "Could not grant access.");
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (g: AdminAccessGrant) => {
    const reason = window.prompt(`Revoke ${g.clinician.firstName} ${g.clinician.lastName}'s access to ${g.patient.name}? Reason:`);
    if (!reason || reason.trim().length < 3) return;
    try {
      await accessApi.revoke(g.id, reason.trim());
      toast.success("Access revoked.");
      await load(view);
    } catch {
      toast.error("Could not revoke access.");
    }
  };

  const review = async (g: AdminAccessGrant) => {
    const note = window.prompt("Review note (was this emergency access appropriate?):");
    if (!note || note.trim().length < 3) return;
    try {
      await accessApi.reviewBreakGlass(g.id, note.trim());
      toast.success("Review recorded.");
      await load(view);
    } catch {
      toast.error("Could not record the review.");
    }
  };

  const field = "w-full rounded-lg border px-3 py-2 text-sm";

  return (
    <RoleGuard allowedRoles={[UserRole.ADMIN]}>
      <DashboardLayout>
        <PageHeader title="Patient access" subtitle="Who can open which patient's record, why, and until when" />
        <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
          <Card padding="sm">
            <CardHeader><CardTitle>Grant access</CardTitle></CardHeader>
            <p className="mb-3 text-xs text-[var(--muted)]">
              Only nurses with a verified SANC registration and doctors with a verified HPCSA number can be granted
              access, to one patient at a time, for up to 30 days. The patient can see every grant.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <select className={field} style={{ borderColor: "var(--border)" }} value={form.clinicianId} onChange={(e) => setForm({ ...form, clinicianId: e.target.value })}>
                <option value="">Verified clinician…</option>
                {clinicians.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName} · {u.role === "NURSE" ? `SANC ${u.sancId ?? ""}` : `HPCSA ${u.hcpsaNumber ?? ""}`}
                  </option>
                ))}
              </select>
              <select className={field} style={{ borderColor: "var(--border)" }} value={form.patientId} onChange={(e) => setForm({ ...form, patientId: e.target.value })}>
                <option value="">Patient…</option>
                {patients.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName} · {u.email}</option>)}
              </select>
              <select className={field} style={{ borderColor: "var(--border)" }} value={form.hours} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })}>
                {[4, 24, 72, 168, 720].map((h) => <option key={h} value={h}>{h < 24 ? `${h} hours` : `${h / 24} day${h === 24 ? "" : "s"}`}</option>)}
              </select>
              <input className={field} style={{ borderColor: "var(--border)" }} placeholder="Reason (recorded, encrypted)" value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} maxLength={2000} />
            </div>
            <button onClick={grant} disabled={saving} className="mt-3 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--primary)" }}>
              {saving ? "Granting…" : "Grant access"}
            </button>
          </Card>

          <Card padding="sm">
            <div className="mb-3 flex flex-wrap gap-2">
              {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className="rounded-full px-3 py-1 text-xs font-semibold"
                  style={{ background: view === v ? "var(--primary)" : "var(--border)", color: view === v ? "white" : "var(--foreground)" }}
                >
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </div>
            {loading ? (
              <p className="py-6 text-center text-sm text-[var(--muted)]">Loading…</p>
            ) : grants.length === 0 ? (
              <EmptyState icon="lock" message="Nothing here" />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {grants.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--foreground)]">
                        {g.clinician.firstName} {g.clinician.lastName}
                        <span className="font-normal text-[var(--muted)]"> ({g.clinician.role.toLowerCase()}) → {g.patient.name}</span>
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {ACCESS_REASON_LABEL[g.reason]} · {new Date(g.startsAt).toLocaleString()} – {new Date(g.revokedAt ?? g.expiresAt).toLocaleString()}
                      </p>
                      {g.justification && <p className="mt-1 text-xs" style={{ wordBreak: "break-word" }}>&ldquo;{g.justification}&rdquo;</p>}
                      {g.reviewNote && <p className="mt-1 text-xs text-[var(--muted)]">Reviewed: {g.reviewNote}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge variant={g.status === "ACTIVE" ? "success" : "neutral"}>{g.status}</StatusBadge>
                      {g.reason === "BREAK_GLASS" && !g.reviewedAt && (
                        <button onClick={() => review(g)} className="rounded-lg border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>Review</button>
                      )}
                      {g.status === "ACTIVE" && (
                        <button onClick={() => revoke(g)} className="rounded-lg border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>Revoke</button>
                      )}
                    </div>
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
