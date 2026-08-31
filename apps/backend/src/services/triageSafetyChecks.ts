export interface MedicalPassportData {
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  bloodType: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  pregnancy: boolean | null;
  missingFields: string[];
}

export interface SafetySummary {
  canPrescribe: boolean;
  blockers: string[];
  warnings: string[];
  missingFields: string[];
}

type RiskProfileLike = unknown;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function isLikelyChildBearingAge(dateOfBirth?: Date | null) {
  if (!dateOfBirth) return true;
  const years =
    (Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return years >= 12 && years <= 55;
}

export function extractMedicalPassportData(params: {
  riskProfile: RiskProfileLike;
  dateOfBirth?: Date | null;
  gender?: string | null;
}): MedicalPassportData {
  const riskProfile = params.riskProfile ?? {};
  const medicalPassport =
    riskProfile && typeof riskProfile === "object"
      ? ((riskProfile as Record<string, unknown>).medicalPassport as
          | Record<string, unknown>
          | undefined)
      : undefined;

  const allergies = asStringArray(medicalPassport?.allergies);
  const chronicConditions = asStringArray(medicalPassport?.chronicConditions);
  const currentMedications = asStringArray(medicalPassport?.currentMedications);
  const bloodType =
    typeof medicalPassport?.bloodType === "string" && medicalPassport.bloodType.trim()
      ? medicalPassport.bloodType.trim()
      : null;
  const emergencyContactName =
    typeof medicalPassport?.emergencyContactName === "string" &&
    medicalPassport.emergencyContactName.trim()
      ? medicalPassport.emergencyContactName.trim()
      : null;
  const emergencyContactPhone =
    typeof medicalPassport?.emergencyContactPhone === "string" &&
    medicalPassport.emergencyContactPhone.trim()
      ? medicalPassport.emergencyContactPhone.trim()
      : null;

  const missingFields: string[] = [];
  if (allergies.length === 0) missingFields.push("allergies");
  if (currentMedications.length === 0) missingFields.push("current medications");
  if (chronicConditions.length === 0) missingFields.push("chronic conditions");

  const normalizedGender = (params.gender ?? "").toLowerCase();
  const pregnancyRaw =
    riskProfile && typeof riskProfile === "object"
      ? (riskProfile as Record<string, unknown>).pregnancy
      : undefined;
  const pregnancy =
    typeof pregnancyRaw === "boolean" ? pregnancyRaw : null;

  if (
    ["female", "woman", "f"].includes(normalizedGender) &&
    isLikelyChildBearingAge(params.dateOfBirth)
  ) {
    if (pregnancy === null) {
      missingFields.push("pregnancy status");
    }
  }

  return {
    allergies,
    chronicConditions,
    currentMedications,
    bloodType,
    emergencyContactName,
    emergencyContactPhone,
    pregnancy,
    missingFields,
  };
}

export function buildPrescriptionSafetySummary(params: {
  riskProfile: RiskProfileLike;
  medications?: { name?: string }[];
  dateOfBirth?: Date | null;
  gender?: string | null;
}): SafetySummary {
  const passport = extractMedicalPassportData({
    riskProfile: params.riskProfile,
    dateOfBirth: params.dateOfBirth,
    gender: params.gender,
  });

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (passport.allergies.length === 0) {
    blockers.push("Patient allergies are not recorded in the medical passport.");
  }
  if (passport.currentMedications.length === 0) {
    blockers.push("Current medications are not recorded in the medical passport.");
  }
  if (passport.chronicConditions.length === 0) {
    warnings.push("Chronic conditions are not recorded in the medical passport.");
  }
  if (passport.missingFields.includes("pregnancy status")) {
    warnings.push("Pregnancy status is not recorded for this patient.");
  }

  const prescribed = (params.medications ?? [])
    .map((med) => med.name?.trim())
    .filter((name): name is string => Boolean(name));

  const allergySet = new Set(passport.allergies.map(normalize));
  const medicationSet = new Set(passport.currentMedications.map(normalize));

  for (const med of prescribed) {
    const normalized = normalize(med);
    if (allergySet.has(normalized)) {
      blockers.push(`'${med}' matches a recorded patient allergy.`);
    }
    if (medicationSet.has(normalized)) {
      warnings.push(`'${med}' is already listed in the patient's current medications.`);
    }
  }

  return {
    canPrescribe: blockers.length === 0,
    blockers,
    warnings,
    missingFields: passport.missingFields,
  };
}

export function buildReviewSafetySummary(params: {
  riskProfile: RiskProfileLike;
  dateOfBirth?: Date | null;
  gender?: string | null;
}): SafetySummary {
  const passport = extractMedicalPassportData({
    riskProfile: params.riskProfile,
    dateOfBirth: params.dateOfBirth,
    gender: params.gender,
  });

  const warnings: string[] = [];

  if (passport.allergies.length === 0) {
    warnings.push("Patient allergies are not recorded in the medical passport.");
  }
  if (passport.currentMedications.length === 0) {
    warnings.push("Current medications are not recorded in the medical passport.");
  }
  if (passport.chronicConditions.length === 0) {
    warnings.push("Chronic conditions are not recorded in the medical passport.");
  }
  if (passport.missingFields.includes("pregnancy status")) {
    warnings.push("Pregnancy status is not recorded for this patient.");
  }
  if (!passport.emergencyContactName || !passport.emergencyContactPhone) {
    warnings.push("Emergency contact details are incomplete in the medical passport.");
  }

  return {
    canPrescribe: true,
    blockers: [],
    warnings,
    missingFields: passport.missingFields,
  };
}
