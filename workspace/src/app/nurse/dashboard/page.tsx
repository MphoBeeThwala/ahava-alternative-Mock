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
    const [incomingBooking, setIncomingBooking] = useState<IncomingBooking | null>(null);
    const [countdown, setCountdown] = useState(ACCEPT_WINDOW_SEC);
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const { send, lastMessage, connected } = useVisitWebSocket(token);

    const loadProfile = useCallback(async () => {
        try {
            const data = await nurseApi.getProfile();
            const profileUser = data.user || data;
            setIsAvailable(profileUser.isAvailable || false);
            if (profileUser.lastKnownLat && profileUser.lastKnownLng) {
                setLocationStatus(`Active at ${profileUser.lastKnownLat.toFixed(4)}, ${profileUser.lastKnownLng.toFixed(4)}`);
            }
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

    const goOnlineViaWs = useCallback((lat: number, lng: number) => {
        send({ type: 'NURSE_GO_ONLINE', data: { lat, lng } });
    }, [send]);

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
                    setIsAvailable(true);
                    setLocationStatus(`Active at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
                    goOnlineViaWs(lat, lng);
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
            });
        } else {
            try {
                await nurseApi.updateAvailability({ lat: 0, lng: 0, isAvailable: false });
                send({ type: 'NURSE_GO_OFFLINE' });
                setIsAvailable(false);
                setLocationStatus("Offline");
                setIncomingBooking(null);
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

    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === 'NEW_BOOKING_AVAILABLE') {
            const d = lastMessage.data as unknown as IncomingBooking;
            setIncomingBooking(d);
            setCountdown(ACCEPT_WINDOW_SEC);
            toast.info(`New visit request — ${d.patientName} (${d.distanceKm} km away)`);
        }
        if (lastMessage.type === 'BOOKING_TAKEN') {
            setIncomingBooking(null);
            if (countdownRef.current) clearInterval(countdownRef.current);
        }
        if (lastMessage.type === 'ACCEPT_BOOKING_SUCCESS') {
            setIncomingBooking(null);
            if (countdownRef.current) clearInterval(countdownRef.current);
            toast.success('Visit accepted! Check your visits list.');
            loadVisits();
        }
        if (lastMessage.type === 'ACCEPT_BOOKING_FAILED') {
            setIncomingBooking(null);
            toast.error(lastMessage.error || 'Could not accept — booking already taken.');
        }
        if (lastMessage.type === 'NURSE_ONLINE_SUCCESS') {
            toast.success('You are now online. Listening for nearby requests.');
        }
    }, [lastMessage, toast, loadVisits]);

    useEffect(() => {
        if (incomingBooking) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            countdownRef.current = setInterval(() => {
                setCountdown((c) => {
                    if (c <= 1) {
                        clearInterval(countdownRef.current!);
                        setIncomingBooking(null);
                        send({ type: 'DECLINE_BOOKING', data: { bookingId: incomingBooking.bookingId } });
                        return ACCEPT_WINDOW_SEC;
                    }
                    return c - 1;
                });
            }, 1000);
        }
        return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
    }, [incomingBooking, send]);

    const handleAccept = () => {
        if (!incomingBooking) return;
        send({ type: 'ACCEPT_BOOKING', data: { bookingId: incomingBooking.bookingId } });
        if (countdownRef.current) clearInterval(countdownRef.current);
    };

    const handlePass = () => {
        if (!incomingBooking) return;
        send({ type: 'DECLINE_BOOKING', data: { bookingId: incomingBooking.bookingId } });
        setIncomingBooking(null);
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
                                </span>
                                <div className="relative flex h-10 w-10 items-center justify-center">
                                    <svg width="40" height="40" viewBox="0 0 40 40" className="-rotate-90">
                                        <circle cx="20" cy="20" r="16" fill="none" stroke="var(--border)" strokeWidth={4} />
                                        <circle
                                            cx="20" cy="20" r="16" fill="none" stroke="var(--primary)" strokeWidth={4}
                                            strokeDasharray={2 * Math.PI * 16}
                                            strokeDashoffset={2 * Math.PI * 16 * (1 - countdown / ACCEPT_WINDOW_SEC)}
                                            style={{ transition: 'stroke-dashoffset 1s linear' }}
                                        />
                                    </svg>
                                    <span className="num absolute text-xs font-bold text-[var(--foreground)]">{countdown}</span>
                                </div>
                            </div>
                            <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
                                <div><p className="text-[var(--text-eyebrow)] font-bold uppercase text-[var(--ink-3)]">Patient</p><p className="font-bold text-[var(--foreground)]">{incomingBooking.patientName}</p></div>
                                <div><p className="text-[var(--text-eyebrow)] font-bold uppercase text-[var(--ink-3)]">Distance</p><p className="num font-bold text-[var(--foreground)]">{incomingBooking.distanceKm} km</p></div>
                                <div><p className="text-[var(--text-eyebrow)] font-bold uppercase text-[var(--ink-3)]">Payout</p><p className="num font-bold text-[var(--success)]">R{(incomingBooking.amountInCents / 100).toFixed(0)}</p></div>
                                <div><p className="text-[var(--text-eyebrow)] font-bold uppercase text-[var(--ink-3)]">Duration</p><p className="num font-bold text-[var(--foreground)]">{incomingBooking.estimatedDuration} min</p></div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={handleAccept} className="btn-primary flex-[2] rounded-xl font-bold" style={{ minHeight: 'var(--tap-primary)' }}>
                                    Accept
                                </button>
                                <button onClick={handlePass} className="flex-1 rounded-xl border font-semibold" style={{ borderColor: 'var(--border)', minHeight: 'var(--tap-primary)' }}>
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
                            <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">{activeVisit.booking?.encryptedAddress ?? 'Address on file'}</p>
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
                                                    <p className="truncate text-sm text-[var(--muted)]">{visit.booking?.encryptedAddress ?? 'Address on file'}</p>
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
