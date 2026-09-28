"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import { nurseApi, visitsApi, Visit } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import DashboardLayout from '../../../components/DashboardLayout';
import { Card, CardHeader, CardTitle } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { PageHeader } from '../../../components/ui/PageHeader';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Icon } from '../../../components/ui/Icon';
import { useVisitWebSocket } from '../../../hooks/useVisitWebSocket';

type VisitStatusFilter = 'ALL' | Visit['status'];

interface IncomingBooking {
  bookingId: string;
  patientName: string;
  scheduledDate: string;
  estimatedDuration: number;
  amountInCents: number;
  distanceKm: number;
}

const ACCEPT_WINDOW_SEC = 30;

// BP-calibration reading during an in-progress visit (docs/ENGINEERING_PLAN.md
// #32) — the nurse-facing counterpart to visits.ts's POST /:id/biometrics.
// Local to this file since it's only used from one visit card.
function CalibrationForm({ visitId, onRecorded }: { visitId: string; onRecorded: () => void }) {
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const [systolic, setSystolic] = useState('');
    const [diastolic, setDiastolic] = useState('');
    const [heartRate, setHeartRate] = useState('');
    const [submitting, setSubmitting] = useState(false);

    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                className="mt-2 w-full rounded-lg border text-sm font-semibold"
                style={{ borderColor: 'var(--role-nurse)', color: 'var(--role-nurse)', minHeight: 'var(--tap-min)' }}
            >
                Record BP Calibration
            </button>
        );
    }

    const submit = async () => {
        const sys = Number(systolic);
        const dia = Number(diastolic);
        if (!Number.isFinite(sys) || sys < 60 || sys > 300) {
            toast.error('Enter a valid systolic reading (60-300).');
            return;
        }
        if (!Number.isFinite(dia) || dia < 30 || dia > 200) {
            toast.error('Enter a valid diastolic reading (30-200).');
            return;
        }
        setSubmitting(true);
        try {
            await visitsApi.recordBiometrics(visitId, {
                bloodPressureSystolic: sys,
                bloodPressureDiastolic: dia,
                heartRate: heartRate ? Number(heartRate) : undefined,
            });
            toast.success('Calibration reading recorded.');
            setOpen(false);
            setSystolic('');
            setDiastolic('');
            setHeartRate('');
            onRecorded();
        } catch (error: unknown) {
            const e = error as { response?: { data?: { error?: string } } };
            toast.error(e.response?.data?.error || 'Failed to record reading.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="mt-2 rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--role-nurse)' }}>
            <p className="text-xs font-semibold text-[var(--foreground)]">Record cuff BP reading</p>
            <div className="grid grid-cols-3 gap-2">
                <input
                    type="number"
                    inputMode="numeric"
                    placeholder="Systolic"
                    value={systolic}
                    onChange={(e) => setSystolic(e.target.value)}
                    className="rounded-lg border px-2 py-1.5 text-sm"
                    style={{ borderColor: 'var(--border)', minHeight: 'var(--tap-min)' }}
                />
                <input
                    type="number"
                    inputMode="numeric"
                    placeholder="Diastolic"
                    value={diastolic}
                    onChange={(e) => setDiastolic(e.target.value)}
                    className="rounded-lg border px-2 py-1.5 text-sm"
                    style={{ borderColor: 'var(--border)', minHeight: 'var(--tap-min)' }}
                />
                <input
                    type="number"
                    inputMode="numeric"
                    placeholder="Heart rate"
                    value={heartRate}
                    onChange={(e) => setHeartRate(e.target.value)}
                    className="rounded-lg border px-2 py-1.5 text-sm"
                    style={{ borderColor: 'var(--border)', minHeight: 'var(--tap-min)' }}
                />
            </div>
            <div className="flex gap-2">
                <button
                    onClick={submit}
                    disabled={submitting}
                    className="flex-1 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: 'var(--role-nurse)', minHeight: 'var(--tap-min)' }}
                >
                    {submitting ? 'Saving…' : 'Save reading'}
                </button>
                <button
                    onClick={() => setOpen(false)}
                    className="rounded-lg border px-3 text-sm"
                    style={{ borderColor: 'var(--border)', minHeight: 'var(--tap-min)' }}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

const VISIT_STATUS_FLOW: Record<string, { next: string; label: string } | undefined> = {
    SCHEDULED: { next: 'EN_ROUTE', label: 'Start journey' },
    EN_ROUTE: { next: 'ARRIVED', label: 'Mark arrived' },
    ARRIVED: { next: 'IN_PROGRESS', label: 'Start visit' },
    IN_PROGRESS: { next: 'COMPLETED', label: 'Finish visit' },
};

export default function NurseDashboard() {
    const { user, token } = useAuth();
    const toast = useToast();
    const [isAvailable, setIsAvailable] = useState(false);
    const [locationStatus, setLocationStatus] = useState('Unknown');
    const [loading, setLoading] = useState(false);
    const [visits, setVisits] = useState<Visit[]>([]);
    const [statusFilter, setStatusFilter] = useState<VisitStatusFilter>('ALL');
    // Requests waiting for this nurse, shown one at a time (head of the
    // queue). Going online can now deliver several open requests at once;
    // a single slot meant each one overwrote the last.
    const [offers, setOffers] = useState<IncomingBooking[]>([]);
    const incomingBooking = offers[0] ?? null;
    const removeOffer = useCallback((bookingId: string) => {
        setOffers((q) => q.filter((o) => o.bookingId !== bookingId));
    }, []);
    // Tied to a booking id so a new head never inherits the previous one's 0.
    const [countdown, setCountdown] = useState<{ id: string | null; left: number }>({ id: null, left: ACCEPT_WINDOW_SEC });
    const [acceptingId, setAcceptingId] = useState<string | null>(null);
    const accepting = acceptingId !== null;
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Where to register on the dispatch radar. Kept so the socket can
    // re-register after a page reload or reconnect without asking for GPS again.
    const lastCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

    const { send, lastMessage, connected } = useVisitWebSocket(token);

    const loadProfile = useCallback(async () => {
        try {
            const data = await nurseApi.getProfile();
            const profileUser = data.user || data;
            if (profileUser.lastKnownLat != null && profileUser.lastKnownLng != null) {
                lastCoordsRef.current = { lat: profileUser.lastKnownLat, lng: profileUser.lastKnownLng };
                setLocationStatus(`Active at ${profileUser.lastKnownLat.toFixed(4)}, ${profileUser.lastKnownLng.toFixed(4)}`);
            }
            setIsAvailable(profileUser.isAvailable || false);
        } catch (error) {
            console.error('Failed to load profile:', error);
        }
    }, []);

    const loadVisits = useCallback(async () => {
        try {
            const data = await nurseApi.getMyVisits();
            setVisits(data.visits || []);
        } catch (error) {
            console.error('Failed to load visits:', error);
        }
    }, []);

    useEffect(() => {
        if (user?.role !== 'NURSE') return;
        loadProfile();
        loadVisits();
    }, [user, loadProfile, loadVisits]);

    // The server's list of dispatchable nurses lives in memory and is tied to
    // the socket, so it is lost on every reload, reconnect or backend
    // restart. Previously NURSE_GO_ONLINE was only sent from the toggle
    // (and dropped silently if the socket wasn't connected yet), so a nurse
    // whose profile still said "online" saw "Live radar active" but never
    // received a single request. Re-register whenever the socket (re)connects.
    useEffect(() => {
        if (!connected || !isAvailable || !lastCoordsRef.current) return;
        send({ type: 'NURSE_GO_ONLINE', data: lastCoordsRef.current });
    }, [connected, isAvailable, send]);

    const toggleAvailability = async () => {
        setLoading(true);

        if (!navigator.geolocation) {
            toast.error("Geolocation is not supported by your browser");
            setLoading(false);
            return;
        }

        if (!isAvailable) {
            navigator.geolocation.getCurrentPosition(async (position) => {
                try {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    await nurseApi.updateAvailability({ lat, lng, isAvailable: true });
                    lastCoordsRef.current = { lat, lng };
                    setIsAvailable(true); // registers on the socket via the effect above
                    setLocationStatus(`Active at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
                    loadVisits();
                } catch (error: unknown) {
                    const e = error as { response?: { data?: { error?: string } } };
                    toast.error(e.response?.data?.error || "Failed to go online. Check network.");
                } finally {
                    setLoading(false);
                }
            }, () => {
                toast.error("Location access denied. Cannot go online.");
                setLoading(false);
            }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
        } else {
            try {
                await nurseApi.updateAvailability({ isAvailable: false });
                send({ type: 'NURSE_GO_OFFLINE' });
                setIsAvailable(false);
                setLocationStatus("Offline");
                setOffers([]);
                setAcceptingId(null);
            } catch (error: unknown) {
                const e = error as { response?: { data?: { error?: string } } };
                toast.error(e.response?.data?.error || "Failed to go offline.");
            } finally {
                setLoading(false);
            }
        }
    };

    const handleVisitStatusUpdate = async (visitId: string, status: string) => {
        try {
            await visitsApi.updateStatus(visitId, status);
            loadVisits();
        } catch (error: unknown) {
            const e = error as { response?: { data?: { error?: string } } };
            toast.error(e.response?.data?.error || "Failed to update visit status.");
        }
    };

    // Stream position while online: keeps the dispatch radius accurate as the
    // nurse moves, and feeds the patient's live tracker (NURSE_LOCATION_UPDATE),
    // which nothing ever sent before. Throttled to one update per 20s.
    useEffect(() => {
        if (!isAvailable || !connected || typeof navigator === 'undefined' || !navigator.geolocation) return;
        let lastSent = 0;
        const watchId = navigator.geolocation.watchPosition((position) => {
            const now = Date.now();
            if (now - lastSent < 20_000) return;
            lastSent = now;
            const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
            lastCoordsRef.current = coords;
            send({ type: 'LOCATION_UPDATE', data: coords });
        }, () => { /* keep the last known position */ }, { enableHighAccuracy: true, maximumAge: 30_000 });
        return () => navigator.geolocation.clearWatch(watchId);
    }, [isAvailable, connected, send]);

    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === 'NEW_BOOKING_AVAILABLE') {
            const d = lastMessage.data as unknown as IncomingBooking;
            setOffers((q) => (q.some((o) => o.bookingId === d.bookingId) ? q : [...q, d]));
            toast.info(`New visit request — ${d.patientName} (${d.distanceKm} km away)`);
        }
        if (lastMessage.type === 'BOOKING_TAKEN') {
            const takenId = (lastMessage.data as { bookingId?: string } | undefined)?.bookingId;
            if (takenId) removeOffer(takenId);
        }
        if (lastMessage.type === 'ACCEPT_BOOKING_SUCCESS') {
            const id = (lastMessage.data as { bookingId?: string } | undefined)?.bookingId ?? acceptingId;
            if (id) removeOffer(id);
            setAcceptingId(null);
            toast.success('Visit accepted! Check your visits list.');
            loadVisits();
        }
        if (lastMessage.type === 'ACCEPT_BOOKING_FAILED') {
            if (acceptingId) removeOffer(acceptingId);
            setAcceptingId(null);
            toast.error(lastMessage.error || 'Could not accept — booking already taken.');
        }
        if (lastMessage.type === 'NURSE_ONLINE_SUCCESS') {
            toast.success('You are now online. Listening for nearby requests.');
        }
        if (lastMessage.type === 'NURSE_ONLINE_FAILED') {
            toast.error(lastMessage.error || 'Could not register for nearby requests.');
        }
        // lastMessage is the only trigger; acceptingId is read, not reacted to.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastMessage, toast, loadVisits, removeOffer]);

    // Accept window: tick down once per second while a request is showing.
    // The expiry side effects live in their own effect below rather than
    // inside the setState updater (React may run updaters twice, which sent
    // DECLINE_BOOKING twice in dev).
    const incomingId = incomingBooking?.bookingId ?? null;
    useEffect(() => {
        if (!incomingId || accepting) return;
        setCountdown((c) => (c.id === incomingId ? c : { id: incomingId, left: ACCEPT_WINDOW_SEC }));
        countdownRef.current = setInterval(() => {
            setCountdown((c) => (c.id === incomingId ? { id: c.id, left: Math.max(0, c.left - 1) } : c));
        }, 1000);
        return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
    }, [incomingId, accepting]);

    useEffect(() => {
        if (!incomingId || accepting || countdown.id !== incomingId || countdown.left > 0) return;
        send({ type: 'DECLINE_BOOKING', data: { bookingId: incomingId } });
        removeOffer(incomingId);
    }, [countdown, incomingId, accepting, send, removeOffer]);
    const secondsLeft = countdown.id === incomingId ? countdown.left : ACCEPT_WINDOW_SEC;

    // If the socket drops mid-accept the result will never arrive; don't leave
    // the card spinning forever. The visits list is the source of truth.
    useEffect(() => {
        if (connected || !acceptingId) return;
        removeOffer(acceptingId);
        setAcceptingId(null);
        toast.error('Connection lost while accepting — check My visits to see if it went through.');
        loadVisits();
    }, [connected, acceptingId, toast, loadVisits, removeOffer]);

    const handleAccept = () => {
        if (!incomingBooking || accepting) return;
        const sent = send({ type: 'ACCEPT_BOOKING', data: { bookingId: incomingBooking.bookingId } });
        if (!sent) {
            toast.error('Not connected — could not accept. Check your connection.');
            return;
        }
        setAcceptingId(incomingBooking.bookingId);
        if (countdownRef.current) clearInterval(countdownRef.current);
    };

    const handlePass = () => {
        if (!incomingBooking || accepting) return;
        send({ type: 'DECLINE_BOOKING', data: { bookingId: incomingBooking.bookingId } });
        removeOffer(incomingBooking.bookingId);
        if (countdownRef.current) clearInterval(countdownRef.current);
    };

    const filteredVisits = statusFilter === 'ALL' ? visits : visits.filter((v) => v.status === statusFilter);
    const activeVisit = visits.find((v) => v.status === 'IN_PROGRESS');

    return (
        <RoleGuard allowedRoles={[UserRole.NURSE]}>
            <DashboardLayout>
                <PageHeader
                    title={`Hi, ${user?.firstName ?? ''}`}
                    subtitle={locationStatus}
                    right={
                        <span className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: isAvailable ? 'rgba(5,150,105,0.1)' : 'rgba(107,114,128,0.1)', color: isAvailable ? 'var(--success)' : 'var(--muted)' }}>
                            <span className="h-2 w-2 rounded-full" style={{ background: isAvailable ? 'var(--success)' : '#6b7280' }} />
                            {isAvailable ? 'Online' : 'Offline'}
                        </span>
                    }
                />

                <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
                    {isAvailable && (
                        <div className="flex items-center gap-2.5 rounded-xl border px-4 py-2.5" style={{ background: connected ? 'rgba(5,150,105,0.06)' : 'rgba(217,119,6,0.06)', borderColor: connected ? 'rgba(5,150,105,0.2)' : 'rgba(217,119,6,0.25)' }}>
                            {connected ? (
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--success)' }} />
                            ) : (
                                <Icon name="signal-off" size={14} />
                            )}
                            <span className="text-sm font-semibold" style={{ color: connected ? 'var(--success)' : 'var(--warning)' }}>
                                {connected ? 'Live radar active — listening within 10 km' : 'Reconnecting to live radar…'}
                            </span>
                        </div>
                    )}

                    {/* Incoming booking — mobile-first, one-handed: big Accept, countdown ring */}
                    {incomingBooking && (
                        <Card padding="sm" style={{ border: '2px solid var(--primary)' }}>
                            <div className="mb-3 flex items-center justify-between">
                                <span className="flex items-center gap-2 text-sm font-extrabold text-[var(--primary)]">
                                    <Icon name="bell" size={16} /> New visit request
                                    {offers.length > 1 && <span className="text-xs font-semibold text-[var(--muted)]">+{offers.length - 1} more</span>}
                                </span>
                                <div className="relative flex h-10 w-10 items-center justify-center">
                                    <svg width="40" height="40" viewBox="0 0 40 40" className="-rotate-90">
                                        <circle cx="20" cy="20" r="16" fill="none" stroke="var(--border)" strokeWidth={4} />
                                        <circle
                                            cx="20" cy="20" r="16" fill="none" stroke="var(--primary)" strokeWidth={4}
                                            strokeDasharray={2 * Math.PI * 16}
                                            strokeDashoffset={2 * Math.PI * 16 * (1 - secondsLeft / ACCEPT_WINDOW_SEC)}
                                            style={{ transition: 'stroke-dashoffset 1s linear' }}
                                        />
                                    </svg>
                                    <span className="num absolute text-xs font-bold text-[var(--foreground)]">{secondsLeft}</span>
                                </div>
                            </div>
                            <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
                                <div><p className="text-[var(--text-eyebrow)] font-bold uppercase text-[var(--ink-3)]">Patient</p><p className="font-bold text-[var(--foreground)]">{incomingBooking.patientName}</p></div>
                                <div><p className="text-[var(--text-eyebrow)] font-bold uppercase text-[var(--ink-3)]">Distance</p><p className="num font-bold text-[var(--foreground)]">{incomingBooking.distanceKm} km</p></div>
                                <div><p className="text-[var(--text-eyebrow)] font-bold uppercase text-[var(--ink-3)]">Payout</p><p className="num font-bold text-[var(--success)]">R{(incomingBooking.amountInCents / 100).toFixed(0)}</p></div>
                                <div><p className="text-[var(--text-eyebrow)] font-bold uppercase text-[var(--ink-3)]">Duration</p><p className="num font-bold text-[var(--foreground)]">{incomingBooking.estimatedDuration} min</p></div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={handleAccept} disabled={accepting} className="btn-primary flex-[2] rounded-xl font-bold disabled:opacity-60" style={{ minHeight: 'var(--tap-primary)' }}>
                                    {accepting ? 'Accepting…' : 'Accept'}
                                </button>
                                <button onClick={handlePass} disabled={accepting} className="flex-1 rounded-xl border font-semibold disabled:opacity-60" style={{ borderColor: 'var(--border)', minHeight: 'var(--tap-primary)' }}>
                                    Pass
                                </button>
                            </div>
                        </Card>
                    )}

                    {/* Availability toggle — full-width, large tap target, mobile-first */}
                    <Card padding="sm">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-bold text-[var(--foreground)]">{isAvailable ? 'You are online' : 'You are offline'}</p>
                                <p className="mt-0.5 text-xs text-[var(--muted)]">Going online makes you visible to patients within 10km.</p>
                            </div>
                        </div>
                        <button
                            onClick={toggleAvailability}
                            disabled={loading}
                            className="mt-3 w-full rounded-xl font-bold text-white disabled:opacity-60"
                            style={{ background: isAvailable ? 'var(--acuity-emergency)' : 'var(--success)', minHeight: 'var(--tap-primary)' }}
                        >
                            {loading ? 'Updating…' : (isAvailable ? 'Go offline' : 'Go online')}
                        </button>
                    </Card>

                    {/* Active visit — always-reachable finish action while IN_PROGRESS */}
                    {activeVisit && (
                        <Card padding="sm" style={{ borderColor: 'var(--role-nurse)' }}>
                            <p className="text-[var(--text-eyebrow)] font-bold uppercase text-[var(--role-nurse)]">Visit in progress</p>
                            <p className="mt-1 text-sm font-semibold text-[var(--foreground)]" style={{ wordBreak: 'break-word' }}>{activeVisit.booking?.address ?? 'Address on file'}</p>
                            <button
                                onClick={() => handleVisitStatusUpdate(activeVisit.id, 'COMPLETED')}
                                className="btn-primary mt-3 w-full rounded-xl font-bold"
                                style={{ minHeight: 'var(--tap-primary)' }}
                            >
                                Finish visit
                            </button>
                        </Card>
                    )}

                    {/* Visits list */}
                    <Card padding="sm">
                        <CardHeader className="mb-3 flex flex-row flex-wrap items-center justify-between gap-3">
                            <CardTitle className="mb-0">My visits</CardTitle>
                            {visits.length > 0 && (
                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value as VisitStatusFilter)}
                                    className="rounded-lg border px-3 py-2 text-sm text-[var(--foreground)]"
                                    style={{ borderColor: 'var(--border)' }}
                                >
                                    <option value="ALL">All status</option>
                                    <option value="SCHEDULED">Scheduled</option>
                                    <option value="EN_ROUTE">En route</option>
                                    <option value="ARRIVED">Arrived</option>
                                    <option value="IN_PROGRESS">In progress</option>
                                    <option value="COMPLETED">Completed</option>
                                </select>
                            )}
                        </CardHeader>
                        {filteredVisits.length === 0 ? (
                            <EmptyState icon="calendar" message={visits.length === 0 ? 'No visits assigned yet' : 'No visits match the filter'} />
                        ) : (
                            <div className="space-y-3">
                                {filteredVisits.map((visit) => {
                                    const flow = VISIT_STATUS_FLOW[visit.status];
                                    return (
                                        <div key={visit.id} className="rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
                                            <div className="mb-2 flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-[var(--foreground)]">Visit #{visit.id.slice(0, 8)}</p>
                                                    <p className="text-sm text-[var(--muted)]">
                                                        {visit.booking?.scheduledDate ? new Date(visit.booking.scheduledDate).toLocaleString() : 'Date TBD'}
                                                    </p>
                                                    <p className="truncate text-sm text-[var(--muted)]" title={visit.booking?.address}>{visit.booking?.address ?? 'Address on file'}</p>
                                                </div>
                                                <StatusBadge variant={visit.status === 'COMPLETED' ? 'success' : 'warning'} className="shrink-0 text-xs">
                                                    {visit.status}
                                                </StatusBadge>
                                            </div>
                                            {flow && (
                                                <button
                                                    onClick={() => handleVisitStatusUpdate(visit.id, flow.next)}
                                                    className="mt-2 w-full rounded-lg text-sm font-semibold text-white"
                                                    style={{ background: 'var(--role-nurse)', minHeight: 'var(--tap-min)' }}
                                                >
                                                    {flow.label}
                                                </button>
                                            )}
                                            {visit.status === 'IN_PROGRESS' && (
                                                <CalibrationForm visitId={visit.id} onRecorded={loadVisits} />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Card>
                </div>
            </DashboardLayout>
        </RoleGuard>
    );
}
