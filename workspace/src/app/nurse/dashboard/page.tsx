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
                <div className="p-6 sm:p-8 bg-[var(--background)] min-h-screen">
                <div className="mb-8">
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">Nurse Portal</h1>
                    <p className="text-slate-700 font-medium">Welcome, {user?.firstName} {user?.lastName}</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                    {/* Availability Card */}
                    <div className="lg:col-span-1">
                        <div className="max-w-md mx-auto bg-white rounded-2xl shadow-lg overflow-hidden">
                            <div className={`h-32 flex items-center justify-center transition-colors duration-500 ${
                                isAvailable ? 'bg-emerald-500' : 'bg-slate-700'
                            }`}>
                                <span className="text-4xl">{isAvailable ? '🟢' : '⚫'}</span>
                            </div>

                            <div className="p-8 text-center">
                                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                                    {isAvailable ? 'You are Online' : 'You are Offline'}
                                </h2>
                                <p className="text-slate-600 font-medium mb-8">{locationStatus}</p>

                                <button
                                    onClick={toggleAvailability}
                                    disabled={loading}
                                    className={`w-full py-4 text-lg font-bold rounded-xl text-white shadow-lg transform transition active:scale-95 ${
                                        isAvailable
                                            ? 'bg-red-500 hover:bg-red-600 shadow-red-200'
                                            : 'bg-green-600 hover:bg-green-700 shadow-green-200'
                                    }`}
                                >
                                    {loading ? 'Updating...' : (isAvailable ? 'GO OFFLINE' : 'GO ONLINE')}
                                </button>

                                <p className="mt-6 text-xs text-slate-600">
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
                    </div>
                </div>
                </div>
            </DashboardLayout>
        </RoleGuard>
    );
}
