"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import RoleGuard, { UserRole } from "../../../components/RoleGuard";
import { patientApi, consentApi } from "../../../lib/api";
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

export default function AiDoctorPage() {
  const toast = useToast();
  const [symptoms, setSymptoms] = useState("");
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [pendingCase, setPendingCase] = useState<PendingCase | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [givingConsent, setGivingConsent] = useState(false);
  const [pendingSymptoms, setPendingSymptoms] = useState<{ symptoms: string; imageBase64?: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // WebSocket listener — fires when doctor releases triage result
  useEffect(() => {
    if (!pendingCase) return;

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) return;

    const wsBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000')
      .replace(/^http/, 'ws')
      .replace(/\/$/, '');
    const ws = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'TRIAGE_RESULT_RELEASED' && msg.data?.triageCaseId === pendingCase.triageCaseId) {
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
          toast.success('Your triage result has been released by a doctor.');
        }
      } catch { /* ignore parse errors */ }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [pendingCase, toast]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(",")[1];
        setSelectedImage(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const runTriage = async (payload: { symptoms: string; imageBase64?: string }) => {
    setLoading(true);
    try {
      const result = await patientApi.submitTriage(payload);
      if (result.status === 'PENDING_REVIEW' && result.triageCaseId) {
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

  const handleTriage = () => runTriage({ symptoms, imageBase64: selectedImage || undefined });

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
              Describe your symptoms and optionally attach a photo. This is a decision-support tool only — not a medical diagnosis. Always follow clinical advice.
            </p>

            <Card>
              <CardHeader>
                <CardTitle>Symptom check</CardTitle>
              </CardHeader>

              {/* Waiting state — case submitted, doctor not yet released */}
              {pendingCase && !triageResult && (
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
                </div>
              )}

              {/* Input form */}
              {!triageResult && !pendingCase && (
                <div className="space-y-4">
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

                  <button
                    onClick={handleTriage}
                    disabled={loading || !symptoms}
                    className="btn-primary w-full py-3 rounded-xl font-semibold disabled:opacity-50"
                  >
                    {loading ? "Submitting…" : "Submit for doctor review"}
                  </button>
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
                    onClick={() => {
                      setTriageResult(null);
                      setPendingCase(null);
                      setSymptoms("");
                      setSelectedImage(null);
                    }}
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
