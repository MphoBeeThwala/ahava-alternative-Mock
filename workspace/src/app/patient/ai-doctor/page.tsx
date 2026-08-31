"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import RoleGuard, { UserRole } from "../../../components/RoleGuard";
import apiClient, {
  patientApi,
  consentApi,
  type PatientTriageCase,
} from "../../../lib/api";
import { getRealtimeWebSocketUrl } from "../../../lib/realtime";
import { useToast } from "../../../contexts/ToastContext";
import DashboardLayout from "../../../components/DashboardLayout";
import { Card, CardHeader, CardTitle } from "../../../components/ui/Card";

type TriageResult = {
  triageLevel: number;
  recommendedAction: string;
  possibleConditions?: string[];
  reasoning: string;
  doctorNotes?: string;
  doctorDiagnosis?: string;
  doctorRecommendations?: string;
  wasOverridden?: boolean;
  releasedAt?: string;
};

type PendingCase = {
  triageCaseId: string;
  estimatedWaitMinutes: number;
};

type PrescriptionNotice = {
  triageCaseId: string;
  prescriptionId: string;
  diagnosis: string;
  doctorName: string;
  medicationCount: number;
  issuedAt: string;
  downloadUrl: string;
};

type ReferralNotice = {
  triageCaseId: string;
  referralId: string;
  referralType: string;
  provisionalDiagnosis: string;
  recommendedFacility: string;
  doctorName: string;
  issuedAt: string;
  downloadUrl: string;
  emergencyNumbers: { ems: string; national: string; poison: string };
};

type PendingLabResult = {
  fileName: string;
  dataUrl: string;
};

type FollowUpNotice = {
  id: string;
  followUpRequestType?: string | null;
  followUpRequestMessage?: string | null;
  followUpQuestions?: string[];
  requestedInvestigations?: string[];
  attachments?: { id: string; fileName: string; url: string; kind: string }[];
};

function pickCaseToDisplay(cases: PatientTriageCase[]): PatientTriageCase | null {
  return (
    cases.find((triageCase) => triageCase.status === "AWAITING_PATIENT_RESPONSE") ??
    cases.find((triageCase) =>
      ["PENDING_REVIEW", "ASSIGNED", "REVIEWED"].includes(triageCase.status),
    ) ??
    cases[0] ??
    null
  );
}

async function downloadPdf(relativeUrl: string, filename: string) {
  try {
    const res = await apiClient.get(relativeUrl, { responseType: 'blob' });
    const blobUrl = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    // error handled by caller
    throw new Error('Download failed');
  }
}

async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read file"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function AiDoctorPage() {
  const toast = useToast();
  const [symptoms, setSymptoms] = useState("");
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [pendingCase, setPendingCase] = useState<PendingCase | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [labResults, setLabResults] = useState<PendingLabResult[]>([]);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [givingConsent, setGivingConsent] = useState(false);
  const [pendingSymptoms, setPendingSymptoms] = useState<{
    symptoms: string;
    imageBase64?: string;
    labResultFiles?: PendingLabResult[];
  } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [prescriptionNotice, setPrescriptionNotice] = useState<PrescriptionNotice | null>(null);
  const [referralNotice, setReferralNotice] = useState<ReferralNotice | null>(null);
  const [followUpNotice, setFollowUpNotice] = useState<FollowUpNotice | null>(null);
  const [followUpResponse, setFollowUpResponse] = useState("");
  const [followUpFiles, setFollowUpFiles] = useState<PendingLabResult[]>([]);
  const [submittingFollowUp, setSubmittingFollowUp] = useState(false);
  const [showNewSubmissionForm, setShowNewSubmissionForm] = useState(false);

  const resetCaseState = useCallback(() => {
    setPendingCase(null);
    setTriageResult(null);
    setPrescriptionNotice(null);
    setReferralNotice(null);
    setFollowUpNotice(null);
  }, []);

  const hydrateCase = useCallback((triageCase: PatientTriageCase | null) => {
    resetCaseState();
    if (!triageCase) {
      setShowNewSubmissionForm(false);
      return;
    }

    if (triageCase.prescription) {
      setShowNewSubmissionForm(false);
      setPrescriptionNotice({
        triageCaseId: triageCase.id,
        prescriptionId: triageCase.prescription.id,
        diagnosis: triageCase.prescription.diagnosis,
        doctorName: triageCase.prescription.doctorName,
        medicationCount: triageCase.prescription.medicationCount,
        issuedAt: triageCase.prescription.issuedAt,
        downloadUrl: triageCase.prescription.downloadUrl,
      });
      return;
    }

    if (triageCase.referral) {
      setShowNewSubmissionForm(false);
      setReferralNotice({
        triageCaseId: triageCase.id,
        referralId: triageCase.referral.id,
        referralType: triageCase.referral.referralType,
        provisionalDiagnosis: triageCase.referral.provisionalDiagnosis,
        recommendedFacility: triageCase.referral.recommendedFacility,
        doctorName: triageCase.referral.doctorName,
        issuedAt: triageCase.referral.issuedAt,
        downloadUrl: triageCase.referral.downloadUrl,
        emergencyNumbers: { ems: '10177', national: '112', poison: '0861 555 777' },
      });
      return;
    }

    if (triageCase.status === 'AWAITING_PATIENT_RESPONSE') {
      setShowNewSubmissionForm(false);
      setFollowUpNotice({
        id: triageCase.id,
        followUpRequestType: triageCase.followUpRequestType,
        followUpRequestMessage: triageCase.followUpRequestMessage,
        followUpQuestions: triageCase.followUpQuestions,
        requestedInvestigations: triageCase.requestedInvestigations,
        attachments: triageCase.attachments?.filter((item) => item.kind === 'lab_result' || item.kind === 'follow_up_file'),
      });
      return;
    }

    if (triageCase.releasedAt) {
      setShowNewSubmissionForm(false);
      setTriageResult({
        triageLevel: triageCase.finalTriageLevel ?? triageCase.aiTriageLevel,
        recommendedAction: triageCase.aiRecommendedAction,
        possibleConditions: triageCase.aiPossibleConditions,
        reasoning: '',
        doctorNotes: triageCase.doctorNotes ?? undefined,
        doctorDiagnosis: triageCase.doctorDiagnosis ?? undefined,
        doctorRecommendations: triageCase.doctorRecommendations ?? undefined,
        wasOverridden: triageCase.finalTriageLevel != null && triageCase.finalTriageLevel !== triageCase.aiTriageLevel,
        releasedAt: triageCase.releasedAt ?? undefined,
      });
      return;
    }

    setPendingCase({
      triageCaseId: triageCase.id,
      estimatedWaitMinutes: 60,
    });
  }, [resetCaseState]);

  const loadExistingCases = useCallback(async () => {
    try {
      const data = await patientApi.getMyTriageCases();
      const cases = data.cases as PatientTriageCase[];
      hydrateCase(pickCaseToDisplay(cases));
    } catch {
      // keep page usable even if history load fails
    }
  }, [hydrateCase]);

  // WebSocket listener — fires when doctor releases result, prescription, or emergency referral
  useEffect(() => {
    const activeCaseId = pendingCase?.triageCaseId ?? followUpNotice?.id;
    if (!activeCaseId) return;

    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;

    const wsUrl = getRealtimeWebSocketUrl(token);
    if (!wsUrl) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'TRIAGE_RESULT_RELEASED' && msg.data?.triageCaseId === activeCaseId) {
          setTriageResult({
            triageLevel: msg.data.triageLevel,
            recommendedAction: msg.data.recommendedAction,
            possibleConditions: msg.data.possibleConditions,
            reasoning: '',
            doctorNotes: msg.data.doctorNotes,
            doctorDiagnosis: msg.data.doctorDiagnosis,
            doctorRecommendations: msg.data.doctorRecommendations,
            wasOverridden: msg.data.wasOverridden,
            releasedAt: msg.data.releasedAt,
          });
          setPendingCase(null);
          setFollowUpNotice(null);
          toast.success('Your triage result has been released by a doctor.');
          void loadExistingCases();
        }

        if (msg.type === 'PRESCRIPTION_ISSUED' && msg.data?.triageCaseId === activeCaseId) {
          setPrescriptionNotice(msg.data as PrescriptionNotice);
          setPendingCase(null);
          setFollowUpNotice(null);
          toast.success(`Prescription issued by ${msg.data.doctorName}. Download your script below.`);
          void loadExistingCases();
        }

        if (msg.type === 'EMERGENCY_REFERRAL_ISSUED' && msg.data?.triageCaseId === activeCaseId) {
          setReferralNotice(msg.data as ReferralNotice);
          setPendingCase(null);
          setFollowUpNotice(null);
          toast.error('Emergency referral issued. Please act immediately — see instructions below.');
          void loadExistingCases();
        }

        if (msg.type === 'TRIAGE_FOLLOW_UP_REQUESTED' && msg.data?.triageCaseId === activeCaseId) {
          setPendingCase(null);
          setFollowUpNotice({
            id: msg.data.triageCaseId,
            followUpRequestType: msg.data.requestType,
            followUpRequestMessage: msg.data.message,
            followUpQuestions: Array.isArray(msg.data.questions) ? msg.data.questions : [],
            requestedInvestigations: Array.isArray(msg.data.requestedInvestigations) ? msg.data.requestedInvestigations : [],
            attachments: [],
          });
          toast.success('Your doctor requested more information before completing the review.');
          void loadExistingCases();
        }

        if (msg.type === "TRIAGE_FOLLOW_UP_RECEIVED" && msg.data?.triageCaseId === activeCaseId) {
          void loadExistingCases();
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => {
      ws.close();
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [followUpNotice?.id, loadExistingCases, pendingCase?.triageCaseId, toast]);

  useEffect(() => {
    if (!pendingCase && !followUpNotice) return;

    const intervalId = window.setInterval(() => {
      void loadExistingCases();
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [followUpNotice, loadExistingCases, pendingCase]);

  useEffect(() => {
    loadExistingCases();
  }, [loadExistingCases]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setSelectedImage(dataUrl);
      } catch {
        toast.error("Failed to read the image attachment.");
      }
    }
  };

  const handleLabResultsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 3);
    if (files.length === 0) return;

    try {
      const nextFiles = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          dataUrl: await readFileAsDataUrl(file),
        })),
      );
      setLabResults(nextFiles);
    } catch {
      toast.error("Failed to read one or more lab-result attachments.");
    }
  };

  const handleFollowUpFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 3);
    if (files.length === 0) return;

    try {
      const nextFiles = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          dataUrl: await readFileAsDataUrl(file),
        })),
      );
      setFollowUpFiles(nextFiles);
    } catch {
      toast.error("Failed to read one or more follow-up attachments.");
    }
  };

  const runTriage = async (payload: {
    symptoms: string;
    imageBase64?: string;
    labResultFiles?: PendingLabResult[];
  }) => {
    setLoading(true);
    try {
      const result = await patientApi.submitTriage(payload);
      if ((result.status === 'PENDING_REVIEW' || (result.success && result.triageCaseId)) && result.triageCaseId) {
        resetCaseState();
        setShowNewSubmissionForm(false);
        setPendingCase({
          triageCaseId: result.triageCaseId,
          estimatedWaitMinutes: result.meta?.estimatedWaitMinutes ?? 60,
        });
      } else if (result.data) {
        setTriageResult(result.data);
      }
    } catch (error: unknown) {
      const e = error as { response?: { data?: { error?: string; consentType?: string }; status?: number } };
      const status = e.response?.status;
      if (status === 403 && e.response?.data?.error === 'CONSENT_REQUIRED') {
        setPendingSymptoms(payload);
        setShowConsentModal(true);
      } else {
        toast.error(e.response?.data?.error || "Failed to analyze symptoms. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTriage = () =>
    runTriage({
      symptoms,
      imageBase64: selectedImage || undefined,
      labResultFiles: labResults.length > 0 ? labResults : undefined,
    });

  const handleGiveConsent = async () => {
    if (!consentChecked) return;
    setGivingConsent(true);
    try {
      await consentApi.give('AI_TRIAGE');
      setShowConsentModal(false);
      toast.success('Consent recorded. Running analysis…');
      if (pendingSymptoms) await runTriage(pendingSymptoms);
    } catch {
      toast.error('Failed to record consent. Please try again.');
    } finally {
      setGivingConsent(false);
      setPendingSymptoms(null);
    }
  };

  const handleSubmitFollowUp = async () => {
    if (!followUpNotice) return;
    if (!followUpResponse.trim() && followUpFiles.length === 0) {
      toast.error('Please answer the doctor or attach the requested results.');
      return;
    }

    setSubmittingFollowUp(true);
    try {
      await patientApi.submitTriageFollowUp(followUpNotice.id, {
        responseText: followUpResponse || undefined,
        followUpFiles: followUpFiles.length > 0 ? followUpFiles : undefined,
      });
      toast.success('Your response was sent to the reviewing doctor.');
      setFollowUpResponse('');
      setFollowUpFiles([]);
      await loadExistingCases();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to send follow-up response.');
    } finally {
      setSubmittingFollowUp(false);
    }
  };

  return (
    <RoleGuard allowedRoles={[UserRole.PATIENT]}>
      <DashboardLayout>

        {/* ── HPCSA informed-consent modal ── */}
        {showConsentModal && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div style={{ background: 'var(--card)', borderRadius: 20, maxWidth: 520, width: '100%', padding: '32px 28px', boxShadow: '0 16px 60px rgba(0,0,0,0.3)' }}>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--foreground)', marginBottom: 8 }}>Informed Consent Required</h2>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
                In terms of the <strong>Health Professions Act 56 of 1974</strong> and <strong>HPCSA telemedicine guidelines</strong>, you must provide informed consent before using this AI-assisted symptom analysis tool.
              </p>
              <ul style={{ fontSize: 13, color: 'var(--foreground)', lineHeight: 1.8, paddingLeft: 20, marginBottom: 20 }}>
                <li>This tool provides <strong>decision support only</strong> — not a medical diagnosis.</li>
                <li>Your symptoms will be processed by an AI model and reviewed by a qualified doctor.</li>
                <li>Your data is handled in accordance with <strong>POPIA</strong> and our Privacy Policy.</li>
                <li>You may withdraw this consent at any time from your account settings.</li>
              </ul>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 24, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  style={{ marginTop: 2, accentColor: 'var(--primary)', width: 16, height: 16, flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: 'var(--foreground)', lineHeight: 1.5 }}>
                  I have read and understood the above. I voluntarily consent to AI-assisted triage analysis of my symptoms.
                </span>
              </label>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={handleGiveConsent}
                  disabled={!consentChecked || givingConsent}
                  style={{ flex: 2, padding: '13px', borderRadius: 12, border: 'none', background: consentChecked ? 'var(--primary)' : '#94a3b8', color: 'white', fontSize: 15, fontWeight: 700, cursor: consentChecked ? 'pointer' : 'not-allowed', fontFamily: 'inherit', transition: 'background 0.2s' }}
                >
                  {givingConsent ? 'Recording consent…' : 'I consent — Continue'}
                </button>
                <button
                  onClick={() => { setShowConsentModal(false); setPendingSymptoms(null); }}
                  style={{ flex: 1, padding: '13px', borderRadius: 12, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="p-6 sm:p-8 bg-[var(--background)]">
          <div className="max-w-2xl mx-auto">
            <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)] tracking-tight">
                AI Doctor Assistant
              </h1>
              <Link
                href="/patient/dashboard"
                className="text-sm font-medium hover:underline"
                style={{ color: "var(--primary)" }}
              >
                ← Back to dashboard
              </Link>
            </div>

            <p className="text-sm text-[var(--muted)] mb-6">
              Describe your symptoms and optionally attach a photo plus lab results. This is a decision-support tool only — not a medical diagnosis. Always follow clinical advice.
            </p>

            <Card>
              <CardHeader>
                <CardTitle>Symptom check</CardTitle>
              </CardHeader>

              {/* Waiting state — case submitted, doctor not yet released */}
              {pendingCase && !triageResult && !followUpNotice && (
                <div className="space-y-4 text-center py-6">
                  <div className="flex items-center justify-center mb-4">
                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(37,99,235,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>⏳</div>
                  </div>
                  <h3 className="font-bold text-slate-900">Under doctor review</h3>
                  <p className="text-sm text-slate-600 max-w-sm mx-auto">
                    Your case has been received and assigned to a qualified doctor for review. You will be notified here in real time when the result is released.
                  </p>
                  <p className="text-xs text-slate-400">
                    Estimated wait: ~{pendingCase.estimatedWaitMinutes} minutes · Case ID: {pendingCase.triageCaseId.slice(-6).toUpperCase()}
                  </p>
                  <p className="text-xs text-amber-600 font-medium">
                    If you are experiencing a medical emergency, call <strong>10177</strong> (ambulance) or <strong>112</strong> immediately.
                  </p>
                  {!showNewSubmissionForm && (
                    <button
                      onClick={() => setShowNewSubmissionForm(true)}
                      className="text-sm font-medium hover:underline"
                      style={{ color: "var(--primary)" }}
                    >
                      Submit a different symptom check
                    </button>
                  )}
                </div>
              )}

              {followUpNotice && (
                <div className="space-y-4 py-2">
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <h3 className="font-bold text-blue-900">Doctor requested {followUpNotice.followUpRequestType === 'INVESTIGATION' ? 'investigations' : 'more information'}</h3>
                    {followUpNotice.followUpRequestMessage && (
                      <p className="mt-2 text-sm text-blue-800">{followUpNotice.followUpRequestMessage}</p>
                    )}
                    {!!followUpNotice.followUpQuestions?.length && (
                      <div className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Questions</p>
                        <ul className="mt-1 space-y-1 text-sm text-blue-800">
                          {followUpNotice.followUpQuestions.map((question, idx) => (
                            <li key={idx}>• {question}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {!!followUpNotice.requestedInvestigations?.length && (
                      <div className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Requested investigations</p>
                        <ul className="mt-1 space-y-1 text-sm text-blue-800">
                          {followUpNotice.requestedInvestigations.map((item, idx) => (
                            <li key={idx}>• {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <textarea
                    className="w-full p-4 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                    rows={4}
                    placeholder="Reply to your doctor here..."
                    value={followUpResponse}
                    onChange={(e) => setFollowUpResponse(e.target.value)}
                  />

                  <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-500 transition cursor-pointer relative">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      onChange={handleFollowUpFilesUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      aria-label="Upload follow-up files"
                    />
                    <div className="space-y-2">
                      <span className="text-3xl" aria-hidden>📎</span>
                      <p className="text-sm font-medium text-slate-600">
                        {followUpFiles.length > 0
                          ? `${followUpFiles.length} follow-up file${followUpFiles.length > 1 ? 's' : ''} attached`
                          : 'Attach requested results or supporting documents'}
                      </p>
                      <p className="text-xs text-slate-500">PDF or image, up to 3 files.</p>
                    </div>
                  </div>

                  {followUpFiles.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      <p className="mb-2 font-medium text-slate-800">Files ready to send</p>
                      <ul className="space-y-1">
                        {followUpFiles.map((file) => (
                          <li key={file.fileName}>{file.fileName}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button
                    onClick={handleSubmitFollowUp}
                    disabled={submittingFollowUp}
                    className="btn-primary w-full py-3 rounded-xl font-semibold disabled:opacity-50"
                  >
                    {submittingFollowUp ? 'Sending…' : 'Send follow-up response'}
                  </button>
                </div>
              )}

              {/* Input form */}
              {!triageResult && (!pendingCase || showNewSubmissionForm) && !followUpNotice && (
                <div className="space-y-4">
                  {pendingCase && showNewSubmissionForm && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      You still have another case under doctor review. This form will submit a new symptom check for a separate issue.
                    </div>
                  )}
                  <textarea
                    id="triage-symptoms"
                    name="symptoms"
                    className="w-full p-4 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                    rows={4}
                    placeholder="Describe your symptoms..."
                    value={symptoms}
                    onChange={(e) => setSymptoms(e.target.value)}
                  />

                  <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-500 transition cursor-pointer relative">
                    <input
                      id="triage-image"
                      name="triageImage"
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      aria-label="Upload a photo for triage"
                    />
                    <div className="space-y-2">
                      <span className="text-3xl" aria-hidden>📸</span>
                      <p className="text-sm font-medium text-slate-600">
                        {selectedImage ? "Image attached" : "Upload a photo (optional)"}
                      </p>
                    </div>
                  </div>

                  <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-500 transition cursor-pointer relative">
                    <input
                      id="triage-lab-results"
                      name="triageLabResults"
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      onChange={handleLabResultsUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      aria-label="Upload lab results for triage"
                    />
                    <div className="space-y-2">
                      <span className="text-3xl" aria-hidden>🧪</span>
                      <p className="text-sm font-medium text-slate-600">
                        {labResults.length > 0
                          ? `${labResults.length} lab result${labResults.length > 1 ? "s" : ""} attached`
                          : "Attach lab results or investigation reports (optional)"}
                      </p>
                      <p className="text-xs text-slate-500">
                        PDF or image, up to 3 files. These are sent to the reviewing doctor with your case.
                      </p>
                    </div>
                  </div>

                  {labResults.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      <p className="mb-2 font-medium text-slate-800">Attached lab results</p>
                      <ul className="space-y-1">
                        {labResults.map((file) => (
                          <li key={file.fileName}>{file.fileName}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button
                    onClick={handleTriage}
                    disabled={loading || !symptoms}
                    className="btn-primary w-full py-3 rounded-xl font-semibold disabled:opacity-50"
                  >
                    {loading ? "Submitting…" : "Submit for doctor review"}
                  </button>
                  {pendingCase && showNewSubmissionForm && (
                    <button
                      onClick={() => setShowNewSubmissionForm(false)}
                      className="text-sm font-medium w-full text-center hover:underline"
                      style={{ color: "var(--primary)" }}
                    >
                      Return to the active case
                    </button>
                  )}
                </div>
              )}

              {/* Released result — doctor-reviewed */}
              {triageResult && (
                <div className="space-y-4">
                  <div
                    className={`p-4 rounded-lg border-l-4 ${
                      triageResult.triageLevel < 3 ? "bg-red-50 border-red-500" : "bg-emerald-50 border-emerald-500"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-bold text-slate-900">Doctor-reviewed result</h3>
                      {triageResult.wasOverridden && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">AI level adjusted</span>
                      )}
                    </div>
                    {triageResult.doctorDiagnosis && (
                      <p className="mb-2 text-slate-800"><strong>Diagnosis:</strong> {triageResult.doctorDiagnosis}</p>
                    )}
                    <p className="mb-2 text-slate-800">
                      <strong>Recommended action:</strong> {triageResult.recommendedAction}
                    </p>
                    {triageResult.doctorRecommendations && (
                      <p className="mb-2 text-slate-700 text-sm"><strong>Doctor&apos;s advice:</strong> {triageResult.doctorRecommendations}</p>
                    )}
                    {triageResult.doctorNotes && (
                      <p className="text-sm text-slate-600"><strong>Clinical notes:</strong> {triageResult.doctorNotes}</p>
                    )}
                    {!triageResult.doctorDiagnosis && (
                      <p className="text-sm text-slate-700">
                        <strong>Possible conditions:</strong> {triageResult.possibleConditions?.join(", ")}
                      </p>
                    )}
                  </div>
                  {triageResult.releasedAt && (
                    <p className="text-xs text-center text-slate-400">
                      Released by doctor at {new Date(triageResult.releasedAt).toLocaleTimeString()} · Licensed physician
                    </p>
                  )}
                  <p className="text-xs text-center text-slate-500 italic">This result was reviewed and released by a licensed doctor. It is decision support — always follow clinical advice.</p>
                  <button
                    onClick={() => { setTriageResult(null); setPendingCase(null); setSymptoms(""); setSelectedImage(null); setLabResults([]); }}
                    className="text-sm font-medium w-full text-center hover:underline"
                    style={{ color: "var(--primary)" }}
                  >
                    Start over
                  </button>
                </div>
              )}

              {/* Prescription notice */}
              {prescriptionNotice && (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg border-l-4 bg-teal-50 border-teal-500">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">💊</span>
                      <h3 className="font-bold text-teal-900">Prescription issued</h3>
                    </div>
                    <p className="text-sm text-teal-800 mb-1"><strong>Diagnosis:</strong> {prescriptionNotice.diagnosis}</p>
                    <p className="text-sm text-teal-700 mb-1"><strong>Medications:</strong> {prescriptionNotice.medicationCount} item{prescriptionNotice.medicationCount !== 1 ? 's' : ''} prescribed</p>
                    <p className="text-sm text-teal-700 mb-3"><strong>Prescribing doctor:</strong> {prescriptionNotice.doctorName}</p>
                    <button
                      onClick={() =>
                        downloadPdf(
                          prescriptionNotice.downloadUrl,
                          `prescription-${prescriptionNotice.prescriptionId.slice(-8)}.pdf`
                        ).catch(() => toast.error('Failed to download PDF.'))
                      }
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-white text-sm"
                      style={{ background: '#0d9488' }}
                    >
                      ⬇ Download prescription PDF
                    </button>
                    <p className="text-xs text-teal-600 mt-2">Present this PDF at any pharmacy. Valid 30 days from issue.</p>
                  </div>
                  <p className="text-xs text-center text-slate-500 italic">Prescription issued by a licensed doctor via Ahava Healthcare Platform.</p>
                  <button
                    onClick={() => { setPrescriptionNotice(null); setSymptoms(""); setSelectedImage(null); setLabResults([]); }}
                    className="text-sm font-medium w-full text-center hover:underline"
                    style={{ color: "var(--primary)" }}
                  >
                    Start over
                  </button>
                </div>
              )}

              {/* Emergency referral notice */}
              {referralNotice && (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg border-2 border-red-500 bg-red-50">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">🚨</span>
                      <h3 className="font-bold text-red-900 text-lg">Emergency referral issued</h3>
                    </div>
                    <div className="bg-red-100 rounded-lg p-3 mb-3">
                      <p className="text-sm font-bold text-red-800">⚠️ Please seek medical attention immediately</p>
                      <p className="text-xs text-red-700 mt-1">Call <strong>10177</strong> (EMS) or <strong>112</strong> (National Emergency) now if you feel unwell.</p>
                    </div>
                    <p className="text-sm text-red-800 mb-1"><strong>Provisional diagnosis:</strong> {referralNotice.provisionalDiagnosis}</p>
                    <p className="text-sm text-red-800 mb-1"><strong>Recommended facility:</strong> {referralNotice.recommendedFacility}</p>
                    <p className="text-sm text-red-800 mb-1"><strong>Referral type:</strong> {referralNotice.referralType}</p>
                    <p className="text-sm text-red-700 mb-3"><strong>Referring doctor:</strong> {referralNotice.doctorName}</p>
                    <button
                      onClick={() =>
                        downloadPdf(
                          referralNotice.downloadUrl,
                          `referral-${referralNotice.referralId.slice(-8)}.pdf`
                        ).catch(() => toast.error('Failed to download referral PDF.'))
                      }
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-white text-sm"
                      style={{ background: '#dc2626' }}
                    >
                      ⬇ Download referral letter PDF
                    </button>
                    <p className="text-xs text-red-600 mt-2">Show this letter at any hospital, clinic or emergency facility — even without internet access.</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[['🚑 Ambulance', '10177'], ['🆘 Emergency', '112'], ['☠ Poison', '0861 555 777']].map(([label, num]) => (
                      <a key={num} href={`tel:${num.replace(/\s/g,'')}`}
                        className="p-3 rounded-lg border font-bold text-sm"
                        style={{ borderColor: '#dc2626', color: '#dc2626', textDecoration: 'none' }}
                      >
                        <div>{label}</div><div className="text-xs font-normal">{num}</div>
                      </a>
                    ))}
                  </div>
                  <button
                    onClick={() => { setReferralNotice(null); setSymptoms(""); setSelectedImage(null); setLabResults([]); }}
                    className="text-sm font-medium w-full text-center hover:underline"
                    style={{ color: "var(--primary)" }}
                  >
                    Start over
                  </button>
                </div>
              )}
            </Card>
          </div>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
