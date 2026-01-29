/**
 * Input Validation Schemas
 * Zod schemas for API request validation
 */

import { z } from "zod";

// Diagnostic Analysis Request
export const DiagnosticAnalysisRequestSchema = z.object({
  symptoms: z.string().min(10, "Symptoms must be at least 10 characters").max(5000, "Symptoms too long"),
  imageUrls: z.array(z.string().url()).max(10, "Maximum 10 images allowed").optional(),
  severityLevel: z.enum(["LOW", "MODERATE", "HIGH"]).optional(),
  duration: z.string().max(200).optional(),
  medications: z.string().max(1000).optional(),
});

// Profile Update Request
export const ProfileUpdateSchema = z.object({
  full_name: z.string().min(2, "Name must be at least 2 characters").max(100),
  role: z.enum(["PATIENT", "NURSE", "DOCTOR", "ADMIN"]),
  phone_number: z.string().regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format"),
  address: z.string().min(5).max(500),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  sanc_id: z.string().max(50).nullable().optional(),
  has_accepted_terms: z.boolean().optional(),
  terms_accepted_at: z.string().datetime().optional(),
});

// Appointment Request
export const AppointmentRequestSchema = z.object({
  service_type: z.enum(["HOME_VISIT", "CONSULTATION", "EMERGENCY", "FOLLOW_UP"]),
  patient_address: z.string().min(5).max(500),
  patient_latitude: z.number().min(-90).max(90).optional(),
  patient_longitude: z.number().min(-180).max(180).optional(),
  notes: z.string().max(1000).optional(),
  preferred_time: z.string().datetime().optional(),
});

// Biometric Recording
export const BiometricRecordSchema = z.object({
  type: z.enum(["HEART_RATE", "BLOOD_PRESSURE", "SPO2", "TEMPERATURE", "WEIGHT", "GLUCOSE"]),
  value: z.number().positive(),
  unit: z.string().max(20),
  notes: z.string().max(500).optional(),
});

// Baseline Update
export const BaselineUpdateSchema = z.object({
  hr_baseline_mean: z.number().min(30).max(200).optional(),
  hr_baseline_std: z.number().min(0).max(50).optional(),
  hrv_baseline_mean: z.number().min(0).max(200).optional(),
  hrv_baseline_std: z.number().min(0).max(100).optional(),
  spo2_baseline_mean: z.number().min(70).max(100).optional(),
  spo2_baseline_std: z.number().min(0).max(10).optional(),
  is_complete: z.boolean().optional(),
});

// Doctor Review
export const DoctorReviewSchema = z.object({
  approved: z.boolean(),
  doctor_notes: z.string().max(2000).optional(),
  modified_diagnosis: z.string().max(5000).optional(),
  modified_recommendations: z.string().max(5000).optional(),
  modified_specialty: z.enum([
    "GENERAL_PRACTICE",
    "CARDIOLOGY",
    "DERMATOLOGY",
    "ORTHOPEDICS",
    "NEUROLOGY",
    "GASTROENTEROLOGY",
    "PULMONOLOGY",
    "ENDOCRINOLOGY",
    "OPHTHALMOLOGY",
    "ENT",
    "PSYCHIATRY",
    "EMERGENCY_MEDICINE"
  ]).optional(),
  modified_priority: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).optional(),
});

/**
 * Validate request body against schema
 * Throws ZodError if validation fails
 */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

/**
 * Safe validation that returns result object
 */
export function validateSafe<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Format Zod errors for API responses
 */
export function formatZodError(error: z.ZodError): {
  message: string;
  errors: Array<{ field: string; message: string }>;
} {
  return {
    message: "Validation failed",
    errors: error.errors.map((err) => ({
      field: err.path.join("."),
      message: err.message,
    })),
  };
}

