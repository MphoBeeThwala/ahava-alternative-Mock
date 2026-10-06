/**
 * Pseudonymisation and generalisation for the research data pipeline
 * (docs/RESEARCH_DATA_PIPELINE.md).
 *
 * subjectKey = HMAC-SHA256(RESEARCH_PSEUDONYM_KEY, "subject:" + userId).
 * The backend can recompute it (so a consent withdrawal can delete that
 * person's rows); someone holding only the research tables cannot reverse it
 * or link it to an account. With no key configured NOTHING is captured: there
 * is deliberately no fallback key, because a guessable pseudonym is just an
 * identifier with extra steps.
 *
 * Pure functions only: no database, no network. Unit-tested in isolation.
 */
import { createHmac } from 'crypto';

export const RESEARCH_CONSENT_TYPE = 'RESEARCH_DATA' as const;
/** Bump when the consent wording changes; capture only runs on this version. */
export const RESEARCH_CONSENT_VERSION = '1.0';
/** Bump when snapshot columns change meaning (the Python side keys on it). */
export const RESEARCH_SCHEMA_VERSION = 1;

const MIN_KEY_LENGTH = 32;

export function getPseudonymKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = (env.RESEARCH_PSEUDONYM_KEY ?? '').trim();
  return key.length >= MIN_KEY_LENGTH ? key : null;
}

/** Capture is on only when not switched off AND a proper key is configured. */
export function researchCaptureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.RESEARCH_CAPTURE_ENABLED ?? 'true').trim().toLowerCase() === 'false') return false;
  return getPseudonymKey(env) !== null;
}

function hmac(domain: string, value: string, key: string): string {
  return createHmac('sha256', key).update(`${domain}:${value}`).digest('hex');
}

export function subjectKeyFor(userId: string, key = getPseudonymKey()): string | null {
  return key ? hmac('subject', userId, key) : null;
}

/** Dedupe reference for a source record. Domain-separated from subject keys. */
export function sourceRefFor(kind: string, id: string, key = getPseudonymKey()): string | null {
  return key ? hmac(`ref:${kind}`, id, key) : null;
}

/** 5-year band, "18-24" for the youngest, "85+" at the top. Null when under 18 or unknown. */
export function ageBandOf(dateOfBirth: Date | string | null | undefined, now = new Date()): string | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  if (age < 18 || age > 120) return null; // adults only; implausible DOBs are not data
  if (age < 25) return '18-24';
  if (age >= 85) return '85+';
  const lo = Math.floor(age / 5) * 5;
  return `${lo}-${lo + 4}`;
}

/** Midnight UTC of the given instant: the only time resolution we keep. */
export function toDay(value: Date | string): Date {
  const d = new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function normaliseSex(gender: string | null | undefined): 'male' | 'female' | null {
  const g = (gender ?? '').trim().toLowerCase();
  if (g === 'male' || g === 'm') return 'male';
  if (g === 'female' || g === 'f') return 'female';
  return null; // other / unknown stays unknown rather than being forced into a binary
}
