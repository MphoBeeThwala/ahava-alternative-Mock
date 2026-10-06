import { bmiOf, buildSnapshotFields, liveFields, type ReadingLike } from './researchFeatures';

const reading = (over: Partial<ReadingLike> = {}): ReadingLike => ({
  id: 'r1',
  createdAt: new Date('2026-10-06T15:30:00Z'),
  heartRateResting: 64,
  hrvRmssd: 42,
  oxygenSaturation: 97,
  respiratoryRate: 15,
  stepCount: 8000,
  sleepDurationHours: 7.5,
  ecgRhythm: 'regular',
  temperatureTrend: 'normal',
  source: 'wearable',
  ...over,
});
const subject = { dateOfBirth: '1980-03-01', gender: 'female', riskProfile: { smoker: false, hypertension: true } };

describe('buildSnapshotFields', () => {
  it('generalises: day-level date, age band, no identifiers', () => {
    const f = buildSnapshotFields(reading(), subject)!;
    expect(f.observedDay.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(f.ageBand).toBe('45-49');
    expect(f.sex).toBe('female');
    const keys = Object.keys(f);
    for (const forbidden of ['id', 'userId', 'subjectKey', 'dateOfBirth', 'email', 'createdAt', 'weight', 'height']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('turns implausible values into null instead of clamping or defaulting', () => {
    const f = buildSnapshotFields(reading({ heartRateResting: 400, oxygenSaturation: 12, hrvRmssd: -5 }), subject)!;
    expect(f.hrResting).toBeNull();
    expect(f.spo2).toBeNull();
    expect(f.hrvRmssd).toBeNull();
  });

  it('keeps unmeasured values null: it never substitutes the dashboard defaults (72 bpm, 98%)', () => {
    const f = buildSnapshotFields(reading({ heartRateResting: null, oxygenSaturation: undefined }), subject)!;
    expect(f.hrResting).toBeNull();
    expect(f.spo2).toBeNull();
  });

  it('treats an unknown risk factor as unknown, not as "no"', () => {
    const f = buildSnapshotFields(reading(), { ...subject, riskProfile: { hypertension: true } })!;
    expect(f.smoker).toBeNull();
    expect(f.diabetes).toBeNull();
    expect(f.hypertensionKnown).toBe(true);
    expect(buildSnapshotFields(reading(), { ...subject, riskProfile: null })!.smoker).toBeNull();
    // A string "true" from a sloppy client is not a boolean answer.
    expect(buildSnapshotFields(reading(), { ...subject, riskProfile: { smoker: 'true' } })!.smoker).toBeNull();
  });

  it('refuses minors and subjects with no usable date of birth', () => {
    expect(buildSnapshotFields(reading(), { ...subject, dateOfBirth: '2015-01-01' })).toBeNull();
    expect(buildSnapshotFields(reading(), { ...subject, dateOfBirth: null })).toBeNull();
  });

  it('maps ECG and source conservatively', () => {
    expect(buildSnapshotFields(reading({ ecgRhythm: 'irregular' }), subject)!.ecgIrregular).toBe(true);
    expect(buildSnapshotFields(reading({ ecgRhythm: 'unknown' }), subject)!.ecgIrregular).toBeNull();
    expect(buildSnapshotFields(reading({ source: 'something' }), subject)!.source).toBe('manual');
  });
});

describe('bmiOf', () => {
  it('computes to one decimal and rejects implausible inputs', () => {
    expect(bmiOf(80, 180)).toBe(24.7);
    expect(bmiOf(80, null)).toBeNull();
    expect(bmiOf(5, 180)).toBeNull();
    expect(bmiOf(80, 20)).toBeNull();
  });
});

describe('liveFields', () => {
  it('is empty when there is no live output, so a sweep cannot erase stored values', () => {
    expect(liveFields(undefined)).toEqual({});
  });
  it('accepts only known alert levels', () => {
    expect(liveFields({ alertLevel: 'RED' }).liveAlertLevel).toBe('RED');
    expect(liveFields({ alertLevel: 'PURPLE' }).liveAlertLevel).toBeNull();
  });
});
