"use client";

import React, { useState, useEffect } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import { doctorApi, visitsApi, Visit, TriageCase } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import NavBar from '../../../components/NavBar';

export default function DoctorDashboard() {
    const { user } = useAuth();
    const [triageQueue, setTriageQueue] = useState<Visit[]>([]);
    const [triageCases, setTriageCases] = useState<TriageCase[]>([]);
    const [loading, setLoading] = useState(false);
    const [referModal, setReferModal] = useState<{ caseId: string; referredTo: string; notes: string } | null>(null);
    const [overrideModal, setOverrideModal] = useState<{ caseId: string; notes: string; diagnosis: string } | null>(null);

    useEffect(() => {
        loadPendingVisits();
        loadTriageCases();
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

    const loadTriageCases = async () => {
        try {
            const data = await doctorApi.getTriageCases('PENDING_REVIEW');
            setTriageCases(data.cases || []);
        } catch (error) {
            console.error('Failed to load triage cases:', error);
        }
    };

    const handleApprove = async (visitId: string) => {
        try {
            await doctorApi.approveVisit(visitId);
            alert('Visit approved. Notification sent to patient.');
            loadPendingVisits();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            alert(err.response?.data?.error || 'Failed to approve visit.');
        }
    };

    const handleStatusUpdate = async (visitId: string, status: string) => {
        try {
            await visitsApi.updateStatus(visitId, status);
            loadPendingVisits();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            alert(err.response?.data?.error || 'Failed to update visit status.');
        }
    };

    const handleApproveTriage = async (caseId: string) => {
        try {
            await doctorApi.approveTriageCase(caseId);
            alert('Case approved. Patient can use AI assessment as final.');
            loadTriageCases();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            alert(err.response?.data?.error || 'Failed to approve.');
        }
    };

    const handleOverrideTriage = async () => {
        if (!overrideModal) return;
        try {
            await doctorApi.overrideTriageCase(overrideModal.caseId, overrideModal.notes, overrideModal.diagnosis);
            alert('Your assessment recorded. You can send final diagnosis to patient later.');
            setOverrideModal(null);
            loadTriageCases();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            alert(err.response?.data?.error || 'Failed to save.');
        }
    };

    const handleReferTriage = async () => {
        if (!referModal || !referModal.referredTo.trim()) return;
        try {
            await doctorApi.referTriageCase(referModal.caseId, referModal.referredTo, referModal.notes);
            alert('Case referred. Arrange in-person or partner appointment.');
            setReferModal(null);
            loadTriageCases();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            alert(err.response?.data?.error || 'Failed to refer.');
        }
    };

    const totalPending = triageQueue.length + triageCases.length;

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
                        Active Queue: {totalPending}
                    </span>
                </header>

                {/* AI-assisted remote triage (sent from patient dashboard) */}
                {triageCases.length > 0 && (
                    <section className="mb-10">
                        <h2 className="text-xl font-bold text-slate-800 mb-4">AI Triage Queue (remote)</h2>
                        <div className="grid gap-6">
                            {triageCases.map((tc) => (
                                <div key={tc.id} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="text-xl font-bold text-slate-900">
                                                {tc.patient?.firstName} {tc.patient?.lastName}
                                            </h3>
                                            <p className="text-sm text-slate-600">
                                                {new Date(tc.createdAt).toLocaleString()}
                                            </p>
                                        </div>
                                        <span className={`px-4 py-2 rounded-lg font-bold ${
                                            tc.aiTriageLevel <= 2 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                                        }`}>
                                            Level {tc.aiTriageLevel}
                                        </span>
                                    </div>
                                    <p className="text-slate-700 mb-2"><strong>Symptoms:</strong> {tc.symptoms}</p>
                                    <p className="text-slate-600 text-sm mb-2"><strong>AI recommendation:</strong> {tc.aiRecommendedAction}</p>
                                    <p className="text-slate-500 text-sm mb-2"><strong>Possible conditions:</strong> {(tc.aiPossibleConditions || []).join(', ')}</p>
                                    <p className="text-slate-500 text-sm mb-4"><strong>AI reasoning:</strong> {tc.aiReasoning}</p>
                                    <div className="flex flex-wrap gap-3 border-t pt-4">
                                        <button
                                            onClick={() => handleApproveTriage(tc.id)}
                                            className="px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700"
                                        >
                                            Approve (agree with AI)
                                        </button>
                                        <button
                                            onClick={() => setOverrideModal({ caseId: tc.id, notes: '', diagnosis: '' })}
                                            className="px-4 py-2 bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700"
                                        >
                                            Add my diagnosis
                                        </button>
                                        <button
                                            onClick={() => setReferModal({ caseId: tc.id, referredTo: '', notes: '' })}
                                            className="px-4 py-2 bg-slate-600 text-white font-medium rounded-lg hover:bg-slate-700"
                                        >
                                            Refer (in-person / partner)
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Nurse visit queue */}
                <section>
                    <h2 className="text-xl font-bold text-slate-800 mb-4">Visit queue (nurse reports)</h2>
                {loading ? (
                    <div className="text-center py-12">
                        <p className="text-slate-600 font-medium">Loading pending reviews...</p>
                    </div>
                ) : triageQueue.length === 0 && triageCases.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-xl border border-slate-200 text-slate-600">
                        <p className="text-xl font-medium">All caught up! No pending reviews.</p>
                    </div>
                ) : triageQueue.length === 0 ? (
                    <div className="text-center py-8 bg-white rounded-xl border border-slate-200 text-slate-500">
                        <p>No pending nurse visits.</p>
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
                                                                {visit.treatment.medications.map((med, idx) => (
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
                </section>

                {/* Refer modal */}
                {referModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
                            <h3 className="text-lg font-bold text-slate-900 mb-4">Refer patient</h3>
                            <input
                                type="text"
                                placeholder="e.g. In-person with Dr X / Partner clinic near patient"
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg mb-3"
                                value={referModal.referredTo}
                                onChange={(e) => setReferModal({ ...referModal, referredTo: e.target.value })}
                            />
                            <textarea
                                placeholder="Notes (optional)"
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg mb-4"
                                rows={2}
                                value={referModal.notes}
                                onChange={(e) => setReferModal({ ...referModal, notes: e.target.value })}
                            />
                            <div className="flex gap-3">
                                <button onClick={handleReferTriage} className="flex-1 py-2 bg-slate-700 text-white rounded-lg font-medium">Refer</button>
                                <button onClick={() => setReferModal(null)} className="flex-1 py-2 border border-slate-300 rounded-lg">Cancel</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Override modal */}
                {overrideModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
                            <h3 className="text-lg font-bold text-slate-900 mb-4">Add your diagnosis</h3>
                            <textarea
                                placeholder="Your notes (optional)"
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg mb-3"
                                rows={2}
                                value={overrideModal.notes}
                                onChange={(e) => setOverrideModal({ ...overrideModal, notes: e.target.value })}
                            />
                            <input
                                type="text"
                                placeholder="Final diagnosis (can send to patient later)"
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg mb-4"
                                value={overrideModal.diagnosis}
                                onChange={(e) => setOverrideModal({ ...overrideModal, diagnosis: e.target.value })}
                            />
                            <div className="flex gap-3">
                                <button onClick={handleOverrideTriage} className="flex-1 py-2 bg-amber-600 text-white rounded-lg font-medium">Save</button>
                                <button onClick={() => setOverrideModal(null)} className="flex-1 py-2 border border-slate-300 rounded-lg">Cancel</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </RoleGuard>
    );
}
