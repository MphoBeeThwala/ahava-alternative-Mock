/**
 * Transparent at-rest encryption for written clinical content.
 *
 * Policy (docs/ENGINEERING_PLAN.md §38): free-text notes, diagnoses,
 * prescriptions, referrals and messages are encrypted in the database
 * with AES-256-GCM (utils/encryption.ts, key rotation supported) and
 * decrypted only when an authorised request reads them through the API.
 * Vitals and other numeric readings are deliberately NOT field-encrypted:
 * the early-warning engine, monitoring worklist and validation report
 * query and aggregate them in SQL, which encrypted values would break.
 * They rely on database/volume encryption at rest plus the access
 * controls in services/careAccess.ts.
 *
 * Applied as a Prisma client extension so no route can forget it:
 *  - writes: listed fields are encrypted before they reach the database;
 *  - reads: every result (including nested `include`s) is walked and any
 *    value encrypted under this policy's AAD is decrypted in place.
 * Values encrypted under a different AAD (addresses, TOTP secrets, the
 * dispatch location) fail authentication here and are left untouched for
 * their own code paths to handle. Legacy plaintext rows read back as-is
 * until scripts/encryptClinicalNotes.ts backfills them.
 */
import { Prisma } from '@prisma/client';
import { decryptData, encryptData, isEncryptedPayload } from '../utils/encryption';

const CLINICAL_TEXT_AAD = 'phi:clinical-text';
const JSON_MARKER = '__enc';

export const ENCRYPTED_CLINICAL_FIELDS: Record<string, { text?: string[]; json?: string[] }> = {
  TriageCase: {
    text: [
      'symptoms', 'aiReasoning', 'doctorNotes', 'doctorDiagnosis', 'doctorRecommendations',
      'finalDiagnosis', 'overrideReason', 'followUpRequestMessage', 'patientFollowUpResponse',
    ],
    json: ['aiPossibleConditions', 'aiStructuredPlan', 'followUpQuestions', 'requestedInvestigations'],
  },
  Visit: { text: ['nurseReport', 'doctorReview'], json: ['treatment'] },
  Prescription: { text: ['diagnosis', 'doctorNotes'], json: ['medications'] },
  Referral: { text: ['provisionalDiagnosis', 'clinicalNotes'] },
  Message: { text: ['content'] },
};

export function encryptClinicalText(value: string): string {
  return isEncryptedPayload(value) ? value : encryptData(value, CLINICAL_TEXT_AAD);
}

function isEncryptedJson(value: unknown): value is { [JSON_MARKER]: string } {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && typeof (value as any)[JSON_MARKER] === 'string';
}

export function encryptClinicalJson(value: unknown): unknown {
  if (value === null || value === undefined || value === Prisma.DbNull || value === Prisma.JsonNull) return value;
  if (isEncryptedJson(value)) return value;
  return { [JSON_MARKER]: encryptData(JSON.stringify(value), CLINICAL_TEXT_AAD) };
}

/** Encrypt the policy's fields in one `data` object (handles `{ set: x }`). */
function encryptDataObject(model: string, data: any): any {
  const spec = ENCRYPTED_CLINICAL_FIELDS[model];
  if (!spec || !data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const field of spec.text ?? []) {
    const v = out[field];
    if (typeof v === 'string') out[field] = encryptClinicalText(v);
    else if (v && typeof v === 'object' && typeof v.set === 'string') out[field] = { ...v, set: encryptClinicalText(v.set) };
  }
  for (const field of spec.json ?? []) {
    if (field in out && out[field] !== undefined) out[field] = encryptClinicalJson(out[field]);
  }
  return out;
}

function encryptArgs(model: string, operation: string, args: any): any {
  if (!args || !ENCRYPTED_CLINICAL_FIELDS[model]) return args;
  const next = { ...args };
  if (operation === 'upsert') {
    next.create = encryptDataObject(model, args.create);
    next.update = encryptDataObject(model, args.update);
  } else if ('data' in args) {
    next.data = Array.isArray(args.data)
      ? args.data.map((d: any) => encryptDataObject(model, d))
      : encryptDataObject(model, args.data);
  }
  return next;
}

function tryDecryptText(value: string): string {
  if (!value.startsWith('v3:') || !isEncryptedPayload(value)) return value;
  try {
    return decryptData(value, CLINICAL_TEXT_AAD);
  } catch {
    return value; // different AAD (address, TOTP, location) — not ours
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Decrypt, in place, every value encrypted under this policy. */
export function decryptClinicalValues(value: any): any {
  if (typeof value === 'string') return tryDecryptText(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = decryptClinicalValues(value[i]);
    return value;
  }
  if (isEncryptedJson(value)) {
    try {
      return JSON.parse(decryptData(value[JSON_MARKER], CLINICAL_TEXT_AAD));
    } catch {
      return value;
    }
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) value[key] = decryptClinicalValues(value[key]);
  }
  return value;
}

const WRITE_OPERATIONS = new Set([
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert',
]);

export const clinicalFieldEncryption = Prisma.defineExtension({
  name: 'clinical-field-encryption',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const finalArgs = WRITE_OPERATIONS.has(operation) ? encryptArgs(model, operation, args) : args;
        const result = await query(finalArgs);
        return decryptClinicalValues(result);
      },
    },
  },
});
