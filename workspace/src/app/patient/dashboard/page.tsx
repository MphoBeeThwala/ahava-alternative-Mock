"use client";

import React, { useState, useEffect } from 'react';
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
    const [symptoms, setSymptoms] = useState('');
    const [triageResult, setTriageResult] = useState<{
        triageLevel: number;
        recommendedAction: string;
        possibleConditions?: string[];
        reasoning: string;
    } | null>(null);
    const [loading, setLoading] = useState(false);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [monitoringSummary, setMonitoringSummary] = useState<MonitoringSummary | null>(null);
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

    const loadBookings = async () => {
        try {
            const data = await bookingsApi.getMyBookings();
            setBookings(data.bookings || []);
        } catch (error) {
            console.error('Failed to load bookings:', error);
        }
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = (reader.result as string).split(',')[1];
                setSelectedImage(base64);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleTriage = async () => {
        try {
            setLoading(true);
            const result = await patientApi.submitTriage({
                symptoms,
                imageBase64: selectedImage || undefined,
            });
            setTriageResult(result.data);
        } catch (error: unknown) {
            const e = error as { response?: { data?: { error?: string } } };
            console.error("Triage failed", error);
            toast.error(e.response?.data?.error || "Failed to analyze symptoms. Please try again.");
        } finally {
            setLoading(false);
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
                        <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
                            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] tracking-tight">
                                Patient Portal
                            </h1>
                            <p className="text-sm sm:text-base font-medium text-[var(--muted)]">
                                Welcome, {user?.firstName} {user?.lastName}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                            {/* Health Status – KPI-style card */}
                            <Card>
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
                                        : 'Establishing baseline...'}
                                </p>
                            </Card>

                            {/* Biometric Entry */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Record Biometrics</CardTitle>
                                </CardHeader>
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        type="number"
                                        placeholder="Heart Rate"
                                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                        value={biometricData.heartRate || ''}
                                        onChange={(e) => setBiometricData({
                                            ...biometricData,
                                            heartRate: e.target.value ? Number(e.target.value) : undefined,
                                        })}
                                    />
                                    <input
                                        type="number"
                                        placeholder="Temp (°C)"
                                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                        value={biometricData.temperature || ''}
                                        onChange={(e) => setBiometricData({
                                            ...biometricData,
                                            temperature: e.target.value ? Number(e.target.value) : undefined,
                                        })}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        type="number"
                                        placeholder="Systolic"
                                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
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
                                        type="number"
                                        placeholder="Diastolic"
                                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
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
                                    type="number"
                                    placeholder="SpO2 (%)"
                                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                    value={biometricData.oxygenSaturation || ''}
                                    onChange={(e) => setBiometricData({
                                        ...biometricData,
                                        oxygenSaturation: e.target.value ? Number(e.target.value) : undefined,
                                    })}
                                />
                                <button
                                    onClick={handleBiometricSubmit}
                                    disabled={loading}
                                    className="w-full py-2.5 rounded-lg font-semibold text-white transition disabled:opacity-50"
                                    style={{ backgroundColor: 'var(--primary)' }}
                                >
                                    Submit
                                </button>
                            </div>
                            </Card>

                            {/* AI Triage */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>AI Doctor Assistant</CardTitle>
                                </CardHeader>

                            {!triageResult ? (
                                <div className="space-y-4">
                                    <textarea
                                        className="w-full p-4 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                                        rows={4}
                                        placeholder="Describe your symptoms..."
                                        value={symptoms}
                                        onChange={(e) => setSymptoms(e.target.value)}
                                    />

                                    <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-500 transition cursor-pointer relative">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={handleImageUpload}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        />
                                        <div className="space-y-2">
                                            <span className="text-3xl" aria-hidden>📸</span>
                                            <p className="text-sm font-medium text-slate-600">
                                                {selectedImage ? 'Image Attached' : 'Upload a photo (Optional)'}
                                            </p>
                                        </div>
                                    </div>

                                    <button
                                        onClick={handleTriage}
                                        disabled={loading || !symptoms}
                                        className="w-full py-3 rounded-lg font-semibold text-white transition disabled:opacity-50"
                                        style={{ backgroundColor: 'var(--primary)' }}
                                    >
                                        {loading ? 'Analyzing...' : 'Analyze Symptoms'}
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className={`p-4 rounded-lg border-l-4 ${
                                        triageResult.triageLevel < 3
                                            ? 'bg-red-50 border-red-500'
                                            : 'bg-emerald-50 border-emerald-500'
                                    }`}>
                                    <h3 className="font-bold text-slate-900 mb-2">Analysis Complete</h3>
                                    <p className="mb-2 text-slate-800"><strong>Recommended Action:</strong> {triageResult.recommendedAction}</p>
                                    <p className="text-sm text-slate-700">
                                        <strong>Possible Conditions:</strong> {triageResult.possibleConditions?.join(', ')}
                                    </p>
                                    </div>
                                    <p className="text-xs text-center text-slate-600">{triageResult.reasoning}</p>
                                    <button
                                        onClick={() => {
                                            setTriageResult(null);
                                            setSymptoms('');
                                            setSelectedImage(null);
                                        }}
                                        className="text-sm font-medium w-full text-center hover:underline"
                                        style={{ color: 'var(--primary)' }}
                                    >
                                        Start Over
                                    </button>
                                </div>
                            )}
                            </Card>
                        </div>

                        {/* Bookings */}
                        <Card>
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
