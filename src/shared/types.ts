export type UserRole = "PATIENT" | "NURSE" | "DOCTOR";

export type MedicalSpecialtyType =
  | "GENERAL_PRACTICE"
  | "DERMATOLOGY"
  | "DENTISTRY"
  | "CARDIOLOGY"
  | "NEUROLOGY"
  | "ORTHOPEDICS"
  | "OPHTHALMOLOGY"
  | "ENT"
  | "GASTROENTEROLOGY"
  | "PULMONOLOGY"
  | "PSYCHIATRY"
  | "UROLOGY"
  | "GYNECOLOGY"
  | "ENDOCRINOLOGY"
  | "PEDIATRICS"
  | "RADIOLOGY"
  | "EMERGENCY_MEDICINE"
  | "NURSING";

export type PriorityLevelType = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type AppointmentStatus =
  | "PENDING"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export type AlertStatus = "ACTIVE" | "RESOLVED" | "FALSE_ALARM";

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  id: number;
  user_id: string;
  full_name: string | null;
  role: UserRole;
  sanc_id: string | null;
  phone_number: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  is_verified: number;
  is_online: number;
  created_at: string;
  updated_at: string;
}

export interface DiagnosticReport {
  id: number;
  patient_id: string;
  doctor_id: string | null;
  report_type: string;
  ai_analysis: string | null;
  ai_confidence: number | null;
  symptoms: string;
  doctor_notes: string | null;
  diagnosis: string | null;
  recommendations: string | null;
  is_released: number;
  released_at: string | null;
  created_at: string;
  updated_at: string;
}

