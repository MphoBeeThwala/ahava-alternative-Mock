"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import { patientApi, bookingsApi, BiometricReading, MonitoringSummary, Booking } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import DashboardLayout from '../../../components/DashboardLayout';
import { Card, CardHeader, CardTitle } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/StatusBadge';

export default function PatientDashboard() {
    const { user } = useAuth();
    const toast = useToast();
    const [loading, setLoading] = useState(false);
    const [monitoringSummary, setMonitoringSummary] = useState<MonitoringSummary | null>(null);
    const [biometricHistory, setBiometricHistory] = useState<Array<Record<string, unknown>>>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [biometricData, setBiometricData] = useState<BiometricReading>({
        heartRate: undefined,
        bloodPressure: { systolic: 0, diastolic: 0 },
        temperature: undefined,
        oxygenSaturation: undefined,
        source: 'manual',
    });

    useEffect(() => {
        loadMonitoringSummary();
        loadBiometricHistory();
        loadBookings();
    }, []);

    const loadMonitoringSummary = async () => {
        try {
            const summary = await patientApi.getMonitoringSummary();
            setMonitoringSummary(summary);
        } catch (error) {
            console.error('Failed to load monitoring summary:', error);
        }
    };

    const loadBiometricHistory = async () => {
        try {
            const res = await patientApi.getBiometricHistory(20);
            const list = (res?.data?.history ?? res?.history ?? res) as Array<Record<string, unknown>>;
            setBiometricHistory(Array.isArray(list) ? list : []);
        } catch (error) {
            console.error('Failed to load biometric history:', error);
        }
    };

    const loadBookings = async () => {
        try {
            const data = await bookingsApi.getMyBookings();
            setBookings(data.bookings || []);
        } catch (error) {
            console.error('Failed to load bookings:', error);
        }
    };

    const handleBiometricSubmit = async () => {
        try {
            setLoading(true);
            await patientApi.submitBiometrics(biometricData);
            toast.success('Biometrics submitted successfully!');
            setBiometricData({
                heartRate: undefined,
                bloodPressure: { systolic: 0, diastolic: 0 },
                temperature: undefined,
                oxygenSaturation: undefined,
                source: 'manual',
            });
            loadMonitoringSummary();
            loadBiometricHistory();
        } catch (error: unknown) {
            const e = error as { response?: { data?: { error?: string } } };
            console.error("Biometric submission failed", error);
            toast.error(e.response?.data?.error || "Failed to submit biometrics. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <RoleGuard allowedRoles={[UserRole.PATIENT]}>
            <DashboardLayout>
                <div className="p-6 sm:p-8 bg-[var(--background)]">
                    <div className="max-w-6xl mx-auto">
                        {/* Unmissable ML Early Warning strip — first thing on the page */}
                        <Link
                            href="/patient/early-warning"
                            className="flex items-center justify-between gap-3 mb-6 px-4 py-3 rounded-xl border-2 w-full text-left transition hover:opacity-95"
                            style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-soft)' }}
                        >
                            <span className="text-sm font-semibold text-[var(--primary)] uppercase tracking-wide">
                                ML Early Warning Service
                            </span>
                            <span className="text-sm font-medium text-[var(--foreground)]">
                                Cardiovascular &amp; wellness risk scores →
                            </span>
                        </Link>

                        <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
                            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] tracking-tight">
                                Patient Portal
                            </h1>
                            <p className="text-sm sm:text-base font-medium text-[var(--muted)]">
                                Welcome, {user?.firstName} {user?.lastName}
                            </p>
                        </div>

                        {/* Early Warning — prominent card (also in sidebar as "Early Warning") */}
                        <Link
                            href="/patient/early-warning"
                            className="card-interactive block mb-8 p-6 rounded-[var(--radius-lg)] border-2"
                            style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--card)', boxShadow: 'var(--shadow)' }}
                        >
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <h2 className="text-xl font-bold text-[var(--foreground)]">
                                            Early Warning — Cardiovascular &amp; Wellness
                                        </h2>
                                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
                                            ML service
                                        </span>
                                    </div>
                                    <p className="text-sm text-[var(--muted)]">
                                        View your risk scores (Framingham, QRISK3, ML), metrics (HR, HRV, sleep, ECG, temperature trend), and recommendations.
                                    </p>
                                </div>
                                <span className="btn-primary inline-flex items-center gap-2 px-5 py-3 rounded-xl font-semibold shrink-0">
                                    Open Early Warning →
                                </span>
                            </div>
                        </Link>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                            {/* Health Status – KPI-style card */}
                            <Card className="card-interactive">
                                <CardHeader>
                                    <CardTitle>Health Status</CardTitle>
                                </CardHeader>
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <p className="text-sm font-medium text-[var(--muted)]">Readiness Score</p>
                                        <p className="text-3xl font-bold text-[var(--foreground)] mt-1">
                                            {monitoringSummary?.readinessScore ?? 'N/A'}
                                        </p>
                                    </div>
                                    <StatusBadge
                                        variant={
                                            monitoringSummary?.alertLevel === 'GREEN'
                                                ? 'success'
                                                : monitoringSummary?.alertLevel === 'YELLOW'
                                                ? 'warning'
                                                : 'danger'
                                        }
                                    >
                                        {monitoringSummary?.alertLevel ?? 'Unknown'}
                                    </StatusBadge>
                                </div>
                                <p className="text-sm font-medium text-[var(--muted)]">
                                    {monitoringSummary?.baselineEstablished
                                        ? 'Baseline established'
                                        : biometricHistory.length === 0
                                        ? 'Submit your first reading above to get started.'
                                        : `Collecting data (${biometricHistory.length} reading${biometricHistory.length === 1 ? '' : 's'} so far). Need 14+ for full baseline.`}
                                </p>
                            </Card>

                            {/* Biometric Entry */}
                            <Card className="card-interactive">
                                <CardHeader>
                                    <CardTitle>Record Biometrics</CardTitle>
                                </CardHeader>
                            <div className="space-y-3" role="form" aria-label="Record biometrics">
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        id="biometric-heart-rate"
                                        name="heartRate"
                                        type="number"
                                        placeholder="Heart Rate"
                                        className="w-full px-3 py-2.5 border rounded-xl text-[var(--foreground)] placeholder:text-[var(--muted)] focus:ring-2 focus:ring-[var(--primary)] outline-none transition"
                                        style={{ borderColor: 'var(--border)' }}
                                        value={biometricData.heartRate || ''}
                                        onChange={(e) => setBiometricData({
                                            ...biometricData,
                                            heartRate: e.target.value ? Number(e.target.value) : undefined,
                                        })}
                                    />
                                    <input
                                        id="biometric-temperature"
                                        name="temperature"
                                        type="number"
                                        placeholder="Temp (°C)"
                                        className="w-full px-3 py-2.5 border rounded-xl text-[var(--foreground)] placeholder:text-[var(--muted)] focus:ring-2 focus:ring-[var(--primary)] outline-none transition"
                                        style={{ borderColor: 'var(--border)' }}
                                        value={biometricData.temperature || ''}
                                        onChange={(e) => setBiometricData({
                                            ...biometricData,
                                            temperature: e.target.value ? Number(e.target.value) : undefined,
                                        })}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        id="biometric-systolic"
                                        name="bloodPressureSystolic"
                                        type="number"
                                        placeholder="Systolic"
                                        className="w-full px-3 py-2.5 border rounded-xl text-[var(--foreground)] placeholder:text-[var(--muted)] focus:ring-2 focus:ring-[var(--primary)] outline-none transition"
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
                                    <input
                                        id="biometric-diastolic"
                                        name="bloodPressureDiastolic"
                                        type="number"
                                        placeholder="Diastolic"
                                        className="w-full px-3 py-2.5 border rounded-xl text-[var(--foreground)] placeholder:text-[var(--muted)] focus:ring-2 focus:ring-[var(--primary)] outline-none transition"
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
                                <input
                                    id="biometric-spo2"
                                    name="oxygenSaturation"
                                    type="number"
                                    placeholder="SpO2 (%)"
                                    className="w-full px-3 py-2.5 border rounded-xl text-[var(--foreground)] placeholder:text-[var(--muted)] focus:ring-2 focus:ring-[var(--primary)] outline-none transition"
                                    style={{ borderColor: 'var(--border)' }}
                                    value={biometricData.oxygenSaturation || ''}
                                    onChange={(e) => setBiometricData({
                                        ...biometricData,
                                        oxygenSaturation: e.target.value ? Number(e.target.value) : undefined,
                                    })}
                                />
                                <button
                                    type="button"
                                    id="biometric-submit"
                                    onClick={handleBiometricSubmit}
                                    disabled={loading}
                                    className="btn-primary w-full py-2.5 rounded-xl font-semibold disabled:opacity-50"
                                >
                                    Submit
                                </button>
                            </div>
                            </Card>

                            {/* Link to AI Doctor Assistant (separate service) */}
                            <Card className="card-interactive flex flex-col justify-center">
                                <CardHeader>
                                    <CardTitle>AI Doctor Assistant</CardTitle>
                                </CardHeader>
                                <p className="text-sm text-[var(--muted)] mb-4">
                                    Describe symptoms and get AI-assisted triage recommendations. For decision support only — not a medical diagnosis.
                                </p>
                                <Link
                                    href="/patient/ai-doctor"
                                    className="btn-primary inline-flex items-center justify-center py-2.5 rounded-xl font-semibold"
                                >
                                    Open AI Doctor Assistant →
                                </Link>
                            </Card>
                        </div>

                        {/* Recent biometric readings */}
                        <Card className="card-interactive mb-8">
                            <CardHeader>
                                <CardTitle>Recent readings</CardTitle>
                            </CardHeader>
                            {biometricHistory.length === 0 ? (
                                <p className="text-sm font-medium text-[var(--muted)]">No readings yet. Use the form above to submit your first biometrics.</p>
                            ) : (
                                <div className="space-y-3">
                                    {biometricHistory.slice(0, 10).map((r: Record<string, unknown>, i: number) => (
                                        <div
                                            key={(r.id as string) ?? i}
                                            className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 border-b last:border-b-0 text-sm"
                                            style={{ borderColor: 'var(--border)' }}
                                        >
                                            <span className="text-[var(--muted)]">
                                                {r.createdAt ? new Date(r.createdAt as string).toLocaleString() : '—'}
                                            </span>
                                            {(r.heartRate != null || r.heartRateResting != null) && (
                                                <span>HR: {String(r.heartRate ?? r.heartRateResting ?? '—')}</span>
                                            )}
                                            {(r.bloodPressureSystolic != null || r.bloodPressureDiastolic != null) && (
                                                <span>BP: {String(r.bloodPressureSystolic ?? '—')}/{String(r.bloodPressureDiastolic ?? '—')}</span>
                                            )}
                                            {r.oxygenSaturation != null && <span>SpO2: {String(r.oxygenSaturation)}%</span>}
                                            {r.temperature != null && <span>Temp: {String(r.temperature)}°C</span>}
                                            {r.readinessScore != null && (
                                                <span className="font-medium">Score: {String(r.readinessScore)}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>

                        {/* Bookings */}
                        <Card className="card-interactive">
                            <CardHeader>
                                <CardTitle>My Bookings</CardTitle>
                            </CardHeader>
                            {bookings.length === 0 ? (
                                <p className="font-medium text-[var(--muted)]">No bookings yet. Book a visit to get started.</p>
                            ) : (
                                <div className="space-y-4">
                                    {bookings.map((booking) => (
                                        <div key={booking.id} className="p-4 rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                                            <div className="flex justify-between items-start gap-4">
                                                <div>
                                                    <p className="font-semibold text-[var(--foreground)]">
                                                        {new Date(booking.scheduledDate).toLocaleDateString()}
                                                    </p>
                                                    <p className="text-sm text-[var(--muted)] mt-1">{booking.address}</p>
                                                </div>
                                                <StatusBadge
                                                    variant={booking.status === 'CONFIRMED' ? 'success' : 'warning'}
                                                    className="text-xs shrink-0"
                                                >
                                                    {booking.status}
                                                </StatusBadge>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>
                    </div>
                </div>
            </DashboardLayout>
        </RoleGuard>
    );
}
