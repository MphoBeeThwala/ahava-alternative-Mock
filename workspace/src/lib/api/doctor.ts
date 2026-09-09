import { apiClient } from './client';
import type { TriageAttachment, MedicalPassportSummary, SafetySummary } from './patient';

export interface TriageCase {
  id: string;
  patientId: string;
  doctorId: string | null;
  symptoms: string;
  aiTriageLevel: number;
  aiRecommendedAction: string;
  aiPossibleConditions: string[];
  aiReasoning: string;
  status: string;
  doctorNotes: string | null;
  doctorDiagnosis: string | null;
  doctorRecommendations: string | null;
  finalDiagnosis: string | null;
  finalTriageLevel: number | null;
  referredTo: string | null;
  aiModel: string | null;
  aiContextUsed: boolean;
  createdAt: string;
  followUpRequestType?: string | null;
  followUpRequestMessage?: string | null;
  followUpQuestions?: string[];
  requestedInvestigations?: string[];
  followUpRequestedAt?: string | null;
  patientFollowUpResponse?: string | null;
  patientRespondedAt?: string | null;
  attachments?: TriageAttachment[];
  medicalPassport?: MedicalPassportSummary | null;
  reviewSafety?: SafetySummary | null;
  patient?: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string | null;
    // Present in the actual API response (triageCaseReview.ts's
    // triageCaseInclude selects both) but not previously declared here.
    dateOfBirth?: string | null;
    gender?: string | null;
  };
}

export interface PatientTriageCase {
  id: string;
  status: string;
  createdAt: string;
  slaDeadline?: string | null;
  aiTriageLevel: number;
  aiRecommendedAction: string;
  aiPossibleConditions: string[];
  doctorNotes?: string | null;
  doctorDiagnosis?: string | null;
  doctorRecommendations?: string | null;
  finalTriageLevel?: number | null;
  releasedAt?: string | null;
  followUpRequestType?: string | null;
  followUpRequestMessage?: string | null;
  followUpQuestions?: string[];
  requestedInvestigations?: string[];
  followUpRequestedAt?: string | null;
  patientFollowUpResponse?: string | null;
  patientRespondedAt?: string | null;
  doctorName?: string | null;
  attachments: TriageAttachment[];
  prescription?: {
    id: string;
    diagnosis: string;
    medicationCount: number;
    issuedAt: string;
    downloadUrl: string;
    doctorName: string;
  } | null;
  referral?: {
    id: string;
    referralType: string;
    provisionalDiagnosis: string;
    recommendedFacility: string;
    issuedAt: string;
    downloadUrl: string;
    doctorName: string;
  } | null;
}

export const doctorApi = {
  getPendingVisits: async () => {
    const res = await apiClient.get('/visits?status=PENDING_REVIEW');
    const data = res.data ?? {};
    return {
      ...data,
      visits: Array.isArray(data.visits) ? data.visits : [],
    };
  },
  approveVisit: async (visitId: string, review?: string) => {
    const res = await apiClient.post(`/visits/${visitId}/approve`, review != null ? { review } : {});
    return res.data;
  },
  getTriageCases: async (status?: 'PENDING_REVIEW' | 'mine') => {
    const q = status ? `?status=${status}` : '?status=PENDING_REVIEW';
    const res = await apiClient.get(`/triage-cases${q}`);
    return res.data;
  },
  approveTriageCase: async (caseId: string, finalDiagnosis?: string) => {
    const res = await apiClient.post(`/triage-cases/${caseId}/approve`, finalDiagnosis != null ? { finalDiagnosis } : {});
    return res.data;
  },
  overrideTriageCase: async (caseId: string, doctorNotes?: string, finalDiagnosis?: string) => {
    const res = await apiClient.post(`/triage-cases/${caseId}/override`, { doctorNotes, finalDiagnosis });
    return res.data;
  },
  referTriageCase: async (caseId: string, referredTo: string, doctorNotes?: string) => {
    const res = await apiClient.post(`/triage-cases/${caseId}/refer`, { referredTo, doctorNotes });
    return res.data;
  },
  // New review-flow endpoints
  claimTriageCase: async (caseId: string) => {
    const res = await apiClient.post(`/triage-review/${caseId}/claim`);
    return res.data;
  },
  reviewTriageCase: async (caseId: string, payload: {
    doctorNotes: string;
    doctorDiagnosis: string;
    doctorRecommendations?: string;
    finalTriageLevel?: number;
    overrideReason?: string;
  }) => {
    const res = await apiClient.post(`/triage-review/${caseId}/review`, payload);
    return res.data;
  },
  releaseTriageCase: async (caseId: string) => {
    const res = await apiClient.post(`/triage-review/${caseId}/release`);
    return res.data;
  },
  getTriageReviewQueue: async (status = 'PENDING_REVIEW') => {
    const res = await apiClient.get(`/triage-review?status=${status}`);
    const data = res.data ?? {};
    return {
      ...data,
      cases: Array.isArray(data.cases) ? data.cases : [],
    };
  },
  issuePrescription: async (caseId: string, payload: {
    diagnosis: string;
    medications: { name: string; dosage: string; frequency: string; duration: string; instructions?: string }[];
    doctorNotes?: string;
  }) => {
    const res = await apiClient.post(`/triage-review/${caseId}/prescription`, payload);
    return res.data;
  },
  requestTriageFollowUp: async (caseId: string, payload: {
    requestType: 'MORE_INFO' | 'INVESTIGATION';
    message?: string;
    questions?: string[];
    requestedInvestigations?: string[];
  }) => {
    const res = await apiClient.post(`/triage-review/${caseId}/request-follow-up`, payload);
    return res.data;
  },
  issueEmergencyReferral: async (caseId: string, payload: {
    referralType: string;
    provisionalDiagnosis: string;
    clinicalNotes: string;
    recommendedFacility: string;
  }) => {
    const res = await apiClient.post(`/triage-review/${caseId}/emergency-referral`, payload);
    return res.data;
  },
  getPrescriptionPdfUrl: (caseId: string) => `/api/triage-review/${caseId}/prescription/pdf`,
  getReferralPdfUrl: (caseId: string) => `/api/triage-review/${caseId}/referral/pdf`,
};
