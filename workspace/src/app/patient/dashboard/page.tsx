"use client";

import React, { useState, useEffect } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import { patientApi, bookingsApi, BiometricReading } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import NavBar from '../../../components/NavBar';

export default function PatientDashboard() {
    const { user } = useAuth();
    const [symptoms, setSymptoms] = useState('');
    const [triageResult, setTriageResult] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [monitoringSummary, setMonitoringSummary] = useState<any>(null);
    const [bookings, setBookings] = useState<any[]>([]);
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
        } catch (error: any) {
            console.error("Triage failed", error);
            alert(error.response?.data?.error || "Failed to analyze symptoms. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleBiometricSubmit = async () => {
        try {
            setLoading(true);
            await patientApi.submitBiometrics(biometricData);
            alert('Biometrics submitted successfully!');
            setBiometricData({
                heartRate: undefined,
                bloodPressure: { systolic: 0, diastolic: 0 },
                temperature: undefined,
                oxygenSaturation: undefined,
                source: 'manual',
            });
            loadMonitoringSummary();
        } catch (error: any) {
            console.error("Biometric submission failed", error);
            alert(error.response?.data?.error || "Failed to submit biometrics. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <RoleGuard allowedRoles={[UserRole.PATIENT]}>
            <NavBar />
            <div className="p-6 sm:p-8 bg-slate-50 min-h-screen">
                <div className="max-w-6xl mx-auto">
                    <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
                        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                            Patient Portal
                        </h1>
                        <p className="text-sm sm:text-base font-medium text-slate-700">
                            Welcome, {user?.firstName} {user?.lastName}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                        {/* Health Monitor Card */}
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                            <h2 className="text-lg font-semibold mb-4 text-slate-900 tracking-tight">
                                Health Status
                            </h2>
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <p className="text-sm font-medium text-slate-600">Readiness Score</p>
                                    <p className="text-3xl font-bold text-slate-900 mt-1">
                                        {monitoringSummary?.readinessScore ?? 'N/A'}
                                    </p>
                                </div>
                                <span className={`px-3 py-1.5 rounded-full text-sm font-semibold ${
                                    monitoringSummary?.alertLevel === 'GREEN'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : monitoringSummary?.alertLevel === 'YELLOW'
                                        ? 'bg-amber-100 text-amber-800'
                                        : 'bg-red-100 text-red-800'
                                }`}>
                                    {monitoringSummary?.alertLevel ?? 'Unknown'}
                                </span>
                            </div>
                            <p className="text-sm font-medium text-slate-600">
                                {monitoringSummary?.baselineEstablished
                                    ? 'Baseline established'
                                    : 'Establishing baseline...'}
                            </p>
                        </div>

                        {/* Biometric Entry Card */}
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                            <h2 className="text-lg font-semibold mb-4 text-slate-900 tracking-tight">
                                Record Biometrics
                            </h2>
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
                                    className="w-full py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                                >
                                    Submit
                                </button>
                            </div>
                        </div>

                        {/* AI Triage Card */}
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                            <h2 className="text-lg font-semibold mb-4 text-slate-900 tracking-tight">
                                AI Doctor Assistant
                            </h2>

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
                                        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
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
                                        className="text-blue-600 text-sm font-medium hover:underline w-full text-center"
                                    >
                                        Start Over
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Bookings Section */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <h2 className="text-lg font-semibold mb-4 text-slate-900 tracking-tight">
                            My Bookings
                        </h2>
                        {bookings.length === 0 ? (
                            <p className="text-slate-600 font-medium">No bookings yet. Book a visit to get started.</p>
                        ) : (
                            <div className="space-y-4">
                                {bookings.map((booking) => (
                                    <div key={booking.id} className="p-4 border border-slate-200 rounded-lg">
                                        <div className="flex justify-between items-start gap-4">
                                            <div>
                                                <p className="font-semibold text-slate-900">
                                                    {new Date(booking.scheduledDate).toLocaleDateString()}
                                                </p>
                                                <p className="text-sm text-slate-600 mt-1">{booking.address}</p>
                                            </div>
                                            <span className={`px-3 py-1 rounded-full text-xs font-semibold shrink-0 ${
                                                booking.status === 'CONFIRMED'
                                                    ? 'bg-emerald-100 text-emerald-800'
                                                    : 'bg-amber-100 text-amber-800'
                                            }`}>
                                                {booking.status}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </RoleGuard>
    );
}
