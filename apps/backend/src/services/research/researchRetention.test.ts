import { cutoffDay, DEFAULT_INACTIVE_MONTHS, DEFAULT_MAX_YEARS, retentionConfig } from './researchRetention';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe('retentionConfig', () => {
  it('defaults to 7 years and 24 months of inactivity', () => {
    expect(retentionConfig(env({}))).toEqual({ maxYears: 7, inactiveMonths: 24, warnings: [] });
    expect([DEFAULT_MAX_YEARS, DEFAULT_INACTIVE_MONTHS]).toEqual([7, 24]);
  });

  it('accepts sensible overrides, including the floors', () => {
    expect(retentionConfig(env({ RESEARCH_RETENTION_MAX_YEARS: '10', RESEARCH_RETENTION_INACTIVE_MONTHS: '36' }))).toMatchObject({ maxYears: 10, inactiveMonths: 36, warnings: [] });
    expect(retentionConfig(env({ RESEARCH_RETENTION_MAX_YEARS: '1', RESEARCH_RETENTION_INACTIVE_MONTHS: '6' }))).toMatchObject({ maxYears: 1, inactiveMonths: 6, warnings: [] });
  });

  it('the only way to switch a rule off is the explicit word "off"', () => {
    expect(retentionConfig(env({ RESEARCH_RETENTION_MAX_YEARS: 'OFF', RESEARCH_RETENTION_INACTIVE_MONTHS: ' off ' }))).toMatchObject({ maxYears: null, inactiveMonths: null, warnings: [] });
  });

  it.each(['0', '-1', '0.5', 'abc', '1e1', '7 years', 'null', 'false'])(
    'a typo (%j) can never mean "delete everything": the default is used and a warning is raised',
    (bad) => {
      const c = retentionConfig(env({ RESEARCH_RETENTION_MAX_YEARS: bad, RESEARCH_RETENTION_INACTIVE_MONTHS: bad }));
      expect(c.maxYears).toBe(7);
      expect(c.inactiveMonths).toBe(24);
      expect(c.warnings).toHaveLength(2);
      expect(c.warnings[0]).toContain('"off"');
    },
  );

  it('refuses values below the floor rather than honouring an aggressive setting', () => {
    const c = retentionConfig(env({ RESEARCH_RETENTION_INACTIVE_MONTHS: '5', RESEARCH_RETENTION_MAX_YEARS: '0' }));
    expect(c).toMatchObject({ maxYears: 7, inactiveMonths: 24 });
    expect(c.warnings).toHaveLength(2);
  });
});

describe('cutoffDay', () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  it('is midnight UTC the given years and months back', () => {
    expect(iso(cutoffDay(new Date('2026-10-06T15:30:00Z'), 7))).toBe('2019-10-06');
    expect(iso(cutoffDay(new Date('2026-10-06T15:30:00Z'), 0, 24))).toBe('2024-10-06');
    expect(cutoffDay(new Date('2026-10-06T15:30:00Z'), 1).getUTCHours()).toBe(0);
  });
  it('clamps to the target month instead of spilling into the next', () => {
    expect(iso(cutoffDay(new Date('2026-03-31T00:00:00Z'), 0, 1))).toBe('2026-02-28');
    expect(iso(cutoffDay(new Date('2028-02-29T00:00:00Z'), 1))).toBe('2027-02-28');
    expect(iso(cutoffDay(new Date('2026-01-15T00:00:00Z'), 0, 2))).toBe('2025-11-15'); // crosses a year boundary
  });
});
