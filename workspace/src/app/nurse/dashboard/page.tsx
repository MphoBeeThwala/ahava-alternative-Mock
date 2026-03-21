"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import { nurseApi, visitsApi, Visit } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import DashboardLayout from '../../../components/DashboardLayout';
import { Card, CardHeader, CardTitle } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/StatusBadge';
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

export default function NurseDashboard() {
    const { user, token } = useAuth();
    const toast = useToast();
    const [isAvailable, setIsAvailable] = useState(false);
    const [locationStatus, setLocationStatus] = useState('Unknown');
    const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const [visits, setVisits] = useState<Visit[]>([]);
    const [statusFilter, setStatusFilter] = useState<VisitStatusFilter>('ALL');
    const [incomingBooking, setIncomingBooking] = useState<IncomingBooking | null>(null);
    const [countdown, setCountdown] = useState(ACCEPT_WINDOW_SEC);
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const { send, lastMessage, connected } = useVisitWebSocket(token);

    useEffect(() => {
        loadProfile();
        loadVisits();
    }, []);

    const loadProfile = async () => {
        try {
            const data = await nurseApi.getProfile();
            const user = data.user || data;
            setIsAvailable(user.isAvailable || false);
            if (user.lastKnownLat && user.lastKnownLng) {
                setLocationStatus(`Active at ${user.lastKnownLat.toFixed(4)}, ${user.lastKnownLng.toFixed(4)}`);
            }
        } catch (error) {
            console.error('Failed to load profile:', error);
        }
    };

    const loadVisits = async () => {
        try {
            const data = await nurseApi.getMyVisits();
            setVisits(data.visits || []);
        } catch (error) {
            console.error('Failed to load visits:', error);
        }
    };

    const toggleAvailability = async () => {
        setLoading(true);

        if (!navigator.geolocation) {
            toast.error("Geolocation is not supported by your browser");
            setLoading(false);
            return;
        }

        if (!isAvailable) {
            // Going ONLINE: Need Location
            navigator.geolocation.getCurrentPosition(async (position) => {
                try {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    await nurseApi.updateAvailability({ lat, lng, isAvailable: true });
                    setCurrentCoords({ lat, lng });
                    setIsAvailable(true);
                    setLocationStatus(`Active at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
                    // Also register in the WS server's onlineNurses map for real-time matching
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
            // Going OFFLINE
            try {
                await nurseApi.updateAvailability({ lat: 0, lng: 0, isAvailable: false });
                send({ type: 'NURSE_GO_OFFLINE' });
                setIsAvailable(false);
                setLocationStatus("Offline");
                setCurrentCoords(null);
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

    // ── WebSocket: handle incoming booking notifications ──
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === 'NEW_BOOKING_AVAILABLE') {
            const d = lastMessage.data as unknown as IncomingBooking;
            setIncomingBooking(d);
            setCountdown(ACCEPT_WINDOW_SEC);
            toast.info(`📢 New visit request — ${d.patientName} (${d.distanceKm} km away)`);
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
    }, [lastMessage]);

    // Countdown timer when incoming booking arrives
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
    }, [incomingBooking]);

    // When going online via WS, also send NURSE_GO_ONLINE with GPS
    const goOnlineViaWs = useCallback((lat: number, lng: number) => {
        send({ type: 'NURSE_GO_ONLINE', data: { lat, lng } });
    }, [send]);

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

    return (
        <RoleGuard allowedRoles={[UserRole.NURSE]}>
            <DashboardLayout>
                <div style={{ background: 'var(--background)', minHeight: '100vh' }}>

                    {/* ── Hero banner ── */}
                    <div style={{ background: isAvailable ? 'linear-gradient(135deg,#064e3b 0%,#065f46 60%,#047857 100%)' : 'linear-gradient(135deg,#0a1628 0%,#1e293b 60%,#0f2027 100%)', padding: '32px 40px 28px', position: 'relative', overflow: 'hidden', transition: 'background 0.5s ease' }}>
                        <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,255,255,0.06),transparent 70%)', pointerEvents: 'none' }} />
                        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                            <div>
                                <p style={{ color: 'rgba(167,243,208,0.8)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Nurse Portal</p>
                                <h1 style={{ color: 'white', fontSize: 'clamp(22px,3vw,30px)', fontWeight: 900, margin: 0 }}>
                                    Welcome, {user?.firstName} {user?.lastName} 👩‍⚕️
                                </h1>
                                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 4 }}>Manage your availability, track visits, and serve patients near you.</p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14, padding: '10px 18px' }}>
                                <div style={{ width: 10, height: 10, borderRadius: '50%', background: isAvailable ? '#34d399' : '#6b7280', boxShadow: isAvailable ? '0 0 8px #34d399' : 'none', transition: 'all 0.3s' }} />
                                <span style={{ color: 'white', fontSize: 13, fontWeight: 700 }}>{isAvailable ? 'Online — Accepting visits' : 'Offline'}</span>
                            </div>
                        </div>
                    </div>

                <div className="p-6 sm:p-8">

                {/* ── WS status strip ── */}
                {isAvailable && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '10px 16px', borderRadius: 12, background: connected ? 'rgba(5,150,105,0.08)' : 'rgba(217,119,6,0.08)', border: `1px solid ${connected ? 'rgba(5,150,105,0.2)' : 'rgba(217,119,6,0.25)'}` }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#059669' : '#d97706', boxShadow: connected ? '0 0 6px #059669' : 'none', animation: connected ? 'pulse 2s infinite' : 'none' }} />
                        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
                        <span style={{ fontSize: 13, fontWeight: 600, color: connected ? '#059669' : '#d97706' }}>
                            {connected ? '🛰 Live radar active — listening for requests within 10 km' : '⚠️ Reconnecting to live radar…'}
                        </span>
                    </div>
                )}

                {/* ── Incoming booking request card (Uber-style) ── */}
                {incomingBooking && (
                    <div style={{ marginBottom: 24, borderRadius: 20, overflow: 'hidden', boxShadow: '0 8px 40px rgba(13,148,136,0.25)', border: '2px solid #0d9488', animation: 'slideIn 0.3s ease-out' }}>
                        <style>{`@keyframes slideIn{from{transform:translateY(-20px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>

                        {/* Top bar with countdown */}
                        <div style={{ background: 'linear-gradient(135deg,#0d9488,#059669)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontSize: 20 }}>📢</span>
                                <span style={{ color: 'white', fontWeight: 800, fontSize: 15 }}>New Visit Request!</span>
                            </div>
                            {/* Countdown ring */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <svg width="44" height="44" viewBox="0 0 44 44" style={{ transform: 'rotate(-90deg)' }}>
                                    <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="4" />
                                    <circle cx="22" cy="22" r="18" fill="none" stroke="white" strokeWidth="4"
                                        strokeDasharray={`${2 * Math.PI * 18}`}
                                        strokeDashoffset={`${2 * Math.PI * 18 * (1 - countdown / ACCEPT_WINDOW_SEC)}`}
                                        style={{ transition: 'stroke-dashoffset 1s linear' }}
                                    />
                                </svg>
                                <span style={{ position: 'absolute', color: 'white', fontWeight: 800, fontSize: 13, marginLeft: 14 }}>{countdown}</span>
                            </div>
                        </div>

                        {/* Request details */}
                        <div style={{ background: 'white', padding: '20px 24px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 8px', marginBottom: 20 }}>
                                <div>
                                    <p style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Patient</p>
                                    <p style={{ fontSize: 15, fontWeight: 800, color: 'var(--foreground)' }}>{incomingBooking.patientName}</p>
                                </div>
                                <div>
                                    <p style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Distance</p>
                                    <p style={{ fontSize: 15, fontWeight: 800, color: 'var(--foreground)' }}>{incomingBooking.distanceKm} km</p>
                                </div>
                                <div>
                                    <p style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Payout</p>
                                    <p style={{ fontSize: 15, fontWeight: 800, color: '#059669' }}>R{(incomingBooking.amountInCents / 100).toFixed(0)}</p>
                                </div>
                                <div>
                                    <p style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Duration</p>
                                    <p style={{ fontSize: 15, fontWeight: 800, color: 'var(--foreground)' }}>{incomingBooking.estimatedDuration} min</p>
                                </div>
                                <div style={{ gridColumn: 'span 2' }}>
                                    <p style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Scheduled</p>
                                    <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>
                                        {new Date(incomingBooking.scheduledDate).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                                    </p>
                                </div>
                            </div>

                            {/* Accept / Pass buttons */}
                            <div style={{ display: 'flex', gap: 12 }}>
                                <button
                                    onClick={handleAccept}
                                    style={{ flex: 2, padding: '15px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#059669,#047857)', color: 'white', fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(5,150,105,0.4)', transition: 'transform 0.15s' }}
                                    onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
                                    onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                                >
                                    ✓ Accept
                                </button>
                                <button
                                    onClick={handlePass}
                                    style={{ flex: 1, padding: '15px', borderRadius: 14, border: '1.5px solid var(--border)', background: 'white', color: 'var(--muted)', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                                >
                                    Pass
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                    {/* Availability Card */}
                    <div className="lg:col-span-1">
                        <div style={{ background: 'white', borderRadius: 20, border: '1.5px solid var(--border)', overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
                            {/* Status header */}
                            <div style={{ height: 100, background: isAvailable ? 'linear-gradient(135deg,#059669,#047857)' : 'linear-gradient(135deg,#374151,#1f2937)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'background 0.4s ease' }}>
                                <span style={{ fontSize: 32 }}>{isAvailable ? '🟢' : '⚫'}</span>
                                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                    {isAvailable ? 'SANC Verified · Active' : 'Currently Unavailable'}
                                </span>
                            </div>

                            <div style={{ padding: '24px', textAlign: 'center' }}>
                                <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--foreground)', marginBottom: 6 }}>
                                    {isAvailable ? 'You are Online' : 'You are Offline'}
                                </h2>
                                <p style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 500, marginBottom: 24 }}>{locationStatus}</p>

                                <button
                                    onClick={toggleAvailability}
                                    disabled={loading}
                                    style={{ width: '100%', padding: '14px', fontSize: 15, fontWeight: 700, borderRadius: 12, border: 'none', color: 'white', cursor: loading ? 'not-allowed' : 'pointer', background: isAvailable ? 'linear-gradient(135deg,#ef4444,#dc2626)' : 'linear-gradient(135deg,#059669,#047857)', boxShadow: isAvailable ? '0 4px 14px rgba(239,68,68,0.3)' : '0 4px 14px rgba(5,150,105,0.35)', fontFamily: 'inherit', transition: 'all 0.2s', opacity: loading ? 0.6 : 1 }}
                                >
                                    {loading ? 'Updating...' : (isAvailable ? 'GO OFFLINE' : 'GO ONLINE')}
                                </button>

                                <p style={{ marginTop: 16, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
                                    Going online makes you visible to patients within 10km.
                                    <br />Battery usage may increase due to GPS.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Visits List */}
                    <div className="lg:col-span-2">
                        <Card>
                            <CardHeader className="flex flex-row flex-wrap justify-between items-center gap-4">
                                <CardTitle className="mb-0">My Visits</CardTitle>
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
                                <p className="font-medium text-[var(--muted)]">
                                    {visits.length === 0 ? 'No visits assigned yet.' : 'No visits match the filter.'}
                                </p>
                            ) : (
                                <div className="space-y-4">
                                    {filteredVisits.map((visit) => (
                                        <div key={visit.id} className="p-4 rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                                            <div className="flex justify-between items-start mb-2">
                                                <div>
                                                    <p className="font-semibold text-[var(--foreground)]">Visit #{visit.id.slice(0, 8)}</p>
                                                    <p className="text-sm text-[var(--muted)]">
                                                        {visit.booking?.scheduledDate
                                                            ? new Date(visit.booking.scheduledDate).toLocaleString()
                                                            : 'Date TBD'}
                                                    </p>
                                                    <p className="text-sm text-[var(--muted)]">{visit.booking?.address}</p>
                                                </div>
                                                <StatusBadge
                                                    variant={visit.status === 'COMPLETED' ? 'success' : 'warning'}
                                                    className="text-xs"
                                                >
                                                    {visit.status}
                                                </StatusBadge>
                                            </div>
                                            <div className="flex gap-2 mt-4">
                                                {visit.status === 'SCHEDULED' && (
                                                    <button
                                                        onClick={() => handleVisitStatusUpdate(visit.id, 'EN_ROUTE')}
                                                        className="px-4 py-2 rounded text-sm font-medium text-white transition"
                                                        style={{ backgroundColor: 'var(--primary)' }}
                                                    >
                                                        Start Journey
                                                    </button>
                                                )}
                                                {visit.status === 'EN_ROUTE' && (
                                                    <button
                                                        onClick={() => handleVisitStatusUpdate(visit.id, 'ARRIVED')}
                                                        className="px-4 py-2 rounded text-sm font-medium text-white bg-green-600 hover:bg-green-700 transition"
                                                    >
                                                        Mark Arrived
                                                    </button>
                                                )}
                                                {visit.status === 'ARRIVED' && (
                                                    <button
                                                        onClick={() => handleVisitStatusUpdate(visit.id, 'IN_PROGRESS')}
                                                        className="px-4 py-2 rounded text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 transition"
                                                    >
                                                        Start Visit
                                                    </button>
                                                )}
                                                {visit.status === 'IN_PROGRESS' && (
                                                    <button
                                                        onClick={() => handleVisitStatusUpdate(visit.id, 'COMPLETED')}
                                                        className="px-4 py-2 rounded text-sm font-medium text-white transition"
                                                        style={{ backgroundColor: 'var(--success)' }}
                                                    >
                                                        Complete Visit
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>
                    </div>{/* col-span-2 */}
                </div>{/* grid */}
                </div>{/* p-6 */}
                </div>{/* outer bg */}
            </DashboardLayout>
        </RoleGuard>
    );
}
