"use client";

import { useState, useEffect, useCallback } from 'react';
import RoleGuard, { UserRole } from '../../../components/RoleGuard';
import { doctorApi, doctorProfileApi, visitsApi, Visit, TriageCase } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import DashboardLayout from '../../../components/DashboardLayout';
import { Card } from '../../../components/ui/Card';
import { ReviewModal } from './_components/ReviewModal';
import { PrescriptionModal } from './_components/PrescriptionModal';
import { ReferralModal } from './_components/ReferralModal';
import { FollowUpRequestModal } from './_components/FollowUpRequestModal';
import { TriageCaseCard } from './_components/TriageCaseCard';
import { NurseVisitCard } from './_components/NurseVisitCard';
import {
  blankMed,
  type ReviewModalState,
  type PrescriptionModalState,
  type ReferralModalState,
  type FollowUpModalState,
} from './_lib';

export default function DoctorDashboard() {
    const { user } = useAuth();
    const toast = useToast();
    const [triageQueue, setTriageQueue] = useState<Visit[]>([]);
    const [triageCases, setTriageCases] = useState<TriageCase[]>([]);
    const [loading, setLoading] = useState(false);
    const [reviewModal, setReviewModal] = useState<ReviewModalState | null>(null);
    const [releasing, setReleasing] = useState<string | null>(null);
    const [prescriptionModal, setPrescriptionModal] = useState<PrescriptionModalState | null>(null);
    const [referralModal, setReferralModal] = useState<ReferralModalState | null>(null);
    const [followUpModal, setFollowUpModal] = useState<FollowUpModalState | null>(null);
    const [submittingDoc, setSubmittingDoc] = useState(false);
    const [hcpsaStatus, setHcpsaStatus] = useState<{ hcpsaNumber: string | null; hcpsaVerified: boolean } | null>(null);
    const [hcpsaInput, setHcpsaInput] = useState('');
    const [savingHcpsa, setSavingHcpsa] = useState(false);

    const loadHcpsaStatus = useCallback(async () => {
        try {
            const data = await doctorProfileApi.getHpcsa();
            setHcpsaStatus(data.hcpsa);
        } catch { /* silent */ }
    }, []);

    const handleSaveHcpsa = async () => {
        if (!hcpsaInput.trim()) return;
        setSavingHcpsa(true);
        try {
            await doctorProfileApi.submitHpcsa(hcpsaInput.trim());
            toast.success('Practice number submitted. An administrator will verify it shortly.');
            setHcpsaInput('');
            loadHcpsaStatus();
        } catch {
            toast.error('Failed to save practice number.');
        } finally {
            setSavingHcpsa(false);
        }
    };

    const loadPendingVisits = useCallback(async () => {
        try {
            setLoading(true);
            const data = await doctorApi.getPendingVisits();
            setTriageQueue(data?.visits || []);
        } catch (error) {
            console.error('Failed to load pending visits:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadTriageCases = useCallback(async () => {
        try {
            const data = await doctorApi.getTriageReviewQueue('all');
            setTriageCases(data?.cases || []);
        } catch (error) {
            console.error('Failed to load triage cases:', error);
        }
    }, []);

    useEffect(() => {
        if (user?.role !== 'DOCTOR') return;
        loadPendingVisits();
        loadTriageCases();
        loadHcpsaStatus();
    }, [user, loadPendingVisits, loadTriageCases, loadHcpsaStatus]);

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

    const handleIssuePrescription = async () => {
        if (!prescriptionModal) return;
        const meds = prescriptionModal.medications.filter(m => m.name.trim());
        if (!prescriptionModal.diagnosis.trim() || meds.length === 0) {
            toast.error('Diagnosis and at least one medication are required.');
            return;
        }
        setSubmittingDoc(true);
        try {
            await doctorApi.issuePrescription(prescriptionModal.caseId, {
                diagnosis: prescriptionModal.diagnosis,
                medications: meds,
                doctorNotes: prescriptionModal.doctorNotes || undefined,
            });
            toast.success('Prescription issued. Patient notified and PDF ready for download.');
            setPrescriptionModal(null);
            loadTriageCases();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string; safetySummary?: { blockers?: string[] } } } };
            const blockers = err.response?.data?.safetySummary?.blockers || [];
            toast.error(blockers.length > 0 ? blockers.join(' ') : err.response?.data?.error || 'Failed to issue prescription.');
        } finally {
            setSubmittingDoc(false);
        }
    };

    const handleIssueReferral = async () => {
        if (!referralModal) return;
        if (!referralModal.provisionalDiagnosis.trim() || !referralModal.clinicalNotes.trim() || !referralModal.recommendedFacility) {
            toast.error('Diagnosis, clinical notes and recommended facility are required.');
            return;
        }
        setSubmittingDoc(true);
        try {
            await doctorApi.issueEmergencyReferral(referralModal.caseId, {
                referralType: referralModal.referralType,
                provisionalDiagnosis: referralModal.provisionalDiagnosis,
                clinicalNotes: referralModal.clinicalNotes,
                recommendedFacility: referralModal.recommendedFacility,
            });
            toast.success('Referral issued. Patient has been notified with emergency instructions.');
            setReferralModal(null);
            loadTriageCases();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to issue referral.');
        } finally {
            setSubmittingDoc(false);
        }
    };

    const handleRequestFollowUp = async () => {
        if (!followUpModal) return;
        const questions = followUpModal.questionsText
            .split('\n')
            .map((item) => item.trim())
            .filter(Boolean);
        const requestedInvestigations = followUpModal.investigationsText
            .split('\n')
            .map((item) => item.trim())
            .filter(Boolean);

        if (!followUpModal.message.trim() && questions.length === 0 && requestedInvestigations.length === 0) {
            toast.error('Add a message, question, or requested investigation for the patient.');
            return;
        }

        setSubmittingDoc(true);
        try {
            await doctorApi.requestTriageFollowUp(followUpModal.caseId, {
                requestType: followUpModal.requestType,
                message: followUpModal.message || undefined,
                questions,
                requestedInvestigations,
            });
            toast.success('Patient follow-up request sent.');
            setFollowUpModal(null);
            loadTriageCases();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } };
            toast.error(err.response?.data?.error || 'Failed to send follow-up request.');
        } finally {
            setSubmittingDoc(false);
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

                {/* ── HPCSA onboarding banner ── */}
                {hcpsaStatus !== null && (
                    <div className={`mb-6 rounded-xl border px-5 py-4 flex flex-wrap items-center gap-4 ${hcpsaStatus.hcpsaVerified ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-300'}`}>
                        <span className="text-2xl">{hcpsaStatus.hcpsaVerified ? '✅' : '⚠️'}</span>
                        <div className="flex-1 min-w-0">
                            {hcpsaStatus.hcpsaVerified ? (
                                <p className="text-sm font-semibold text-green-800">
                                    HPCSA Practice No. <span className="font-mono">{hcpsaStatus.hcpsaNumber}</span> — Verified
                                </p>
                            ) : hcpsaStatus.hcpsaNumber ? (
                                <p className="text-sm font-semibold text-amber-800">
                                    Practice No. <span className="font-mono">{hcpsaStatus.hcpsaNumber}</span> submitted — pending admin verification. Scripts will show this number once verified.
                                </p>
                            ) : (
                                <p className="text-sm font-semibold text-amber-800">
                                    HPCSA practice number not set. Prescriptions and referrals will not include a verified practice number until you add one.
                                </p>
                            )}
                        </div>
                        {!hcpsaStatus.hcpsaVerified && (
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    placeholder="e.g. MP0123456"
                                    className="rounded-lg border px-3 py-2 text-sm font-mono w-36"
                                    style={{ borderColor: 'var(--border)' }}
                                    value={hcpsaInput}
                                    onChange={e => setHcpsaInput(e.target.value.toUpperCase())}
                                    onKeyDown={e => e.key === 'Enter' && handleSaveHcpsa()}
                                />
                                <button
                                    onClick={handleSaveHcpsa}
                                    disabled={savingHcpsa || !hcpsaInput.trim()}
                                    className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                                    style={{ background: '#d97706' }}
                                >
                                    {savingHcpsa ? 'Saving…' : 'Submit'}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* AI-assisted remote triage (sent from patient dashboard) */}
                {triageCases.length > 0 && (
                    <section className="mb-10">
                        <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">AI Triage Queue (remote)</h2>
                        <div className="grid gap-6">
                            {triageCases.map((tc) => (
                                <TriageCaseCard
                                    key={tc.id}
                                    tc={tc}
                                    releasing={releasing}
                                    onClaim={handleClaim}
                                    onOpenReview={(c) => setReviewModal({ caseId: c.id, aiTriageLevel: c.aiTriageLevel, doctorNotes: '', doctorDiagnosis: '', doctorRecommendations: '', finalTriageLevel: c.aiTriageLevel, overrideReason: '' })}
                                    onOpenFollowUp={(c) => setFollowUpModal({
                                        caseId: c.id,
                                        requestType: 'MORE_INFO',
                                        message: c.followUpRequestMessage || '',
                                        questionsText: (c.followUpQuestions || []).join('\n'),
                                        investigationsText: (c.requestedInvestigations || []).join('\n'),
                                    })}
                                    onRelease={handleRelease}
                                    onOpenPrescription={(c) => setPrescriptionModal({ caseId: c.id, diagnosis: c.doctorDiagnosis || '', medications: [blankMed()], doctorNotes: '' })}
                                    onOpenReferral={(c) => setReferralModal({ caseId: c.id, referralType: 'EMERGENCY', provisionalDiagnosis: c.doctorDiagnosis || '', clinicalNotes: '', recommendedFacility: 'HOSPITAL' })}
                                />
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
                            <NurseVisitCard
                                key={visit.id}
                                visit={visit}
                                onApprove={handleApprove}
                                onStatusUpdate={handleStatusUpdate}
                            />
                        ))}
                    </div>
                )}
                </section>

                <PrescriptionModal
                    state={prescriptionModal}
                    onChange={setPrescriptionModal}
                    onClose={() => setPrescriptionModal(null)}
                    onSubmit={handleIssuePrescription}
                    submitting={submittingDoc}
                />

                <FollowUpRequestModal
                    state={followUpModal}
                    onChange={setFollowUpModal}
                    onClose={() => setFollowUpModal(null)}
                    onSubmit={handleRequestFollowUp}
                    submitting={submittingDoc}
                />

                <ReferralModal
                    state={referralModal}
                    onChange={setReferralModal}
                    onClose={() => setReferralModal(null)}
                    onSubmit={handleIssueReferral}
                    submitting={submittingDoc}
                />

                <ReviewModal
                    state={reviewModal}
                    onChange={setReviewModal}
                    onClose={() => setReviewModal(null)}
                    onSubmit={handleSaveReview}
                />
                </div>{/* p-6 */}
                </div>{/* outer bg */}
            </DashboardLayout>
        </RoleGuard>
    );
}
