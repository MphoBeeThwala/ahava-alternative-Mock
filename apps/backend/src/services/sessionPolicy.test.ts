import { accessTokenSecondsFor, isStaffRole, refreshRefusal } from './sessionPolicy';

const NOW = 1_800_000_000;
const min = (n: number) => n * 60;
const hour = (n: number) => n * 3600;

describe('sessionPolicy', () => {
  it('treats nurses, doctors and admins as staff, but not patients', () => {
    expect(['NURSE', 'DOCTOR', 'ADMIN'].every(isStaffRole)).toBe(true);
    expect(isStaffRole('PATIENT')).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });

  it('shortens staff access tokens but leaves patients alone', () => {
    expect(accessTokenSecondsFor('DOCTOR', 900)).toBe(300);
    expect(accessTokenSecondsFor('PATIENT', 900)).toBe(900);
    // never lengthens a deliberately shorter configured default
    expect(accessTokenSecondsFor('ADMIN', 120)).toBe(120);
  });

  it('refuses a staff refresh after the idle window', () => {
    expect(refreshRefusal('NURSE', NOW - min(10), NOW - min(10), NOW)).toBeNull();
    expect(refreshRefusal('NURSE', NOW - min(16), NOW - min(16), NOW)).toBe('SESSION_IDLE_TIMEOUT');
  });

  it('refuses a staff refresh past the absolute lifetime even if recently active', () => {
    expect(refreshRefusal('ADMIN', NOW - min(5), NOW - hour(11), NOW)).toBeNull();
    expect(refreshRefusal('ADMIN', NOW - min(5), NOW - hour(13), NOW)).toBe('SESSION_MAX_AGE');
  });

  it('falls back to the issue time when an old token has no authTime', () => {
    expect(refreshRefusal('DOCTOR', NOW - min(5), undefined, NOW)).toBeNull();
  });

  it('never refuses a patient', () => {
    expect(refreshRefusal('PATIENT', NOW - hour(100), NOW - hour(200), NOW)).toBeNull();
  });
});
