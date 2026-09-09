"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import {
    patientApi,
    bookingsApi,
    terraApi,
    TerraStatus,
    BiometricReading,
    MonitoringSummary,
    Booking,
    PatientTriageCase,
} from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import DashboardLayout from '../../../components/DashboardLayout';
import { Card, CardHeader, CardTitle } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { PageHeader } from '../../../components/ui/PageHeader';
import { StatCard } from '../../../components/ui/StatCard';
import { Timeline, type TimelineStep } from '../../../components/ui/Timeline';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { Modal } from '../../../components/ui/Modal';
import { Icon } from '../../../components/ui/Icon';
import { enqueueBiometricReading } from '../../../lib/offlineBiometricQueue';
import { useOfflineBiometricSync } from '../../../hooks/useOfflineBiometricSync';

type Reading = Record<string, unknown>;

function num(v: unknown): number | undefined {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

/** Readiness ring — a plain stroke-dasharray circle, no library. */
function ReadinessRing({ score }: { score: number | undefined }) {
    const pct = Math.max(0, Math.min(100, score ?? 0));
    const r = 34;
    const c = 2 * Math.PI * r;
    const offset = c - (pct / 100) * c;
    return (
        <svg width={92} height={92} viewBox="0 0 92 92" aria-hidden focusable={false}>
            <circle cx={46} cy={46} r={r} fill="none" stroke="var(--border)" strokeWidth={8} />
            <circle
                cx={46}
                cy={46}
                r={r}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={8}
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={offset}
                transform="rotate(-90 46 46)"
                style={{ transition: 'stroke-dashoffset var(--duration) var(--ease-out)' }}
            />
            <text x="46" y="52" textAnchor="middle" className="num" fontSize={26} fontWeight={800} fill="var(--foreground)">
                {score ?? '—'}
            </text>
        </svg>
    );
}

export default function PatientDashboard() {
    const { user } = useAuth();
    const toast = useToast();
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [monitoringSummary, setMonitoringSummary] = useState<MonitoringSummary | null>(null);
    const [biometricHistory, setBiometricHistory] = useState<Reading[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [wearable, setWearable] = useState<TerraStatus | null>(null);
    const [triageCases, setTriageCases] = useState<PatientTriageCase[]>([]);
    const [vitalsModalOpen, setVitalsModalOpen] = useState(false);
    const [biometricData, setBiometricData] = useState<BiometricReading>({
        heartRate: undefined,
        bloodPressure: { systolic: 0, diastolic: 0 },
        temperature: undefined,
        oxygenSaturation: undefined,
        source: 'manual',
    });

    const loadMonitoringSummary = useCallback(async () => {
        try {
            const summary = await patientApi.getMonitoringSummary();
            setMonitoringSummary(summary);
        } catch (error) {
            console.error('Failed to load monitoring summary:', error);
        }
    }, []);

    const loadBiometricHistory = useCallback(async () => {
        try {
            const res = await patientApi.getBiometricHistory(20);
            const list = (res?.data?.history ?? res?.history ?? res) as Reading[];
            setBiometricHistory(Array.isArray(list) ? list : []);
        } catch (error) {
            console.error('Failed to load biometric history:', error);
        }
    }, []);

    const loadBookings = useCallback(async () => {
        try {
            const data = await bookingsApi.getMyBookings();
            setBookings(data?.bookings ?? data?.data ?? []);
        } catch (error) {
            console.error('Failed to load bookings:', error);
        }
    }, []);

    // New in Phase 3: a lightweight status preview of the patient's most
    // recent triage case (the full flow already lives at /patient/ai-doctor —
    // this just surfaces where the newest one stands). Read-only, uses the
    // same endpoint that page already calls; adds no new backend behavior.
    const loadTriageCases = useCallback(async () => {
        try {
            const data = await patientApi.getMyTriageCases();
            setTriageCases(Array.isArray(data?.cases) ? data.cases : []);
        } catch (error) {
            console.error('Failed to load triage cases:', error);
        }
    }, []);

    useEffect(() => {
        Promise.all([
            loadMonitoringSummary(),
            loadBiometricHistory(),
            loadBookings(),
            loadTriageCases(),
        ]).finally(() => setInitialLoading(false));
        terraApi.getStatus().then(setWearable).catch(() => {});
    }, [loadMonitoringSummary, loadBiometricHistory, loadBookings, loadTriageCases]);

    const resetBiometricForm = () => {
        setBiometricData({
            heartRate: undefined,
            bloodPressure: { systolic: 0, diastolic: 0 },
            temperature: undefined,
            oxygenSaturation: undefined,
            source: 'manual',
        });
    };

    const onQueuedReadingSynced = useCallback(() => {
        loadMonitoringSummary();
        loadBiometricHistory();
    }, [loadMonitoringSummary, loadBiometricHistory]);
    useOfflineBiometricSync(user?.id, onQueuedReadingSynced);

    const handleBiometricSubmit = async () => {
        try {
            setLoading(true);
            await patientApi.submitBiometrics(biometricData);
            toast.success('Biometrics submitted successfully!');
            resetBiometricForm();
            setVitalsModalOpen(false);
            loadMonitoringSummary();
            loadBiometricHistory();
        } catch (error: unknown) {
            const e = error as { response?: { data?: { error?: string } }; request?: unknown };
            if (e.request && !e.response) {
                // No response reached us — likely offline. Safe to queue: the
                // biometrics endpoint honors an Idempotency-Key on replay
                // (apps/backend/src/middleware/idempotency.ts), so a later
                // retry with this same reading can never double-write.
                if (user?.id) {
                    await enqueueBiometricReading(user.id, biometricData);
                    toast.info("No connection — saved offline. It will sync automatically once you're back online.");
                    resetBiometricForm();
                    setVitalsModalOpen(false);
                } else {
                    toast.error('Failed to submit biometrics. Please try again.');
                }
            } else {
                console.error("Biometric submission failed", error);
                toast.error(e.response?.data?.error || "Failed to submit biometrics. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    // ---- Derived, real-data-only values (see docs/UI_UX_IMPLEMENTATION_BRIEF.md §1.1) ----

    const latest = biometricHistory[0];
    const previous = biometricHistory[1];
    const chronological = useMemo(() => [...biometricHistory].reverse(), [biometricHistory]);
    const hrSeries = useMemo(() => chronological.map((r) => num(r.heartRate ?? r.heartRateResting)).filter((v): v is number => v != null), [chronological]);
    const spo2Series = useMemo(() => chronological.map((r) => num(r.oxygenSaturation)).filter((v): v is number => v != null), [chronological]);
    const bpSeries = useMemo(() => chronological.map((r) => num(r.bloodPressureSystolic)).filter((v): v is number => v != null), [chronological]);

    const latestHr = num(latest?.heartRate ?? latest?.heartRateResting);
    const previousHr = num(previous?.heartRate ?? previous?.heartRateResting);
    const latestSpo2 = num(latest?.oxygenSaturation);
    const previousSpo2 = num(previous?.oxygenSaturation);
    const latestBpSys = num(latest?.bloodPressureSystolic);
    const latestBpDia = num(latest?.bloodPressureDiastolic);

    const formatDelta = (curr: number | undefined, prev: number | undefined, unit: string): { text: string; tone: 'up' | 'down' | 'neutral' } | undefined => {
        if (curr == null || prev == null) return undefined;
        const diff = Math.round((curr - prev) * 10) / 10;
        if (diff === 0) return { text: `No change ${unit}`, tone: 'neutral' };
        return { text: `${diff > 0 ? '+' : ''}${diff} ${unit} vs last reading`, tone: diff > 0 ? 'up' : 'down' };
    };
    const hrDelta = formatDelta(latestHr, previousHr, 'bpm');
    const spo2Delta = formatDelta(latestSpo2, previousSpo2, '%');

    // The badge/sentence below uses this endpoint's own alertLevel, which per
    // the current backend (services/monitoring.ts) can only be GREEN, YELLOW
    // or Unknown — never RED. A true RED state lives on individual readings
    // (biometricHistory items carry their own alertLevel, including RED) and
    // on the separate Early Warning endpoint, not this summary. Handled
    // below without assuming RED can appear here.
    const alertLevel = monitoringSummary?.alertLevel;
    const latestReadingAlertLevel = latest?.alertLevel as string | undefined;
    const badgeVariant = latestReadingAlertLevel === 'RED' || alertLevel === 'RED'
        ? 'danger'
        : alertLevel === 'YELLOW' || latestReadingAlertLevel === 'YELLOW'
        ? 'warning'
        : alertLevel === 'GREEN'
        ? 'success'
        : 'neutral';

    const sentence = (() => {
        if (latestReadingAlertLevel === 'RED') {
            return 'Your most recent reading was flagged as high-priority — please review it and consider contacting a doctor.';
        }
        if (!monitoringSummary?.baselineEstablished) {
            return `We're still learning your normal — ${biometricHistory.length} of 14 readings so far.`;
        }
        if (alertLevel === 'YELLOW' || latestReadingAlertLevel === 'YELLOW') {
            return 'One of your recent readings was outside your usual range — see Recent readings below for detail.';
        }
        if (alertLevel === 'GREEN') {
            return 'Nothing needs your attention today.';
        }
        return 'Log a reading to see how you\'re doing today.';
    })();

    // Review timeline for the most recent triage case only — real timestamps,
    // no invented "AI drafted at" step (that timestamp isn't exposed to
    // patients by the API).
    const latestCase = triageCases[0];
    const timelineSteps: TimelineStep[] | null = latestCase ? [
        {
            label: 'You described your symptoms',
            detail: new Date(latestCase.createdAt).toLocaleString(),
            state: 'done',
        },
        {
            label: latestCase.status === 'RELEASED' ? 'A doctor reviewed your case' : 'A doctor is reviewing it',
            state: latestCase.status === 'RELEASED' ? 'done' : 'current',
        },
        {
            label: 'You get the result',
            detail: latestCase.releasedAt ? new Date(latestCase.releasedAt).toLocaleString() : undefined,
            state: latestCase.status === 'RELEASED' ? 'done' : 'pending',
        },
    ] : null;

    const nextBooking = bookings.find((b) => {
        const status = (b as unknown as { status?: string }).status;
        return status !== 'CANCELLED' && status !== 'COMPLETED' && new Date(b.scheduledDate).getTime() >= Date.now();
    }) ?? bookings[0];

    const readingsColumns: DataTableColumn<Reading>[] = [
        { key: 'when', header: 'When', render: (r) => r.createdAt ? new Date(r.createdAt as string).toLocaleString() : '—' },
        { key: 'hr', header: 'HR', numeric: true, render: (r) => (r.heartRate ?? r.heartRateResting) != null ? String(r.heartRate ?? r.heartRateResting) : '—' },
        { key: 'bp', header: 'BP', numeric: true, render: (r) => (r.bloodPressureSystolic != null ? `${r.bloodPressureSystolic}/${r.bloodPressureDiastolic ?? '—'}` : '—') },
        { key: 'spo2', header: 'SpO₂', numeric: true, render: (r) => r.oxygenSaturation != null ? `${r.oxygenSaturation}%` : '—' },
        { key: 'score', header: 'Score', numeric: true, render: (r) => r.readinessScore != null ? String(r.readinessScore) : '—' },
    ];

    const lastReadingTime = latest?.createdAt ? new Date(latest.createdAt as string) : null;

    return (
        <RoleGuard allowedRoles={[UserRole.PATIENT]}>
            <DashboardLayout>
                <PageHeader
                    title={`Good morning, ${user?.firstName ?? ''}`}
                    subtitle={
                        new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) +
                        (lastReadingTime ? ` · last reading ${lastReadingTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '')
                    }
                />

                {/* Email verification — preserved exactly */}
                {user && !user.isVerified && (
                    <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
                        <Icon name="mail" size={18} />
                        <span className="flex-1 text-sm font-semibold" style={{ color: '#92400e' }}>
                            Please verify your email address to unlock all features.
                        </span>
                        <a
                            href="/auth/verify-email"
                            onClick={async (e) => {
                                e.preventDefault();
                                try {
                                    const { authApi: api } = await import('../../../lib/api');
                                    await api.resendVerification(user.email);
                                    toast.success('Verification email sent! Check your inbox.');
                                } catch { toast.error('Could not resend. Try again later.'); }
                            }}
                            className="text-sm font-bold underline"
                            style={{ color: '#d97706', cursor: 'pointer' }}
                        >
                            Resend verification email
                        </a>
                    </div>
                )}

                <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
                    {initialLoading ? (
                        <div className="space-y-4">
                            <Skeleton height={140} />
                            <Skeleton height={200} />
                        </div>
                    ) : (
                        <>
                            {/* One-glance card */}
                            <Card>
                                <div className="grid gap-6 md:grid-cols-[auto_1fr_auto]">
                                    {/* Left: readiness ring + pill */}
                                    <div className="flex flex-col items-center gap-2 justify-self-center md:justify-self-start">
                                        <ReadinessRing score={monitoringSummary?.readinessScore} />
                                        <StatusBadge variant={badgeVariant}>{alertLevel ?? 'Unknown'}</StatusBadge>
                                    </div>

                                    {/* Centre: sentence + stat cards */}
                                    <div className="min-w-0">
                                        <p className="text-[15px] font-medium text-[var(--foreground)]">{sentence}</p>
                                        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                            <StatCard
                                                label="Heart rate"
                                                value={latestHr ?? '—'}
                                                unit={latestHr != null ? 'bpm' : undefined}
                                                delta={hrDelta?.text}
                                                deltaTone={hrDelta?.tone}
                                                sparklineValues={hrSeries.length >= 2 ? hrSeries : undefined}
                                            />
                                            <StatCard
                                                label="Blood pressure"
                                                value={latestBpSys != null ? `${latestBpSys}/${latestBpDia ?? '—'}` : '—'}
                                                sparklineValues={bpSeries.length >= 2 ? bpSeries : undefined}
                                            />
                                            <StatCard
                                                label="Oxygen"
                                                value={latestSpo2 ?? '—'}
                                                unit={latestSpo2 != null ? '%' : undefined}
                                                delta={spo2Delta?.text}
                                                deltaTone={spo2Delta?.tone}
                                                sparklineValues={spo2Series.length >= 2 ? spo2Series : undefined}
                                            />
                                        </div>
                                    </div>

                                    {/* Right: exactly one primary action, one secondary, one text link */}
                                    <div className="flex flex-col gap-2 md:w-48">
                                        <button
                                            type="button"
                                            onClick={() => setVitalsModalOpen(true)}
                                            className="btn-primary flex items-center justify-center gap-2 rounded-xl py-2.5 font-semibold"
                                            style={{ minHeight: 'var(--tap-primary)' }}
                                        >
                                            <Icon name="pulse" size={16} /> Log today&apos;s vitals
                                        </button>
                                        <Link
                                            href="/patient/book-visit"
                                            className="flex items-center justify-center gap-2 rounded-xl border py-2.5 font-semibold text-[var(--foreground)]"
                                            style={{ borderColor: 'var(--border)', minHeight: 'var(--tap-min)' }}
                                        >
                                            <Icon name="calendar" size={16} /> Book a nurse visit
                                        </Link>
                                        <Link href="/patient/early-warning" className="text-center text-sm font-semibold text-[var(--primary)]">
                                            See full risk detail →
                                        </Link>
                                    </div>
                                </div>
                            </Card>

                            {/* Row of two: review timeline + next visit */}
                            <div className="grid gap-6 md:grid-cols-2">
                                <Card>
                                    <CardHeader><CardTitle>Your symptom check</CardTitle></CardHeader>
                                    {timelineSteps ? (
                                        <Timeline steps={timelineSteps} />
                                    ) : (
                                        <EmptyState
                                            icon="stethoscope"
                                            message="No symptom checks yet"
                                            action={
                                                <Link href="/patient/ai-doctor" className="text-sm font-semibold text-[var(--primary)]">
                                                    Describe your symptoms →
                                                </Link>
                                            }
                                        />
                                    )}
                                </Card>
                                <Card>
                                    <CardHeader><CardTitle>Next visit</CardTitle></CardHeader>
                                    {nextBooking ? (
                                        <div>
                                            <p className="text-sm font-semibold text-[var(--foreground)]">
                                                {new Date(nextBooking.scheduledDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                                            </p>
                                            <p className="mt-1 text-sm text-[var(--muted)]">{nextBooking.encryptedAddress ?? '—'}</p>
                                            <div className="mt-3">
                                                <StatusBadge variant={(nextBooking as unknown as { status?: string }).status === 'CONFIRMED' ? 'success' : 'warning'}>
                                                    {(nextBooking as unknown as { status?: string }).status ?? 'PENDING'}
                                                </StatusBadge>
                                            </div>
                                        </div>
                                    ) : (
                                        <EmptyState
                                            icon="calendar"
                                            message="No upcoming visits"
                                            action={
                                                <Link href="/patient/book-visit" className="text-sm font-semibold text-[var(--primary)]">
                                                    Book a nurse visit →
                                                </Link>
                                            }
                                        />
                                    )}
                                </Card>
                            </div>

                            {/* Recent readings */}
                            <Card padding="sm">
                                <CardHeader><CardTitle>Recent readings</CardTitle></CardHeader>
                                {biometricHistory.length === 0 ? (
                                    <EmptyState icon="pulse" message="No readings yet" action={
                                        <button type="button" onClick={() => setVitalsModalOpen(true)} className="text-sm font-semibold text-[var(--primary)]">
                                            Log your first reading →
                                        </button>
                                    } />
                                ) : (
                                    <DataTable rowKey={(r) => String(r.id ?? Math.random())} columns={readingsColumns} data={biometricHistory.slice(0, 10)} />
                                )}
                            </Card>

                            {/* Secondary: wearable connect + AI doctor — real, distinct features, kept but de-emphasised */}
                            <div className="grid gap-4 md:grid-cols-2">
                                <Link
                                    href="/patient/wearable"
                                    className="flex items-center justify-between gap-3 rounded-2xl border p-4 transition hover:opacity-90"
                                    style={{ borderColor: wearable?.connected ? 'var(--success)' : 'var(--border)', backgroundColor: wearable?.connected ? 'rgba(5,150,105,0.06)' : 'var(--card)' }}
                                >
                                    <div className="flex items-center gap-3">
                                        <span
                                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                                            style={{ background: wearable?.connected ? 'rgba(5,150,105,0.12)' : 'rgba(148,163,184,0.1)', color: wearable?.connected ? 'var(--success)' : 'var(--muted)' }}
                                        >
                                            <Icon name="watch" size={18} />
                                        </span>
                                        <div>
                                            <p className="text-sm font-bold text-[var(--foreground)]">
                                                {wearable?.connected ? 'Smartwatch Connected' : 'Connect Your Smartwatch'}
                                            </p>
                                            <p className="mt-0.5 text-xs text-[var(--muted)]">
                                                {wearable?.connected
                                                    ? `${wearable.devices.join(', ')} · syncing automatically`
                                                    : 'Apple Watch, Fitbit, Garmin, Samsung & more'}
                                            </p>
                                        </div>
                                    </div>
                                    <span className="shrink-0 text-sm font-semibold" style={{ color: wearable?.connected ? 'var(--success)' : 'var(--primary)' }}>
                                        {wearable?.connected ? 'Manage →' : 'Set up →'}
                                    </span>
                                </Link>

                                <Card className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-bold text-[var(--foreground)]">AI Doctor Assistant</p>
                                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                                            For decision support only — not a medical diagnosis.
                                        </p>
                                    </div>
                                    <Link href="/patient/ai-doctor" className="shrink-0 text-sm font-semibold text-[var(--primary)]">
                                        Open →
                                    </Link>
                                </Card>
                            </div>
                        </>
                    )}
                </div>

                {/* Biometric entry — moved out of the page flow into a modal */}
                <Modal
                    open={vitalsModalOpen}
                    onClose={() => setVitalsModalOpen(false)}
                    title="Log today's vitals"
                    primaryLabel={loading ? 'Submitting…' : 'Submit'}
                    onPrimary={handleBiometricSubmit}
                    primaryDisabled={loading}
                >
                    <div className="space-y-3" role="form" aria-label="Record biometrics">
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label htmlFor="biometric-heart-rate" className="mb-1 block text-xs font-semibold text-[var(--muted)]">Heart rate (bpm)</label>
                                <input
                                    id="biometric-heart-rate"
                                    name="heartRate"
                                    type="number"
                                    placeholder="e.g. 72"
                                    className="w-full rounded-xl border px-3 py-2.5 text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:ring-2 focus:ring-[var(--primary)]"
                                    style={{ borderColor: 'var(--border)' }}
                                    value={biometricData.heartRate || ''}
                                    onChange={(e) => setBiometricData({
                                        ...biometricData,
                                        heartRate: e.target.value ? Number(e.target.value) : undefined,
                                    })}
                                />
                            </div>
                            <div>
                                <label htmlFor="biometric-temperature" className="mb-1 block text-xs font-semibold text-[var(--muted)]">Temperature (°C)</label>
                                <input
                                    id="biometric-temperature"
                                    name="temperature"
                                    type="number"
                                    placeholder="e.g. 36.8"
                                    className="w-full rounded-xl border px-3 py-2.5 text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:ring-2 focus:ring-[var(--primary)]"
                                    style={{ borderColor: 'var(--border)' }}
                                    value={biometricData.temperature || ''}
                                    onChange={(e) => setBiometricData({
                                        ...biometricData,
                                        temperature: e.target.value ? Number(e.target.value) : undefined,
                                    })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label htmlFor="biometric-systolic" className="mb-1 block text-xs font-semibold text-[var(--muted)]">Systolic (mmHg)</label>
                                <input
                                    id="biometric-systolic"
                                    name="bloodPressureSystolic"
                                    type="number"
                                    placeholder="e.g. 120"
                                    className="w-full rounded-xl border px-3 py-2.5 text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:ring-2 focus:ring-[var(--primary)]"
                                    style={{ borderColor: 'var(--border)' }}
                                    value={biometricData.bloodPressure?.systolic || ''}
                                    onChange={(e) => setBiometricData({
                                        ...biometricData,
                                        bloodPressure: {
                                            ...biometricData.bloodPressure!,
                                            systolic: Number(e.target.value) || 0,
                                        },
                                    })}
                                />
                            </div>
                            <div>
                                <label htmlFor="biometric-diastolic" className="mb-1 block text-xs font-semibold text-[var(--muted)]">Diastolic (mmHg)</label>
                                <input
                                    id="biometric-diastolic"
                                    name="bloodPressureDiastolic"
                                    type="number"
                                    placeholder="e.g. 80"
                                    className="w-full rounded-xl border px-3 py-2.5 text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:ring-2 focus:ring-[var(--primary)]"
                                    style={{ borderColor: 'var(--border)' }}
                                    value={biometricData.bloodPressure?.diastolic || ''}
                                    onChange={(e) => setBiometricData({
                                        ...biometricData,
                                        bloodPressure: {
                                            ...biometricData.bloodPressure!,
                                            diastolic: Number(e.target.value) || 0,
                                        },
                                    })}
                                />
                            </div>
                        </div>
                        <div>
                        <label htmlFor="biometric-spo2" className="mb-1 block text-xs font-semibold text-[var(--muted)]">Oxygen saturation (%)</label>
                        <input
                            id="biometric-spo2"
                            name="oxygenSaturation"
                            type="number"
                            placeholder="e.g. 98"
                            className="w-full rounded-xl border px-3 py-2.5 text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:ring-2 focus:ring-[var(--primary)]"
                            style={{ borderColor: 'var(--border)' }}
                            value={biometricData.oxygenSaturation || ''}
                            onChange={(e) => setBiometricData({
                                ...biometricData,
                                oxygenSaturation: e.target.value ? Number(e.target.value) : undefined,
                            })}
                        />
                        </div>
                    </div>
                </Modal>
            </DashboardLayout>
        </RoleGuard>
    );
}
