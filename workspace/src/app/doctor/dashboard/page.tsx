"use client";

import React, { useState, useEffect } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import { doctorApi, visitsApi } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import NavBar from '../../../components/NavBar';

export default function DoctorDashboard() {
    const { user } = useAuth();
    const [triageQueue, setTriageQueue] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadPendingVisits();
    }, []);

    const loadPendingVisits = async () => {
        try {
            setLoading(true);
            const data = await doctorApi.getPendingVisits();
            setTriageQueue(data.visits || []);
        } catch (error) {
            console.error('Failed to load pending visits:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleApprove = async (visitId: string) => {
        try {
            await doctorApi.approveVisit(visitId);
            alert('Visit approved. Notification sent to patient.');
            loadPendingVisits();
        } catch (error: any) {
            alert(error.response?.data?.error || 'Failed to approve visit.');
        }
    };

    const handleStatusUpdate = async (visitId: string, status: string) => {
        try {
            await visitsApi.updateStatus(visitId, status);
            loadPendingVisits();
        } catch (error: any) {
            alert(error.response?.data?.error || 'Failed to update visit status.');
        }
    };

    return (
        <RoleGuard allowedRoles={[UserRole.DOCTOR]}>
            <NavBar />
            <div className="p-6 sm:p-8 bg-slate-50 min-h-screen">
                <header className="flex flex-wrap justify-between items-center gap-4 mb-8">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Doctor Portal</h1>
                        <p className="text-slate-700 font-medium mt-1">Welcome, Dr. {user?.lastName}</p>
                    </div>
                    <span className="bg-blue-100 text-blue-800 px-4 py-2 rounded-full font-semibold">
                        Active Queue: {triageQueue.length}
                    </span>
                </header>

                {loading ? (
                    <div className="text-center py-12">
                        <p className="text-slate-600 font-medium">Loading pending reviews...</p>
                    </div>
                ) : triageQueue.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-xl border border-slate-200 text-slate-600">
                        <p className="text-xl font-medium">All caught up! No pending reviews.</p>
                    </div>
                ) : (
                    <div className="grid gap-6">
                        {triageQueue.map((visit) => (
                            <div key={visit.id} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 className="text-xl font-bold text-slate-900">
                                            {visit.booking?.patient?.firstName} {visit.booking?.patient?.lastName}
                                        </h3>
                                        <p className="text-sm text-slate-600">
                                            {visit.createdAt ? new Date(visit.createdAt).toLocaleString() : 'Date TBD'}
                                        </p>
                                        <p className="text-sm text-slate-600 mt-1">{visit.booking?.address}</p>
                                    </div>
                                    <div className={`px-4 py-2 rounded-lg font-bold ${
                                        visit.triageLevel <= 2 
                                            ? 'bg-red-100 text-red-700' 
                                            : 'bg-yellow-100 text-yellow-700'
                                    }`}>
                                        {visit.triageLevel ? `Triage Level ${visit.triageLevel}` : visit.status}
                                    </div>
                                </div>

                                {visit.biometrics && (
                                    <div className="grid md:grid-cols-2 gap-6 mb-6">
                                        <div className="bg-slate-50 p-4 rounded-lg">
                                            <h4 className="font-semibold text-slate-800 mb-2">Biometric Readings</h4>
                                            <div className="text-sm text-slate-700 space-y-1">
                                                {visit.biometrics.heartRate && (
                                                    <p>Heart Rate: {visit.biometrics.heartRate} bpm</p>
                                                )}
                                                {visit.biometrics.bloodPressure && (
                                                    <p>BP: {visit.biometrics.bloodPressure.systolic}/{visit.biometrics.bloodPressure.diastolic}</p>
                                                )}
                                                {visit.biometrics.temperature && (
                                                    <p>Temperature: {visit.biometrics.temperature}°C</p>
                                                )}
                                                {visit.biometrics.oxygenSaturation && (
                                                    <p>SpO2: {visit.biometrics.oxygenSaturation}%</p>
                                                )}
                                            </div>
                                        </div>
                                        {visit.treatment && (
                                            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                                                <h4 className="font-semibold text-blue-800 mb-2">Treatment Plan</h4>
                                                <div className="text-sm text-blue-700">
                                                    {visit.treatment.medications && visit.treatment.medications.length > 0 && (
                                                        <div className="mb-2">
                                                            <strong>Medications:</strong>
                                                            <ul className="list-disc list-inside">
                                                                {visit.treatment.medications.map((med: any, idx: number) => (
                                                                    <li key={idx}>{med.name} - {med.dosage}</li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )}
                                                    {visit.treatment.notes && (
                                                        <p><strong>Notes:</strong> {visit.treatment.notes}</p>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {visit.nurseReport && (
                                    <div className="bg-green-50 p-4 rounded-lg mb-6 border border-green-100">
                                        <h4 className="font-semibold text-green-800 mb-2">Nurse Report</h4>
                                        <p className="text-sm text-green-700">{visit.nurseReport}</p>
                                    </div>
                                )}

                                <div className="flex gap-4 border-t pt-4">
                                    <button
                                        onClick={() => handleApprove(visit.id)}
                                        className="px-6 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 transition"
                                    >
                                        Approve & Complete
                                    </button>
                                    <button
                                        onClick={() => handleStatusUpdate(visit.id, 'PENDING_REVIEW')}
                                        className="px-6 py-2 bg-white border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition"
                                    >
                                        Request More Info
                                    </button>
                                    <button
                                        onClick={() => handleStatusUpdate(visit.id, 'CANCELLED')}
                                        className="px-6 py-2 bg-white border border-red-200 text-red-600 font-medium rounded-lg hover:bg-red-50 transition ml-auto"
                                    >
                                        Escalate to ER
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </RoleGuard>
    );
}
