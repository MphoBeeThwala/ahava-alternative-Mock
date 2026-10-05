/**
 * Sign in with Google, for patients (docs/ENGINEERING_PLAN.md §43).
 *
 * The browser (or a native Google sign-in plugin) obtains a Google ID token
 * and POSTs it to /auth/google. This module checks it with Google's own
 * library: signature against Google's current public keys, expiry, issuer,
 * and that the token was minted for OUR client id. Nothing here talks to
 * Google with a secret, so only GOOGLE_CLIENT_ID is needed.
 *
 * GOOGLE_CLIENT_ID may list several client ids separated by commas (web,
 * Android, iOS); the first is the web one the sign-in page uses. With it
 * unset, the whole feature is off: the endpoints answer 404 and the sign-in
 * page doesn't show the button.
 */
import { OAuth2Client } from 'google-auth-library';

export const GOOGLE_PROVIDER = 'GOOGLE';

export function googleClientIds(): string[] {
  return (process.env.GOOGLE_CLIENT_ID ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export const isGoogleSignInEnabled = (): boolean => googleClientIds().length > 0;
export const googleWebClientId = (): string | null => googleClientIds()[0] ?? null;

export interface GoogleProfile {
  /** Google's stable, never-reused account id. The only thing we match identities on. */
  subject: string;
  email: string;
  emailVerified: boolean;
  givenName?: string;
  familyName?: string;
  fullName?: string;
  /** The nonce the page asked Google to embed; checked against the browser's cookie. */
  nonce?: string;
}

export class GoogleTokenError extends Error {}

let client: OAuth2Client | null = null;

/** Throws GoogleTokenError for anything that isn't a valid, current token for this app. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!isGoogleSignInEnabled()) throw new GoogleTokenError('Google sign-in is not configured');
  client ??= new OAuth2Client();
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: googleClientIds() });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new GoogleTokenError('Token has no subject or email');
    return {
      subject: p.sub,
      email: p.email.trim().toLowerCase(),
      emailVerified: p.email_verified === true,
      givenName: p.given_name,
      familyName: p.family_name,
      fullName: p.name,
      nonce: typeof p.nonce === 'string' ? p.nonce : undefined,
    };
  } catch (err) {
    if (err instanceof GoogleTokenError) throw err;
    throw new GoogleTokenError('Invalid Google token');
  }
}

/** First/last name for a new account, from whatever Google provided. */
export function namesFrom(profile: GoogleProfile): { firstName: string; lastName: string } {
  const [first, ...rest] = (profile.fullName ?? '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: (profile.givenName || first || 'Patient').slice(0, 80),
    lastName: (profile.familyName || rest.join(' ') || '-').slice(0, 80),
  };
}
