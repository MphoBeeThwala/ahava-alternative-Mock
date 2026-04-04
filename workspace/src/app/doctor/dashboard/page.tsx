"use client";

import React, { useState, useEffect, useCallback } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import { doctorApi, visitsApi, Visit, TriageCase } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import DashboardLayout from '../../../components/DashboardLayout';
import { Card } from '../../../components/ui/Card';
import { Modal } from '../../../components/ui/Modal';
import { StatusBadge } from '../../../components/ui/StatusBadge';

// Helper function to calculate urgency level based on time (IMPROVEMENT #3)
function getUrgencyLevel(createdAt: string): { level: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; color: string; hoursAgo: number; label: string } {
  const created = new Date(createdAt).getTime();
  const now = new Date().getTime();
  const hoursAgo = Math.floor((now - created) / (1000 * 60 * 60));

  let level: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' = 'LOW';
  let color = '#4caf50'; // green
  let label = 'ROUTINE';

  if (hoursAgo >= 24) {
    level = 'URGENT';
    color = '#d32f2f'; // red
    label = '[URGENT]';
  } else if (hoursAgo >= 6) {
    level = 'HIGH';
    color = '#ff6f00'; // orange
    label = '[HIGH]';
  } else if (hoursAgo >= 1) {
    level = 'MEDIUM';
    color = '#fbc02d'; // yellow
    label = '[MEDIUM]';
  } else {
    label = '[NEW]';
  }

  return { level, color, hoursAgo, label };
}

function formatTimeAgo(hours: number): string {
  if (hours === 0) return 'just now';
  if (hours < 1) return '< 1 hour ago';
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

type ReviewModal = {
    caseId: string;
    aiTriageLevel: number;
    doctorNotes: string;
    doctorDiagnosis: string;
    doctorRecommendations: string;
    finalTriageLevel: number;
    overrideReason: string;
};

export default function DoctorDashboard() {
    const { user } = useAuth();
    const toast = useToast();
    const [triageQueue, setTriageQueue] = useState<Visit[]>([]);
    const [triageCases, setTriageCases] = useState<TriageCase[]>([]);
    const [loading, setLoading] = useState(false);
    const [reviewModal, setReviewModal] = useState<ReviewModal | null>(null);
    const [releasing, setReleasing] = useState<string | null>(null);

    const loadPendingVisits = useCallback(async () => {
        try {
            setLoading(true);
            const data = await doctorApi.getPendingVisits();
            setTriageQueue(data.visits || []);
        } catch (error) {
            console.error('Failed to load pending visits:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadTriageCases = useCallback(async () => {
        try {
            const data = await doctorApi.getTriageReviewQueue('PENDING_REVIEW');
            setTriageCases(data.cases || []);
        } catch (error) {
            console.error('Failed to load triage cases:', error);
        }
    }, []);

    useEffect(() => {
        loadPendingVisits();
        loadTriageCases();
    }, [loadPendingVisits, loadTriageCases]);

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

    const handleClaim = async (caseId: string) => {
        try {
            await doctorApi.claimTriageCase(caseId);
            toast.success('Case claimed. Complete your review below.');
            loadTriageCases();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to claim case.');
        }
    };

    const handleSaveReview = async () => {
        if (!reviewModal) return;
        if (!reviewModal.doctorNotes.trim() || !reviewModal.doctorDiagnosis.trim()) {
            toast.error('Doctor notes and diagnosis are required.');
            return;
        }
        if (reviewModal.finalTriageLevel !== reviewModal.aiTriageLevel && !reviewModal.overrideReason.trim()) {
            toast.error('Override reason is required when changing the AI triage level.');
            return;
        }
        try {
            await doctorApi.reviewTriageCase(reviewModal.caseId, {
                doctorNotes: reviewModal.doctorNotes,
                doctorDiagnosis: reviewModal.doctorDiagnosis,
                doctorRecommendations: reviewModal.doctorRecommendations || undefined,
                finalTriageLevel: reviewModal.finalTriageLevel,
                overrideReason: reviewModal.finalTriageLevel !== reviewModal.aiTriageLevel ? reviewModal.overrideReason : undefined,
            });
            toast.success('Review saved. You can now release the result to the patient.');
            setReviewModal(null);
            loadTriageCases();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to save review.');
        }
    };

    const handleRelease = async (caseId: string) => {
        setReleasing(caseId);
        try {
            await doctorApi.releaseTriageCase(caseId);
            toast.success('Result released to patient via real-time notification.');
            loadTriageCases();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to release. Ensure notes and diagnosis are saved first.');
        } finally {
            setReleasing(null);
        }
    };

    const totalPending = triageQueue.length + triageCases.length;

    return (
        <RoleGuard allowedRoles={[UserRole.DOCTOR]}>
            <DashboardLayout>
                <div style={{ background: 'var(--background)', minHeight: '100vh' }}>

                    {/* ── Hero banner ── */}
                    <div style={{ background: 'linear-gradient(135deg,#0a1628 0%,#0d2f5e 55%,#1e3a5f 100%)', padding: '32px 40px 28px', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(37,99,235,0.2),transparent 70%)', pointerEvents: 'none' }} />
                        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                            <div>
                                <p style={{ color: 'rgba(147,197,253,0.8)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Doctor Portal</p>
                                <h1 style={{ color: 'white', fontSize: 'clamp(22px,3vw,30px)', fontWeight: 900, margin: 0 }}>
                                    Welcome, Dr. {user?.lastName} 👨‍⚕️
                                </h1>
                                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 4 }}>Review AI triage cases, approve diagnoses, and manage patient care.</p>
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 16, padding: '16px 24px', textAlign: 'center', minWidth: 140 }}>
                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Active Queue</div>
                                <div style={{ fontSize: 36, fontWeight: 900, color: totalPending > 0 ? '#fbbf24' : '#34d399', lineHeight: 1 }}>{totalPending}</div>
                                <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6, padding: '3px 10px', borderRadius: 20, background: totalPending > 0 ? 'rgba(251,191,36,0.15)' : 'rgba(52,211,153,0.15)', color: totalPending > 0 ? '#fbbf24' : '#34d399', display: 'inline-block' }}>
                                    {totalPending} pending
                                </div>
                            </div>
                        </div>
                    </div>

                <div className="p-6 sm:p-8">

                {/* AI-assisted remote triage (sent from patient dashboard) */}
                {triageCases.length > 0 && (
                    <section className="mb-10">
                        <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">AI Triage Queue (remote)</h2>
                        <div className="grid gap-6">
                            {triageCases.map((tc) => {
                              const { level, color, hoursAgo, label } = getUrgencyLevel(tc.createdAt);
                              
                              return (
                                <Card key={tc.id} style={{ borderLeft: `4px solid ${color}` }}>
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="text-xl font-bold text-[var(--foreground)]">
                                                {label} {tc.patient?.firstName} {tc.patient?.lastName}
                                            </h3>
                                            <p className="text-sm text-[var(--muted)]">
                                                {formatTimeAgo(hoursAgo)} • General
                                            </p>
                                        </div>
                                        <div style={{ 
                                          backgroundColor: color, 
                                          color: 'white',
                                          padding: '8px 12px',
                                          borderRadius: '6px',
                                          fontWeight: 'bold'
                                        }}>
                                          {level}
                                        </div>
                                    </div>
                                    <p className="text-slate-700 mb-2"><strong>Symptoms:</strong> {tc.symptoms}</p>
                                    <p className="text-slate-600 text-sm mb-2"><strong>AI recommendation:</strong> {tc.aiRecommendedAction}</p>
                                    <p className="text-slate-500 text-sm mb-2"><strong>Possible conditions:</strong> {(tc.aiPossibleConditions || []).join(', ')}</p>
                                    <p className="text-slate-500 text-sm mb-2"><strong>AI reasoning:</strong> {tc.aiReasoning}</p>
                                    {tc.aiModel && (
                                        <p className="text-xs text-slate-400 mb-4">AI model: {tc.aiModel}</p>
                                    )}
                                    <div className="flex flex-wrap gap-3 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                                        {tc.status === 'PENDING_REVIEW' && (
                                            <button
                                                onClick={() => handleClaim(tc.id)}
                                                className="px-4 py-2 rounded-lg font-medium text-white transition"
                                                style={{ backgroundColor: '#2196f3' }}
                                            >
                                                Claim case
                                            </button>
                                        )}
                                        {(tc.status === 'ASSIGNED' || tc.status === 'REVIEWED') && (
                                            <button
                                                onClick={() => setReviewModal({ caseId: tc.id, aiTriageLevel: tc.aiTriageLevel, doctorNotes: '', doctorDiagnosis: '', doctorRecommendations: '', finalTriageLevel: tc.aiTriageLevel, overrideReason: '' })}
                                                className="px-4 py-2 rounded-lg font-medium text-white transition"
                                                style={{ backgroundColor: '#ff9800' }}
                                            >
                                                ✎ Write review
                                            </button>
                                        )}
                                        {tc.status === 'REVIEWED' && (
                                            <button
                                                onClick={() => handleRelease(tc.id)}
                                                disabled={releasing === tc.id}
                                                className="px-4 py-2 rounded-lg font-medium text-white transition disabled:opacity-60"
                                                style={{ backgroundColor: '#4caf50' }}
                                            >
                                                {releasing === tc.id ? 'Releasing…' : '↑ Release to patient'}
                                            </button>
                                        )}
                                    </div>
                                </Card>
                              );
                            })}
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
                                        <p className="text-sm text-[var(--muted)] mt-1">{visit.booking?.encryptedAddress ?? 'Address on file'}</p>
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

                {/* Doctor review modal — claim → review → release */}
                <Modal
                    open={!!reviewModal}
                    onClose={() => setReviewModal(null)}
                    title="Doctor review"
                    primaryLabel="Save review"
                    onPrimary={handleSaveReview}
                    primaryDisabled={!reviewModal?.doctorNotes?.trim() || !reviewModal?.doctorDiagnosis?.trim()}
                    secondaryLabel="Cancel"
                    onSecondary={() => setReviewModal(null)}
                >
                    <div className="space-y-4">
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Clinical notes <span className="text-red-500">*</span></label>
                            <textarea
                                placeholder="Clinical observations and reasoning"
                                className="w-full rounded-lg border px-4 py-2.5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2"
                                style={{ borderColor: 'var(--border)' }}
                                rows={3}
                                value={reviewModal?.doctorNotes ?? ''}
                                onChange={(e) => reviewModal && setReviewModal({ ...reviewModal, doctorNotes: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Diagnosis <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                placeholder="Your clinical diagnosis"
                                className="w-full rounded-lg border px-4 py-2.5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2"
                                style={{ borderColor: 'var(--border)' }}
                                value={reviewModal?.doctorDiagnosis ?? ''}
                                onChange={(e) => reviewModal && setReviewModal({ ...reviewModal, doctorDiagnosis: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Recommendations to patient</label>
                            <textarea
                                placeholder="What should the patient do next?"
                                className="w-full rounded-lg border px-4 py-2.5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2"
                                style={{ borderColor: 'var(--border)' }}
                                rows={2}
                                value={reviewModal?.doctorRecommendations ?? ''}
                                onChange={(e) => reviewModal && setReviewModal({ ...reviewModal, doctorRecommendations: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Final SATS level (AI suggested: {reviewModal?.aiTriageLevel})</label>
                            <select
                                className="w-full rounded-lg border px-4 py-2.5 text-[var(--foreground)] focus:outline-none focus:ring-2"
                                style={{ borderColor: 'var(--border)' }}
                                value={reviewModal?.finalTriageLevel ?? reviewModal?.aiTriageLevel ?? ''}
                                onChange={(e) => reviewModal && setReviewModal({ ...reviewModal, finalTriageLevel: parseInt(e.target.value) })}
                            >
                                <option value={1}>1 — Resuscitation (Red)</option>
                                <option value={2}>2 — Emergency (Orange)</option>
                                <option value={3}>3 — Urgent (Yellow)</option>
                                <option value={4}>4 — Less-Urgent (Green)</option>
                                <option value={5}>5 — Non-Urgent (Blue)</option>
                            </select>
                        </div>
                        {reviewModal && reviewModal.finalTriageLevel !== reviewModal.aiTriageLevel && (
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Override reason <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    placeholder="Why are you changing the AI triage level?"
                                    className="w-full rounded-lg border px-4 py-2.5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2"
                                    style={{ borderColor: 'var(--border)' }}
                                    value={reviewModal?.overrideReason ?? ''}
                                    onChange={(e) => reviewModal && setReviewModal({ ...reviewModal, overrideReason: e.target.value })}
                                />
                            </div>
                        )}
                        <p className="text-xs text-[var(--muted)] pt-2">After saving, click <strong>Release to patient</strong> on the case card to deliver the result in real time.</p>
                    </div>
                </Modal>
                </div>{/* p-6 */}
                </div>{/* outer bg */}
            </DashboardLayout>
        </RoleGuard>
    );
}
