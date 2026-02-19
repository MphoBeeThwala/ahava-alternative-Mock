"use client";

import React, { useState, useEffect } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import { doctorApi, visitsApi, Visit, TriageCase } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import DashboardLayout from '../../../components/DashboardLayout';
import { Card } from '../../../components/ui/Card';
import { KpiCard } from '../../../components/ui/KpiCard';
import { Modal } from '../../../components/ui/Modal';
import { StatusBadge } from '../../../components/ui/StatusBadge';

export default function DoctorDashboard() {
    const { user } = useAuth();
    const toast = useToast();
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
            toast.success('Visit approved. Notification sent to patient.');
            loadPendingVisits();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to approve visit.');
        }
    };

    const handleStatusUpdate = async (visitId: string, status: string) => {
        try {
            await visitsApi.updateStatus(visitId, status);
            loadPendingVisits();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to update visit status.');
        }
    };

    const handleApproveTriage = async (caseId: string) => {
        try {
            await doctorApi.approveTriageCase(caseId);
            toast.success('Case approved. Patient can use AI assessment as final.');
            loadTriageCases();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to approve.');
        }
    };

    const handleOverrideTriage = async () => {
        if (!overrideModal) return;
        try {
            await doctorApi.overrideTriageCase(overrideModal.caseId, overrideModal.notes, overrideModal.diagnosis);
            toast.success('Your assessment recorded. You can send final diagnosis to patient later.');
            setOverrideModal(null);
            loadTriageCases();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to save.');
        }
    };

    const handleReferTriage = async () => {
        if (!referModal || !referModal.referredTo.trim()) return;
        try {
            await doctorApi.referTriageCase(referModal.caseId, referModal.referredTo, referModal.notes);
            toast.success('Case referred. Arrange in-person or partner appointment.');
            setReferModal(null);
            loadTriageCases();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to refer.');
        }
    };

    const totalPending = triageQueue.length + triageCases.length;

    return (
        <RoleGuard allowedRoles={[UserRole.DOCTOR]}>
            <DashboardLayout>
                <div className="p-6 sm:p-8 bg-[var(--background)] min-h-screen">
                <header className="flex flex-wrap justify-between items-center gap-4 mb-8">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] tracking-tight">Doctor Portal</h1>
                        <p className="text-[var(--muted)] font-medium mt-1">Welcome, Dr. {user?.lastName}</p>
                    </div>
                    <KpiCard
                        label="Active Queue"
                        value={totalPending}
                        badge={`${totalPending} pending`}
                        badgeVariant={totalPending > 0 ? 'warning' : 'success'}
                    />
                </header>

                {/* AI-assisted remote triage (sent from patient dashboard) */}
                {triageCases.length > 0 && (
                    <section className="mb-10">
                        <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">AI Triage Queue (remote)</h2>
                        <div className="grid gap-6">
                            {triageCases.map((tc) => (
                                <Card key={tc.id}>
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="text-xl font-bold text-[var(--foreground)]">
                                                {tc.patient?.firstName} {tc.patient?.lastName}
                                            </h3>
                                            <p className="text-sm text-[var(--muted)]">
                                                {new Date(tc.createdAt).toLocaleString()}
                                            </p>
                                        </div>
                                        <StatusBadge variant={tc.aiTriageLevel <= 2 ? 'danger' : 'warning'}>
                                            Level {tc.aiTriageLevel}
                                        </StatusBadge>
                                    </div>
                                    <p className="text-slate-700 mb-2"><strong>Symptoms:</strong> {tc.symptoms}</p>
                                    <p className="text-slate-600 text-sm mb-2"><strong>AI recommendation:</strong> {tc.aiRecommendedAction}</p>
                                    <p className="text-slate-500 text-sm mb-2"><strong>Possible conditions:</strong> {(tc.aiPossibleConditions || []).join(', ')}</p>
                                    <p className="text-slate-500 text-sm mb-4"><strong>AI reasoning:</strong> {tc.aiReasoning}</p>
                                    <div className="flex flex-wrap gap-3 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                                        <button
                                            onClick={() => handleApproveTriage(tc.id)}
                                            className="px-4 py-2 rounded-lg font-medium text-white transition"
                                            style={{ backgroundColor: 'var(--success)' }}
                                        >
                                            Approve (agree with AI)
                                        </button>
                                        <button
                                            onClick={() => setOverrideModal({ caseId: tc.id, notes: '', diagnosis: '' })}
                                            className="px-4 py-2 rounded-lg font-medium text-white transition bg-amber-600 hover:bg-amber-700"
                                        >
                                            Add my diagnosis
                                        </button>
                                        <button
                                            onClick={() => setReferModal({ caseId: tc.id, referredTo: '', notes: '' })}
                                            className="px-4 py-2 rounded-lg font-medium text-white bg-slate-600 hover:bg-slate-700 transition"
                                        >
                                            Refer (in-person / partner)
                                        </button>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    </section>
                )}

                {/* Nurse visit queue */}
                <section>
                    <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">Visit queue (nurse reports)</h2>
                {loading ? (
                    <div className="text-center py-12">
                        <p className="font-medium text-[var(--muted)]">Loading pending reviews...</p>
                    </div>
                ) : triageQueue.length === 0 && triageCases.length === 0 ? (
                    <Card className="text-center py-12">
                        <p className="text-xl font-medium text-[var(--muted)]">All caught up! No pending reviews.</p>
                    </Card>
                ) : triageQueue.length === 0 ? (
                    <Card className="text-center py-8">
                        <p className="text-[var(--muted)]">No pending nurse visits.</p>
                    </Card>
                ) : (
                    <div className="grid gap-6">
                        {triageQueue.map((visit) => (
                            <Card key={visit.id}>
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 className="text-xl font-bold text-[var(--foreground)]">
                                            {visit.booking?.patient?.firstName} {visit.booking?.patient?.lastName}
                                        </h3>
                                        <p className="text-sm text-[var(--muted)]">
                                            {visit.createdAt ? new Date(visit.createdAt).toLocaleString() : 'Date TBD'}
                                        </p>
                                        <p className="text-sm text-[var(--muted)] mt-1">{visit.booking?.address}</p>
                                    </div>
                                    <StatusBadge variant={visit.triageLevel <= 2 ? 'danger' : 'warning'}>
                                        {visit.triageLevel ? `Level ${visit.triageLevel}` : visit.status}
                                    </StatusBadge>
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

                                <div className="flex gap-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                                    <button
                                        onClick={() => handleApprove(visit.id)}
                                        className="px-6 py-2 rounded-lg font-medium text-white transition"
                                        style={{ backgroundColor: 'var(--success)' }}
                                    >
                                        Approve & Complete
                                    </button>
                                    <button
                                        onClick={() => handleStatusUpdate(visit.id, 'PENDING_REVIEW')}
                                        className="px-6 py-2 rounded-lg border font-semibold transition bg-[var(--card)] hover:bg-slate-50"
                                        style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                                    >
                                        Request More Info
                                    </button>
                                    <button
                                        onClick={() => handleStatusUpdate(visit.id, 'CANCELLED')}
                                        className="px-6 py-2 rounded-lg border font-medium transition ml-auto hover:bg-red-50"
                                        style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                                    >
                                        Escalate to ER
                                    </button>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
                </section>

                {/* Refer modal */}
                <Modal
                    open={!!referModal}
                    onClose={() => setReferModal(null)}
                    title="Refer patient"
                    primaryLabel="Refer"
                    onPrimary={handleReferTriage}
                    primaryDisabled={!referModal?.referredTo?.trim()}
                    secondaryLabel="Cancel"
                    onSecondary={() => setReferModal(null)}
                >
                    <div className="space-y-4">
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Where to refer</label>
                            <input
                                type="text"
                                placeholder="e.g. In-person with Dr X / Partner clinic near patient"
                                className="w-full rounded-lg border px-4 py-2.5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2"
                                style={{ borderColor: 'var(--border)' }}
                                value={referModal?.referredTo ?? ''}
                                onChange={(e) => referModal && setReferModal({ ...referModal, referredTo: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Notes (optional)</label>
                            <textarea
                                placeholder="Notes for referral"
                                className="w-full rounded-lg border px-4 py-2.5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2"
                                style={{ borderColor: 'var(--border)' }}
                                rows={2}
                                value={referModal?.notes ?? ''}
                                onChange={(e) => referModal && setReferModal({ ...referModal, notes: e.target.value })}
                            />
                        </div>
                    </div>
                </Modal>

                {/* Override modal */}
                <Modal
                    open={!!overrideModal}
                    onClose={() => setOverrideModal(null)}
                    title="Add your diagnosis"
                    primaryLabel="Save"
                    onPrimary={handleOverrideTriage}
                    secondaryLabel="Cancel"
                    onSecondary={() => setOverrideModal(null)}
                >
                    <div className="space-y-4">
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Your notes (optional)</label>
                            <textarea
                                placeholder="Clinical notes"
                                className="w-full rounded-lg border px-4 py-2.5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2"
                                style={{ borderColor: 'var(--border)' }}
                                rows={2}
                                value={overrideModal?.notes ?? ''}
                                onChange={(e) => overrideModal && setOverrideModal({ ...overrideModal, notes: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Final diagnosis</label>
                            <input
                                type="text"
                                placeholder="Can send to patient later"
                                className="w-full rounded-lg border px-4 py-2.5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2"
                                style={{ borderColor: 'var(--border)' }}
                                value={overrideModal?.diagnosis ?? ''}
                                onChange={(e) => overrideModal && setOverrideModal({ ...overrideModal, diagnosis: e.target.value })}
                            />
                        </div>
                    </div>
                </Modal>
                </div>
            </DashboardLayout>
        </RoleGuard>
    );
}
