import { GoogleTokenError, googleClientIds, googleWebClientId, isGoogleSignInEnabled, namesFrom, verifyGoogleIdToken } from './googleIdentity';

const original = process.env.GOOGLE_CLIENT_ID;
afterEach(() => { if (original === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = original; });

describe('googleIdentity', () => {
  it('is off without a client id and on with one', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(isGoogleSignInEnabled()).toBe(false);
    expect(googleWebClientId()).toBeNull();
    process.env.GOOGLE_CLIENT_ID = ' web.id , android.id ';
    expect(googleClientIds()).toEqual(['web.id', 'android.id']);
    expect(googleWebClientId()).toBe('web.id');
  });

  it('refuses to verify anything when not configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    await expect(verifyGoogleIdToken('x')).rejects.toBeInstanceOf(GoogleTokenError);
  });

  it('rejects a malformed token as a GoogleTokenError', async () => {
    process.env.GOOGLE_CLIENT_ID = 'web.id';
    await expect(verifyGoogleIdToken('not-a-jwt')).rejects.toBeInstanceOf(GoogleTokenError);
  });

  it('builds names from whatever Google gave', () => {
    const base = { subject: 's', email: 'a@b.test', emailVerified: true };
    expect(namesFrom({ ...base, givenName: 'Thandi', familyName: 'Mokoena' })).toEqual({ firstName: 'Thandi', lastName: 'Mokoena' });
    expect(namesFrom({ ...base, fullName: 'Thandi Nomsa Mokoena' })).toEqual({ firstName: 'Thandi', lastName: 'Nomsa Mokoena' });
    expect(namesFrom(base)).toEqual({ firstName: 'Patient', lastName: '-' });
  });
});
