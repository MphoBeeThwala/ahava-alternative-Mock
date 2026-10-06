/**
 * Capture gating, with prisma mocked: this is gate logic, not DB behaviour.
 * What it proves: nothing is written without a key, an active consent, an
 * adult patient and a post-consent date; what is written carries a pseudonym
 * and no identity; withdrawal deletes by pseudonym.
 */
import prisma from '../../lib/prisma';
import { subjectKeyFor } from './pseudonym';
import { captureDiagnosisOutcomes, captureReadings, captureTriageOutcome, purgeSubject, reconcileConsent, recordClinicianOutcome } from './researchCapture';

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    patientConsent: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
    researchSnapshot: { upsert: jest.fn(), deleteMany: jest.fn() },
    researchOutcome: { upsert: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const db = prisma as any;
const KEY = 'k'.repeat(40);
const CONSENT_AT = new Date('2026-10-01T00:00:00Z');
const patient = { role: 'PATIENT', isActive: true, dateOfBirth: new Date('1980-03-01'), gender: 'male', riskProfile: { smoker: true } };
const reading = (over = {}) => ({
  id: 'reading-1',
  createdAt: new Date('2026-10-05T08:00:00Z'),
  heartRateResting: 66,
  hrvRmssd: 40,
  oxygenSaturation: 97,
  source: 'wearable',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.RESEARCH_PSEUDONYM_KEY = KEY;
  delete process.env.RESEARCH_CAPTURE_ENABLED;
  db.patientConsent.findFirst.mockResolvedValue({ givenAt: CONSENT_AT });
  db.user.findUnique.mockResolvedValue(patient);
  db.researchSnapshot.upsert.mockResolvedValue({});
  db.researchOutcome.upsert.mockResolvedValue({});
  db.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
  db.researchSnapshot.deleteMany.mockResolvedValue({ count: 3 });
  db.researchOutcome.deleteMany.mockResolvedValue({ count: 2 });
});
afterAll(() => {
  delete process.env.RESEARCH_PSEUDONYM_KEY;
});

describe('captureReadings gates', () => {
  it('writes nothing, and reads nothing, with no pseudonym key', async () => {
    delete process.env.RESEARCH_PSEUDONYM_KEY;
    expect(await captureReadings('u1', [reading()])).toEqual({ status: 'disabled', written: 0 });
    expect(db.patientConsent.findFirst).not.toHaveBeenCalled();
    expect(db.researchSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('writes nothing when switched off, even with a key', async () => {
    process.env.RESEARCH_CAPTURE_ENABLED = 'false';
    expect((await captureReadings('u1', [reading()])).status).toBe('disabled');
  });

  it('writes nothing without research consent', async () => {
    db.patientConsent.findFirst.mockResolvedValue(null);
    expect(await captureReadings('u1', [reading()])).toEqual({ status: 'no_consent', written: 0 });
    expect(db.researchSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('asks for the current, non-withdrawn RESEARCH_DATA consent specifically', async () => {
    await captureReadings('u1', [reading()]);
    expect(db.patientConsent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', consentType: 'RESEARCH_DATA', version: '1.0', withdrawn: false } }),
    );
  });

  it('skips staff, inactive accounts and minors', async () => {
    db.user.findUnique.mockResolvedValue({ ...patient, role: 'DOCTOR' });
    expect((await captureReadings('u1', [reading()])).status).toBe('not_eligible');
    db.user.findUnique.mockResolvedValue({ ...patient, isActive: false });
    expect((await captureReadings('u1', [reading()])).status).toBe('not_eligible');
    db.user.findUnique.mockResolvedValue({ ...patient, dateOfBirth: new Date('2015-01-01') });
    expect((await captureReadings('u1', [reading()])).status).toBe('not_eligible');
    expect(db.researchSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('is prospective only: a reading from before consent is never captured', async () => {
    const r = await captureReadings('u1', [reading({ createdAt: new Date('2026-09-30T23:59:59Z') })]);
    expect(r).toEqual({ status: 'pre_consent', written: 0 });
    expect(db.researchSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('captures only the post-consent readings from a mixed batch', async () => {
    const r = await captureReadings('u1', [
      reading({ id: 'old', createdAt: new Date('2026-09-01T00:00:00Z') }),
      reading({ id: 'new' }),
    ]);
    expect(r).toEqual({ status: 'captured', written: 1 });
  });

  it('never throws into the caller', async () => {
    db.user.findUnique.mockRejectedValue(new Error('db down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await captureReadings('u1', [reading()])).toEqual({ status: 'error', written: 0 });
    warn.mockRestore();
  });
});

describe('what a captured snapshot contains', () => {
  it('is keyed by pseudonym and carries no identity', async () => {
    await captureReadings('user-secret-id', [reading()]);
    const arg = db.researchSnapshot.upsert.mock.calls[0][0];
    const serialised = JSON.stringify(arg);
    expect(serialised).not.toContain('user-secret-id');
    expect(serialised).not.toContain('reading-1');
    expect(arg.create.subjectKey).toBe(subjectKeyFor('user-secret-id', KEY));
    expect(arg.create).toMatchObject({ ageBand: '45-49', sex: 'male', smoker: true, hrResting: 66, consentVersion: '1.0' });
    expect(arg.where.subjectKey_sourceRef.sourceRef).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a plain capture leaves stored live-engine fields alone; live output fills them in', async () => {
    await captureReadings('u1', [reading()]);
    expect(db.researchSnapshot.upsert.mock.calls[0][0].update).toEqual({});

    await captureReadings('u1', [reading()], new Map([['reading-1', { alertLevel: 'YELLOW', cvdRiskCategory: '10-20%' }]]));
    expect(db.researchSnapshot.upsert.mock.calls[1][0].update).toMatchObject({ liveAlertLevel: 'YELLOW', liveCvdCategory: '10-20%' });
  });
});

describe('outcomes', () => {
  it('triage outcomes carry levels only and are deduped per case', async () => {
    const status = await captureTriageOutcome({
      id: 'case-1', patientId: 'u1', aiTriageLevel: 4, finalTriageLevel: 2, route: 'REFERRAL', emergencyReferral: true,
    });
    expect(status).toBe('captured');
    expect(db.researchOutcome.upsert).toHaveBeenCalledTimes(2); // TRIAGE_REVIEWED + EMERGENCY_REFERRAL
    const [first, second] = db.researchOutcome.upsert.mock.calls.map((c: any) => c[0]);
    expect(first.create.outcomeType).toBe('TRIAGE_REVIEWED');
    expect(first.create.details).toEqual({ aiLevel: 4, finalLevel: 2, overridden: true, route: 'REFERRAL' });
    expect(second.create.outcomeType).toBe('EMERGENCY_REFERRAL');
    expect(first.where.subjectKey_sourceRef.sourceRef).not.toBe(second.where.subjectKey_sourceRef.sourceRef);
    expect(JSON.stringify([first, second])).not.toContain('case-1');
  });

  it('no triage outcome without consent', async () => {
    db.patientConsent.findFirst.mockResolvedValue(null);
    expect(await captureTriageOutcome({ id: 'c', patientId: 'u1', aiTriageLevel: 3, finalTriageLevel: 3, route: 'RELEASED' })).toBe('no_consent');
    expect(db.researchOutcome.upsert).not.toHaveBeenCalled();
  });

  it('a clinician outcome is validated before anything is stored', async () => {
    const bad = await recordClinicianOutcome('u1', { outcomeType: 'CVD_EVENT', outcomeDay: 'soon' }, 'DOCTOR');
    expect(bad.ok).toBe(false);
    expect(db.researchOutcome.upsert).not.toHaveBeenCalled();

    const good = await recordClinicianOutcome('u1', { outcomeType: 'HYPERTENSION_DIAGNOSED', outcomeDay: '2026-09-15', icd10: 'I10' }, 'DOCTOR');
    expect(good).toEqual({ ok: true, status: 'captured' });
    expect(db.researchOutcome.upsert.mock.calls[0][0].create).toMatchObject({
      outcomeType: 'HYPERTENSION_DIAGNOSED', icd10: 'I10', source: 'CLINICIAN_ENTRY', recordedByRole: 'DOCTOR',
    });
  });

  it('the same clinician fact entered twice maps to the same row', async () => {
    const entry = { outcomeType: 'DIABETES_DIAGNOSED', outcomeDay: '2026-09-15', icd10: 'E11.9' };
    await recordClinicianOutcome('u1', entry, 'DOCTOR');
    await recordClinicianOutcome('u1', entry, 'DOCTOR');
    const [a, b] = db.researchOutcome.upsert.mock.calls.map((c: any) => c[0].where.subjectKey_sourceRef.sourceRef);
    expect(a).toBe(b);
  });

  it('a clinician outcome for a patient who has not opted in is not stored', async () => {
    db.patientConsent.findFirst.mockResolvedValue(null);
    expect(await recordClinicianOutcome('u1', { outcomeType: 'DEATH', outcomeDay: '2026-09-15' }, 'DOCTOR')).toEqual({ ok: true, status: 'no_consent' });
    expect(db.researchOutcome.upsert).not.toHaveBeenCalled();
  });
});

describe('alert answers', () => {
  const answer = (outcomeType: string) =>
    recordClinicianOutcome('u1', { outcomeType, outcomeDay: '2026-09-15', alertLevel: 'RED' }, 'DOCTOR');

  it('a changed mind replaces the earlier answer: useful and false-alarm never both stand for one patient and day', async () => {
    await answer('ALERT_DISMISSED');
    const dismissedRef = db.researchOutcome.upsert.mock.calls[0][0].where.subjectKey_sourceRef.sourceRef;
    db.researchOutcome.deleteMany.mockClear();

    await answer('ALERT_CONFIRMED');
    const removed = db.researchOutcome.deleteMany.mock.calls[0][0].where;
    expect(removed.subjectKey).toBe(subjectKeyFor('u1', KEY));
    expect(removed.sourceRef).toBe(dismissedRef); // exactly the row the earlier answer wrote
  });

  it('does not touch other outcome types', async () => {
    await recordClinicianOutcome('u1', { outcomeType: 'DEATH', outcomeDay: '2026-09-15' }, 'DOCTOR');
    expect(db.researchOutcome.deleteMany).not.toHaveBeenCalled();
  });
});

describe('captureDiagnosisOutcomes', () => {
  const run = (icd10: string | null, route: 'PRESCRIPTION' | 'REFERRAL' = 'PRESCRIPTION') =>
    captureDiagnosisOutcomes({ caseId: 'case-9', patientId: 'u1', icd10, route });

  it('records a weak-label (REMOTE_TRIAGE) outcome for a mappable code, with the code and no identity', async () => {
    expect(await run('I10')).toBe('captured');
    const arg = db.researchOutcome.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({
      outcomeType: 'HYPERTENSION_DIAGNOSED', icd10: 'I10', source: 'TRIAGE_REVIEW', recordedByRole: 'DOCTOR',
      details: { basis: 'REMOTE_TRIAGE', route: 'PRESCRIPTION' },
    });
    expect(JSON.stringify(arg)).not.toContain('case-9');
    expect(JSON.stringify(arg)).not.toContain('u1"');
  });

  it('records nothing when there is no code or it maps to no outcome (and does not even read consent)', async () => {
    for (const code of [null, 'J06.9', 'I25.1']) await run(code);
    expect(db.researchOutcome.upsert).not.toHaveBeenCalled();
    expect(db.patientConsent.findFirst).not.toHaveBeenCalled();
  });

  it('records nothing without consent', async () => {
    db.patientConsent.findFirst.mockResolvedValue(null);
    expect(await run('E11.9', 'REFERRAL')).toBe('no_consent');
    expect(db.researchOutcome.upsert).not.toHaveBeenCalled();
  });

  it('a corrected code removes what the earlier code recorded (and a removed code removes it all)', async () => {
    await run('E11.9'); // now diabetes: hypertension, CVD and arrhythmia rows from an earlier code must go
    const deleted = db.researchOutcome.deleteMany.mock.calls[0][0].where;
    expect(deleted.subjectKey).toBe(subjectKeyFor('u1', KEY));
    expect(deleted.sourceRef.in).toHaveLength(3);

    db.researchOutcome.deleteMany.mockClear();
    await run(null);
    expect(db.researchOutcome.deleteMany.mock.calls[0][0].where.sourceRef.in).toHaveLength(4);
    expect(db.researchOutcome.upsert).toHaveBeenCalledTimes(1); // only the E11 write; nothing for the cleared code
  });

  it('the same case re-saved maps to the same row, so a corrected code replaces rather than duplicates', async () => {
    await run('I10');
    await run('I10');
    const [a, b] = db.researchOutcome.upsert.mock.calls.map((c: any) => c[0].where.subjectKey_sourceRef.sourceRef);
    expect(a).toBe(b);
  });
});

describe('withdrawal racing a capture', () => {
  it('purges what a capture just wrote if consent vanished between the check and the write', async () => {
    db.patientConsent.findFirst
      .mockResolvedValueOnce({ givenAt: CONSENT_AT }) // the gate: still consented
      .mockResolvedValueOnce(null); //                   after the write: withdrawn in between
    const r = await captureReadings('u1', [reading()]);
    expect(r).toEqual({ status: 'no_consent', written: 0 });
    expect(db.researchSnapshot.deleteMany).toHaveBeenCalledWith({ where: { subjectKey: subjectKeyFor('u1', KEY) } });
  });

  it('does the same for an outcome', async () => {
    db.patientConsent.findFirst.mockResolvedValueOnce({ givenAt: CONSENT_AT }).mockResolvedValueOnce(null);
    expect(await captureTriageOutcome({ id: 'c', patientId: 'u1', aiTriageLevel: 3, finalTriageLevel: 3, route: 'RELEASED' })).toBe('no_consent');
    expect(db.researchOutcome.deleteMany).toHaveBeenCalled();
  });

  it('leaves everything alone when consent still stands', async () => {
    expect(await reconcileConsent('u1')).toBe(true);
    expect(db.researchSnapshot.deleteMany).not.toHaveBeenCalled();
  });
});

describe('purgeSubject (consent withdrawal)', () => {
  it('deletes snapshots and outcomes by pseudonym and reports counts', async () => {
    const r = await purgeSubject('u1');
    const key = subjectKeyFor('u1', KEY);
    expect(db.researchSnapshot.deleteMany).toHaveBeenCalledWith({ where: { subjectKey: key } });
    expect(db.researchOutcome.deleteMany).toHaveBeenCalledWith({ where: { subjectKey: key } });
    expect(r).toEqual({ purged: true, snapshots: 3, outcomes: 2 });
  });

  it('says it did NOT purge when it cannot (no key, or a database error), so the caller never claims deletion', async () => {
    db.$transaction.mockRejectedValue(new Error('db down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await purgeSubject('u1')).purged).toBe(false);
    warn.mockRestore();
    delete process.env.RESEARCH_PSEUDONYM_KEY;
    expect((await purgeSubject('u1')).purged).toBe(false);
  });
});
