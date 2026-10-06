import {
  ageBandOf,
  getPseudonymKey,
  normaliseSex,
  researchCaptureEnabled,
  sourceRefFor,
  subjectKeyFor,
  toDay,
} from './pseudonym';

const KEY = 'k'.repeat(40);

describe('pseudonym key handling', () => {
  it('has no key by default, and a short key is refused (no weak fallback)', () => {
    expect(getPseudonymKey({} as NodeJS.ProcessEnv)).toBeNull();
    expect(getPseudonymKey({ RESEARCH_PSEUDONYM_KEY: 'short' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getPseudonymKey({ RESEARCH_PSEUDONYM_KEY: KEY } as unknown as NodeJS.ProcessEnv)).toBe(KEY);
  });

  it('capture needs both the key and not being switched off', () => {
    const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
    expect(researchCaptureEnabled(env({}))).toBe(false);
    expect(researchCaptureEnabled(env({ RESEARCH_PSEUDONYM_KEY: KEY }))).toBe(true);
    expect(researchCaptureEnabled(env({ RESEARCH_PSEUDONYM_KEY: KEY, RESEARCH_CAPTURE_ENABLED: 'false' }))).toBe(false);
  });

  it('returns null rather than a pseudonym when there is no key', () => {
    expect(subjectKeyFor('user-1', null)).toBeNull();
    expect(sourceRefFor('reading', 'r1', null)).toBeNull();
  });
});

describe('subjectKeyFor / sourceRefFor', () => {
  it('is deterministic, hex, and does not contain the user id', () => {
    const a = subjectKeyFor('user-123', KEY)!;
    expect(a).toBe(subjectKeyFor('user-123', KEY));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('user-123');
  });

  it('differs by user and by key', () => {
    expect(subjectKeyFor('user-1', KEY)).not.toBe(subjectKeyFor('user-2', KEY));
    expect(subjectKeyFor('user-1', KEY)).not.toBe(subjectKeyFor('user-1', 'z'.repeat(40)));
  });

  it('is domain-separated: a source ref can never equal a subject key', () => {
    expect(sourceRefFor('reading', 'abc', KEY)).not.toBe(subjectKeyFor('abc', KEY));
    expect(sourceRefFor('reading', 'abc', KEY)).not.toBe(sourceRefFor('triage', 'abc', KEY));
  });
});

describe('ageBandOf', () => {
  const now = new Date('2026-10-06T10:00:00Z');
  it('bands in 5-year steps', () => {
    expect(ageBandOf('1986-10-07', now)).toBe('35-39'); // 39 until tomorrow
    expect(ageBandOf('1986-10-06', now)).toBe('40-44'); // 40 today
    expect(ageBandOf('1970-01-01', now)).toBe('55-59');
  });
  it('merges the youngest adults and the oldest', () => {
    expect(ageBandOf('2005-01-01', now)).toBe('18-24');
    expect(ageBandOf('1930-01-01', now)).toBe('85+');
  });
  it('excludes minors, unknown and implausible dates of birth', () => {
    expect(ageBandOf('2012-01-01', now)).toBeNull();
    expect(ageBandOf('2008-10-07', now)).toBeNull(); // 17 until tomorrow
    expect(ageBandOf(null, now)).toBeNull();
    expect(ageBandOf('not-a-date', now)).toBeNull();
    expect(ageBandOf('1800-01-01', now)).toBeNull();
  });
});

describe('toDay / normaliseSex', () => {
  it('drops the time of day', () => {
    expect(toDay('2026-10-06T23:59:59.999Z').toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });
  it('does not force unknown or other values into a binary', () => {
    expect(normaliseSex('Male')).toBe('male');
    expect(normaliseSex('F')).toBe('female');
    expect(normaliseSex('non-binary')).toBeNull();
    expect(normaliseSex(null)).toBeNull();
  });
});
