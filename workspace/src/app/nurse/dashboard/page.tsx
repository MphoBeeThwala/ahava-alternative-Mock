"use client";

import React, { useState, useEffect } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import { nurseApi, visitsApi, Visit } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import DashboardLayout from '../../../components/DashboardLayout';
import { Card, CardHeader, CardTitle } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/StatusBadge';

type VisitStatusFilter = 'ALL' | Visit['status'];

export default function NurseDashboard() {
    const { user } = useAuth();
    const toast = useToast();
    const [isAvailable, setIsAvailable] = useState(false);
    const [locationStatus, setLocationStatus] = useState('Unknown');
    const [loading, setLoading] = useState(false);
    const [visits, setVisits] = useState<Visit[]>([]);
    const [statusFilter, setStatusFilter] = useState<VisitStatusFilter>('ALL');

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
                    await nurseApi.updateAvailability({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        isAvailable: true,
                    });

                    setIsAvailable(true);
                    setLocationStatus(`Active at ${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`);
                    loadVisits(); // Refresh visits when going online
                } catch (error: unknown) {
                    const e = error as { response?: { data?: { error?: string } } };
                    console.error(error);
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
                await nurseApi.updateAvailability({
                    lat: 0,
                    lng: 0,
                    isAvailable: false,
                });
                setIsAvailable(false);
                setLocationStatus("Offline");
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
