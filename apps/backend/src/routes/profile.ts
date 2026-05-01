import { Router } from 'express';
import Joi from 'joi';
import prisma from '../lib/prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { decryptData, encryptData, isEncryptedPayload } from '../utils/encryption';

const router: Router = Router();

type PassportPayload = {
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  bloodType?: string | null;
  allergies?: string[] | null;
  chronicConditions?: string[] | null;
  currentMedications?: string[] | null;
  surgeries?: string[] | null;
  familyHistory?: string[] | null;
  socialDeterminants?: {
    foodInsecurity?: string | null;
    transportAccess?: string | null;
    housingStability?: string | null;
    employmentStatus?: string | null;
  } | null;
  consentToShareRecords?: boolean | null;
};

const profileUpsertSchema = Joi.object({
  full_name: Joi.string().trim().max(160).optional(),
  role: Joi.string().valid('PATIENT', 'NURSE', 'DOCTOR', 'ADMIN').optional(),
  sanc_id: Joi.string().trim().allow('', null).optional(),
  phone_number: Joi.string().trim().allow('', null).optional(),
  address: Joi.string().trim().allow('', null).optional(),
  latitude: Joi.number().min(-90).max(90).allow(null).optional(),
  longitude: Joi.number().min(-180).max(180).allow(null).optional(),
  has_accepted_terms: Joi.boolean().optional(),
  terms_accepted_at: Joi.string().isoDate().allow('', null).optional(),
  medical_passport: Joi.object({
    emergencyContactName: Joi.string().trim().allow('', null).optional(),
    emergencyContactPhone: Joi.string().trim().allow('', null).optional(),
    bloodType: Joi.string().trim().allow('', null).optional(),
    allergies: Joi.array().items(Joi.string().trim().max(120)).optional(),
    chronicConditions: Joi.array().items(Joi.string().trim().max(120)).optional(),
    currentMedications: Joi.array().items(Joi.string().trim().max(120)).optional(),
    surgeries: Joi.array().items(Joi.string().trim().max(160)).optional(),
    familyHistory: Joi.array().items(Joi.string().trim().max(120)).optional(),
    socialDeterminants: Joi.object({
      foodInsecurity: Joi.string().trim().allow('', null).optional(),
      transportAccess: Joi.string().trim().allow('', null).optional(),
      housingStability: Joi.string().trim().allow('', null).optional(),
      employmentStatus: Joi.string().trim().allow('', null).optional(),
    }).optional(),
    consentToShareRecords: Joi.boolean().optional(),
  }).optional(),
}).unknown(false);

function safeDecryptAddress(value?: string | null): string | null {
  if (!value) return null;
  try {
    if (!isEncryptedPayload(value)) return value;
    return decryptData(value);
  } catch {
    return null;
  }
}

function sanitizeList(input?: string[] | null): string[] | null {
  if (!input || input.length === 0) return null;
  const cleaned = input.map((s) => s.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : null;
}

function buildPassportProgress(user: {
  firstName: string;
  lastName: string;
  phone: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  encryptedAddress: string | null;
  riskProfile: unknown;
}) {
  const address = safeDecryptAddress(user.encryptedAddress);
  const rp = (user.riskProfile as Record<string, unknown> | null) ?? {};
  const passport = (rp.medicalPassport as PassportPayload | undefined) ?? {};
  const hasTerms = Boolean(rp.hasAcceptedTerms);

  const checks: Array<{ key: string; done: boolean; prompt: string }> = [
    { key: 'full_name', done: Boolean(user.firstName && user.lastName), prompt: 'What is your full name?' },
    { key: 'phone_number', done: Boolean(user.phone), prompt: 'What is your best contact number?' },
    { key: 'terms', done: hasTerms, prompt: 'Please accept the terms to keep your medical record active.' },
    { key: 'date_of_birth', done: Boolean(user.dateOfBirth), prompt: 'What is your date of birth?' },
    { key: 'gender', done: Boolean(user.gender), prompt: 'What gender should we record for clinical care?' },
    { key: 'address', done: Boolean(address), prompt: 'What is your current home address?' },
    { key: 'emergency_contact', done: Boolean(passport.emergencyContactName && passport.emergencyContactPhone), prompt: 'Who should we contact in an emergency?' },
    { key: 'allergies', done: Array.isArray(passport.allergies), prompt: 'Do you have any allergies?' },
    { key: 'chronic_conditions', done: Array.isArray(passport.chronicConditions), prompt: 'Any chronic conditions we should record?' },
    { key: 'medications', done: Array.isArray(passport.currentMedications), prompt: 'Are you currently taking any medication?' },
    { key: 'social_determinants', done: Boolean(passport.socialDeterminants), prompt: 'Any challenges with food, transport, or housing affecting your care?' },
  ];

  const completed = checks.filter((c) => c.done).length;
  const total = checks.length;
  const completionPercent = Math.round((completed / total) * 100);
  const missing = checks.filter((c) => !c.done);

  return {
    completionPercent,
    missingKeys: missing.map((m) => m.key),
    nextQuestion: missing[0]?.prompt ?? null,
    shouldRemind: missing.length > 0,
  };
}

router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        phone: true,
        sancId: true,
        encryptedAddress: true,
        lastKnownLat: true,
        lastKnownLng: true,
        dateOfBirth: true,
        gender: true,
        riskProfile: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const address = safeDecryptAddress(user.encryptedAddress);
    const rp = (user.riskProfile as Record<string, unknown> | null) ?? {};
    const progress = buildPassportProgress(user);

    return res.json({
      profile: {
        id: user.id,
        full_name: `${user.firstName} ${user.lastName}`.trim(),
        role: user.role,
        sanc_id: user.sancId,
        phone_number: user.phone,
        address,
        latitude: user.lastKnownLat,
        longitude: user.lastKnownLng,
        has_accepted_terms: Boolean(rp.hasAcceptedTerms),
        terms_accepted_at: rp.termsAcceptedAt ?? null,
        medical_passport: rp.medicalPassport ?? {},
        passport_completion_percent: progress.completionPercent,
        passport_missing_keys: progress.missingKeys,
        next_profile_question: progress.nextQuestion,
        should_remind_profile_completion: progress.shouldRemind,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error, value } = profileUpsertSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const userId = req.user!.id;
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        sancId: true,
        riskProfile: true,
      },
    });
    if (!current) return res.status(404).json({ error: 'User not found' });

    const updateData: Record<string, unknown> = {};

    if (value.full_name) {
      const parts = value.full_name.trim().split(/\s+/);
      const firstName = parts[0] ?? current.firstName;
      const lastName = parts.slice(1).join(' ') || current.lastName || parts[0];
      updateData.firstName = firstName;
      updateData.lastName = lastName;
    }
    if (value.phone_number !== undefined) updateData.phone = value.phone_number || null;
    if (value.role && value.role !== current.role) updateData.role = value.role;
    if (value.sanc_id !== undefined) updateData.sancId = value.sanc_id || null;
    if (value.latitude !== undefined) updateData.lastKnownLat = value.latitude;
    if (value.longitude !== undefined) updateData.lastKnownLng = value.longitude;

    if (value.address !== undefined) {
      const plainAddress = (value.address || '').trim();
      if (!plainAddress) {
        updateData.encryptedAddress = null;
      } else {
        updateData.encryptedAddress = isEncryptedPayload(plainAddress) ? plainAddress : encryptData(plainAddress);
      }
    }

    const existingRisk = (current.riskProfile as Record<string, unknown> | null) ?? {};
    const existingPassport = (existingRisk.medicalPassport as PassportPayload | undefined) ?? {};
    const incomingPassport = (value.medical_passport ?? {}) as PassportPayload;

    const mergedPassport: PassportPayload = {
      ...existingPassport,
      ...incomingPassport,
      allergies: sanitizeList(incomingPassport.allergies ?? existingPassport.allergies ?? null),
      chronicConditions: sanitizeList(incomingPassport.chronicConditions ?? existingPassport.chronicConditions ?? null),
      currentMedications: sanitizeList(incomingPassport.currentMedications ?? existingPassport.currentMedications ?? null),
      surgeries: sanitizeList(incomingPassport.surgeries ?? existingPassport.surgeries ?? null),
      familyHistory: sanitizeList(incomingPassport.familyHistory ?? existingPassport.familyHistory ?? null),
    };

    const mergedRiskProfile: Record<string, unknown> = {
      ...existingRisk,
      medicalPassport: mergedPassport,
    };

    if (value.has_accepted_terms !== undefined) {
      mergedRiskProfile.hasAcceptedTerms = value.has_accepted_terms;
      if (value.has_accepted_terms) {
        mergedRiskProfile.termsAcceptedAt = value.terms_accepted_at || new Date().toISOString();
      }
    }

    updateData.riskProfile = mergedRiskProfile;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        phone: true,
        sancId: true,
        encryptedAddress: true,
        lastKnownLat: true,
        lastKnownLng: true,
        dateOfBirth: true,
        gender: true,
        riskProfile: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const progress = buildPassportProgress(updated);
    return res.json({
      success: true,
      profile: {
        id: updated.id,
        full_name: `${updated.firstName} ${updated.lastName}`.trim(),
        role: updated.role,
        sanc_id: updated.sancId,
        phone_number: updated.phone,
        address: safeDecryptAddress(updated.encryptedAddress),
        latitude: updated.lastKnownLat,
        longitude: updated.lastKnownLng,
        medical_passport: ((updated.riskProfile as Record<string, unknown> | null) ?? {}).medicalPassport ?? {},
        passport_completion_percent: progress.completionPercent,
        passport_missing_keys: progress.missingKeys,
        next_profile_question: progress.nextQuestion,
        should_remind_profile_completion: progress.shouldRemind,
        created_at: updated.createdAt,
        updated_at: updated.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
