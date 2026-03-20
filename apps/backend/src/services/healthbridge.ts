/**
 * healthbridge.ts — Medical Aid Billing via Healthbridge (FHIR R4)
 *
 * Submits claims to South African medical aids using the Healthbridge
 * clearinghouse FHIR R4 API.
 *
 * Required env vars:
 *   HEALTHBRIDGE_URL          — e.g. https://api.healthbridge.co.za/fhir/r4
 *   HEALTHBRIDGE_CLIENT_ID    — OAuth2 client credentials
 *   HEALTHBRIDGE_CLIENT_SECRET
 *   HPCSA_PRACTICE_NUMBER     — Practice number for billing
 *
 * BHF Tariff codes used:
 *   0190 — Telemedicine consultation (HPCSA-approved)
 *   0191 — Nurse home visit
 *   0192 — After-hours home visit
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HB_BASE_URL        = (process.env.HEALTHBRIDGE_URL ?? '').replace(/\/$/, '');
const HB_CLIENT_ID       = process.env.HEALTHBRIDGE_CLIENT_ID ?? '';
const HB_CLIENT_SECRET   = process.env.HEALTHBRIDGE_CLIENT_SECRET ?? '';
const PRACTICE_NUMBER    = process.env.HPCSA_PRACTICE_NUMBER ?? '';

// BHF tariff codes
const TARIFF_CODES = {
  TELE_CONSULT:       { code: '0190', description: 'Telemedicine consultation' },
  NURSE_HOME_VISIT:   { code: '0191', description: 'Nurse home visit'         },
  AFTER_HOURS_VISIT:  { code: '0192', description: 'After-hours home visit'   },
} as const;

export type TariffCode = keyof typeof TARIFF_CODES;

export interface ClaimInput {
  visitId:          string;
  patientId:        string;
  practitionerId:   string;
  tariffCode:       TariffCode;
  amountCents:      number;
  visitDate:        Date;
  diagnosisCodes?:  string[];        // ICD-10 codes
  memberNumber?:    string;
  schemeCode?:      string;
}

export interface ClaimResult {
  success:      boolean;
  claimId?:     string;
  status?:      string;
  error?:       string;
  rawResponse?: unknown;
}

// ---------------------------------------------------------------------------
// OAuth2 token cache
// ---------------------------------------------------------------------------
let _accessToken: string | null = null;
let _tokenExpiry = 0;

async function getAccessToken(): Promise<string> {
  if (_accessToken && Date.now() < _tokenExpiry) return _accessToken;

  if (!HB_CLIENT_ID || !HB_CLIENT_SECRET) {
    throw new Error('HEALTHBRIDGE_CLIENT_ID / CLIENT_SECRET not configured');
  }

  const res = await fetch(`${HB_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     HB_CLIENT_ID,
      client_secret: HB_CLIENT_SECRET,
      scope:         'claims.submit',
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`Healthbridge auth failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  _accessToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // 60s buffer
  return _accessToken;
}

// ---------------------------------------------------------------------------
// Build FHIR R4 Claim resource
// ---------------------------------------------------------------------------
function buildFhirClaim(input: ClaimInput): Record<string, unknown> {
  const tariff = TARIFF_CODES[input.tariffCode];

  return {
    resourceType: 'Claim',
    status:       'active',
    type: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'professional' }],
    },
    use:    'claim',
    patient: { identifier: { value: input.patientId } },
    created: input.visitDate.toISOString().slice(0, 10),
    provider: {
      identifier: { system: 'https://www.hpcsa.co.za/practice', value: PRACTICE_NUMBER },
    },
    priority: { coding: [{ code: 'normal' }] },
    insurance: [
      {
        sequence: 1,
        focal:    true,
        coverage: {
          identifier: {
            system: 'https://www.medicalschemes.co.za',
            value:  input.memberNumber ?? 'SELF_PAY',
          },
        },
      },
    ],
    item: [
      {
        sequence:         1,
        productOrService: {
          coding: [
            {
              system:  'https://www.bhf.co.za/tariff',
              code:    tariff.code,
              display: tariff.description,
            },
          ],
        },
        servicedDate: input.visitDate.toISOString().slice(0, 10),
        unitPrice: {
          value:    input.amountCents / 100,
          currency: 'ZAR',
        },
        net: {
          value:    input.amountCents / 100,
          currency: 'ZAR',
        },
      },
    ],
    diagnosis: (input.diagnosisCodes ?? []).map((code, i) => ({
      sequence:         i + 1,
      diagnosisCodeableConcept: {
        coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code }],
      },
    })),
    total: {
      value:    input.amountCents / 100,
      currency: 'ZAR',
    },
    // SA-specific extensions
    extension: [
      {
        url:         'https://www.ahavahealthcare.co.za/fhir/ext/visit-id',
        valueString: input.visitId,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Submit claim to Healthbridge
// ---------------------------------------------------------------------------
export async function submitClaim(input: ClaimInput): Promise<ClaimResult> {
  if (!HB_BASE_URL) {
    console.warn('[healthbridge] HEALTHBRIDGE_URL not set — skipping claim submission');
    return { success: false, error: 'Healthbridge not configured' };
  }

  try {
    const token     = await getAccessToken();
    const fhirClaim = buildFhirClaim(input);

    const res = await fetch(`${HB_BASE_URL}/Claim`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/fhir+json',
        'Authorization': `Bearer ${token}`,
        'X-Practice-Number': PRACTICE_NUMBER,
      },
      body:   JSON.stringify(fhirClaim),
      signal: AbortSignal.timeout(15000),
    });

    const responseBody = await res.json();

    if (!res.ok) {
      console.error('[healthbridge] Claim submission failed:', res.status, responseBody);
      return { success: false, error: `HTTP ${res.status}`, rawResponse: responseBody };
    }

    const claimId = (responseBody as any)?.id as string | undefined;
    const status  = (responseBody as any)?.outcome ?? 'complete';

    console.log(`[healthbridge] Claim submitted: ${claimId} (${status})`);

    // Record claim against the visit payment
    await prisma.payment.updateMany({
      where: { visitId: input.visitId },
      data:  { paystackData: { claimId, status, submittedAt: new Date().toISOString() } },
    });

    return { success: true, claimId, status, rawResponse: responseBody };
  } catch (err) {
    const message = (err as Error).message;
    console.error('[healthbridge] Claim submission error:', message);
    return { success: false, error: message };
  }
}

/**
 * Convenience: submit a claim directly from a completed visit.
 * Resolves tariff code based on visit time (after-hours = after 18:00 or weekends).
 */
export async function submitVisitClaim(visitId: string): Promise<ClaimResult> {
  const visit = await prisma.visit.findUnique({
    where:   { id: visitId },
    include: {
      booking:  { include: { patient: { select: { id: true } } } },
      payments: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!visit) return { success: false, error: 'Visit not found' };
  if (!visit.payments.length) return { success: false, error: 'No payment record found' };

  const payment = visit.payments[0];
  const visitDate = visit.actualStart ?? visit.scheduledStart;
  const hour      = visitDate.getHours();
  const isWeekend = visitDate.getDay() === 0 || visitDate.getDay() === 6;
  const isAfterHours = hour < 7 || hour >= 18 || isWeekend;

  const tariffCode: TariffCode = isAfterHours ? 'AFTER_HOURS_VISIT' : 'NURSE_HOME_VISIT';

  const booking = visit.booking as any;

  return submitClaim({
    visitId,
    patientId:    booking.patientId,
    practitionerId: visit.nurseId,
    tariffCode,
    amountCents:  payment.amountInCents,
    visitDate,
    memberNumber: booking.insuranceMemberNumber ?? undefined,
    schemeCode:   booking.insuranceProvider ?? undefined,
  });
}
