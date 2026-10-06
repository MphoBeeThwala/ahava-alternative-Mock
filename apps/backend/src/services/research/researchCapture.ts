/**
 * Consent-gated capture into the research tables (docs/RESEARCH_DATA_PIPELINE.md).
 *
 * Every entry point is best-effort and swallows its own errors: research
 * capture must never delay, fail or alter a clinical request. Logs carry
 * counts and error messages only, never ids or values.
 *
 * Gates, in order, for every write:
 *   1. capture enabled and a pseudonym key configured
 *   2. the subject is an active adult PATIENT
 *   3. a non-withdrawn RESEARCH_DATA consent at the current version exists
 *   4. the record is dated on/after that consent was given (prospective only:
 *      nothing recorded before someone agreed is ever pulled in)
 */
import prisma from '../../lib/prisma';
import {
  RESEARCH_CONSENT_TYPE,
  RESEARCH_CONSENT_VERSION,
  getPseudonymKey,
  researchCaptureEnabled,
  sourceRefFor,
  subjectKeyFor,
  toDay,
} from './pseudonym';
import {
  buildSnapshotFields,
  liveFields,
  type LiveEngineOutput,
  type ReadingLike,
  type SubjectLike,
} from './researchFeatures';
import { outcomeTypesForIcd10, triageDetails, validateClinicianOutcome, type ClinicianOutcomeInput, type OutcomeType, type TriageRoute } from './researchOutcomes';

export type CaptureStatus =
  | 'captured'
  | 'disabled'
  | 'no_consent'
  | 'not_eligible'
  | 'pre_consent'
  | 'error';

const warn = (what: string, err: unknown) =>
  console.warn(`[research] ${what} (non-fatal): ${err instanceof Error ? err.message : 'unknown error'}`);

async function activeConsent(userId: string): Promise<{ givenAt: Date } | null> {
  return prisma.patientConsent.findFirst({
    where: { userId, consentType: RESEARCH_CONSENT_TYPE, version: RESEARCH_CONSENT_VERSION, withdrawn: false },
    select: { givenAt: true },
  });
}

/**
 * Close the withdrawal race. A capture reads the consent, then writes; if the
 * person withdrew (and the purge ran) in between, the write would re-create
 * rows for someone who has just asked for them to be deleted. After writing,
 * check again and purge if consent is gone. Cheap, and it makes "no research
 * rows without an active consent" hold even under concurrency.
 */
export async function reconcileConsent(userId: string): Promise<boolean> {
  if (await activeConsent(userId)) return true;
  await purgeSubject(userId);
  return false;
}

/** Subject fields needed to build a snapshot, or null if not an eligible subject. */
async function loadSubject(userId: string): Promise<(SubjectLike & { role: string; isActive: boolean }) | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true, dateOfBirth: true, gender: true, riskProfile: true },
  });
}

/**
 * Capture one or more readings for one user. `live` carries the rules-engine
 * output for a reading when the caller has it (the early-warning route does);
 * the sweep doesn't, and never overwrites live fields that are already stored.
 */
export async function captureReadings(
  userId: string,
  readings: ReadingLike[],
  live?: Map<string, LiveEngineOutput>,
): Promise<{ status: CaptureStatus; written: number }> {
  try {
    if (!researchCaptureEnabled()) return { status: 'disabled', written: 0 };
    const key = getPseudonymKey()!;
    const subjectKey = subjectKeyFor(userId, key)!;

    const [consent, subject] = await Promise.all([activeConsent(userId), loadSubject(userId)]);
    if (!consent) return { status: 'no_consent', written: 0 };
    if (!subject || subject.role !== 'PATIENT' || !subject.isActive) return { status: 'not_eligible', written: 0 };

    let written = 0;
    let sawPreConsent = false;
    let sawIneligible = false;
    for (const reading of readings) {
      if (reading.createdAt < consent.givenAt) {
        sawPreConsent = true;
        continue;
      }
      const fields = buildSnapshotFields(reading, subject);
      if (!fields) {
        sawIneligible = true;
        continue;
      }
      const sourceRef = sourceRefFor('reading', reading.id, key)!;
      const liveOut = liveFields(live?.get(reading.id));
      await prisma.researchSnapshot.upsert({
        where: { subjectKey_sourceRef: { subjectKey, sourceRef } },
        create: { subjectKey, sourceRef, consentVersion: RESEARCH_CONSENT_VERSION, ...fields, ...liveOut },
        // The sweep passes nothing and so changes nothing; the analysis hook
        // fills in what the rules engine concluded for this same reading.
        update: liveOut,
      });
      written += 1;
    }
    if (written > 0) {
      if (!(await reconcileConsent(userId))) return { status: 'no_consent', written: 0 };
      return { status: 'captured', written };
    }
    if (sawPreConsent) return { status: 'pre_consent', written: 0 };
    return { status: sawIneligible ? 'not_eligible' : 'captured', written: 0 };
  } catch (err) {
    warn('captureReadings failed', err);
    return { status: 'error', written: 0 };
  }
}

export async function captureReadingSnapshot(
  userId: string,
  reading: ReadingLike,
  live?: LiveEngineOutput,
): Promise<CaptureStatus> {
  const map = live ? new Map([[reading.id, live]]) : undefined;
  return (await captureReadings(userId, [reading], map)).status;
}

async function writeOutcome(params: {
  userId: string;
  outcomeType: OutcomeType;
  outcomeDay: Date;
  sourceKind: string;
  sourceId: string;
  icd10?: string | null;
  details?: Record<string, unknown> | null;
  source: 'TRIAGE_REVIEW' | 'CLINICIAN_ENTRY' | 'ALERT_ADJUDICATION';
  recordedByRole: 'DOCTOR' | 'NURSE' | 'SYSTEM';
}): Promise<CaptureStatus> {
  if (!researchCaptureEnabled()) return 'disabled';
  const key = getPseudonymKey()!;
  const consent = await activeConsent(params.userId);
  if (!consent) return 'no_consent';
  const subject = await loadSubject(params.userId);
  if (!subject || subject.role !== 'PATIENT') return 'not_eligible';

  const subjectKey = subjectKeyFor(params.userId, key)!;
  const sourceRef = sourceRefFor(`outcome:${params.outcomeType}:${params.sourceKind}`, params.sourceId, key)!;
  const data = {
    outcomeType: params.outcomeType,
    outcomeDay: params.outcomeDay,
    icd10: params.icd10 ?? null,
    details: (params.details ?? undefined) as object | undefined,
    source: params.source,
    recordedByRole: params.recordedByRole,
    consentVersion: RESEARCH_CONSENT_VERSION,
  };
  await prisma.researchOutcome.upsert({
    where: { subjectKey_sourceRef: { subjectKey, sourceRef } },
    create: { subjectKey, sourceRef, ...data },
    update: data, // a doctor correcting a recorded level replaces it, never duplicates it
  });
  if (!(await reconcileConsent(params.userId))) return 'no_consent';
  return 'captured';
}

/**
 * A doctor's finished triage case: AI level vs final level. This is the
 * dataset that grows fastest and needs no wearable history: how often the AI
 * under-triages relative to the clinician.
 */
export async function captureTriageOutcome(c: {
  id: string;
  patientId: string;
  aiTriageLevel: number;
  finalTriageLevel: number | null;
  route: TriageRoute;
  emergencyReferral?: boolean;
  closedAt?: Date | null;
}): Promise<CaptureStatus> {
  try {
    const day = toDay(c.closedAt ?? new Date());
    const status = await writeOutcome({
      userId: c.patientId,
      outcomeType: 'TRIAGE_REVIEWED',
      outcomeDay: day,
      sourceKind: 'triage',
      sourceId: c.id,
      details: triageDetails(c.aiTriageLevel, c.finalTriageLevel, c.route),
      source: 'TRIAGE_REVIEW',
      recordedByRole: 'SYSTEM',
    });
    if (status === 'captured' && c.emergencyReferral) {
      await writeOutcome({
        userId: c.patientId,
        outcomeType: 'EMERGENCY_REFERRAL',
        outcomeDay: day,
        sourceKind: 'triage',
        sourceId: c.id,
        details: { route: c.route },
        source: 'TRIAGE_REVIEW',
        recordedByRole: 'SYSTEM',
      });
    }
    return status;
  } catch (err) {
    warn('captureTriageOutcome failed', err);
    return 'error';
  }
}

/**
 * A diagnosis code the doctor already entered on a prescription or referral.
 * Recorded silently, marked REMOTE_TRIAGE (diagnosed remotely, not examined or
 * tested) so analyses can discount it. No code, or a code that maps to no
 * outcome, records nothing.
 */
export async function captureDiagnosisOutcomes(c: {
  caseId: string;
  patientId: string;
  icd10: string | null;
  route: 'PRESCRIPTION' | 'REFERRAL';
  closedAt?: Date | null;
}): Promise<CaptureStatus> {
  try {
    const types = outcomeTypesForIcd10(c.icd10);
    // Same case + same route is the same fact. When the doctor corrects the code
    // (I10 -> E11, or removes it), what the earlier code recorded must go, or the
    // dataset would keep an outcome nobody now stands behind. Needs only the key,
    // not consent: deleting is always allowed.
    await clearSupersededDiagnosisOutcomes(c.patientId, `${c.caseId}:${c.route}`, types);
    if (types.length === 0) return 'captured';
    const day = toDay(c.closedAt ?? new Date());
    let status: CaptureStatus = 'captured';
    for (const outcomeType of types) {
      status = await writeOutcome({
        userId: c.patientId,
        outcomeType,
        outcomeDay: day,
        sourceKind: 'triage-dx',
        sourceId: `${c.caseId}:${c.route}`,
        icd10: c.icd10,
        details: { basis: 'REMOTE_TRIAGE', route: c.route },
        source: 'TRIAGE_REVIEW',
        recordedByRole: 'DOCTOR',
      });
      if (status !== 'captured') return status;
    }
    return status;
  } catch (err) {
    warn('captureDiagnosisOutcomes failed', err);
    return 'error';
  }
}

async function clearOppositeAlertAnswer(userId: string, chosen: OutcomeType, sourceId: string): Promise<void> {
  const key = getPseudonymKey();
  if (!researchCaptureEnabled() || !key) return;
  const opposite: OutcomeType = chosen === 'ALERT_CONFIRMED' ? 'ALERT_DISMISSED' : 'ALERT_CONFIRMED';
  await prisma.researchOutcome.deleteMany({
    where: { subjectKey: subjectKeyFor(userId, key)!, sourceRef: sourceRefFor(`outcome:${opposite}:clinician`, sourceId, key)! },
  });
}

// Every type a diagnosis code can map to, so a stale one can be found and removed.
const DIAGNOSIS_TYPES: OutcomeType[] = ['HYPERTENSION_DIAGNOSED', 'DIABETES_DIAGNOSED', 'CVD_EVENT', 'ARRHYTHMIA_DIAGNOSED'];

async function clearSupersededDiagnosisOutcomes(userId: string, sourceId: string, keep: OutcomeType[]): Promise<void> {
  const key = getPseudonymKey();
  if (!researchCaptureEnabled() || !key) return;
  const subjectKey = subjectKeyFor(userId, key)!;
  const stale = DIAGNOSIS_TYPES.filter((t) => !keep.includes(t)).map((t) => sourceRefFor(`outcome:${t}:triage-dx`, sourceId, key)!);
  if (stale.length === 0) return;
  await prisma.researchOutcome.deleteMany({ where: { subjectKey, sourceRef: { in: stale } } });
}

/** A clinician-entered, validated outcome for a patient they hold access to (checked by the route). */
export async function recordClinicianOutcome(
  patientId: string,
  input: ClinicianOutcomeInput,
  recordedByRole: 'DOCTOR' | 'NURSE',
): Promise<{ ok: false; error: string } | { ok: true; status: CaptureStatus }> {
  const v = validateClinicianOutcome(input);
  if (!v.ok) return v;
  try {
    const { outcomeType, outcomeDay, icd10, details } = v.value;
    const isAlert = outcomeType === 'ALERT_CONFIRMED' || outcomeType === 'ALERT_DISMISSED';
    const sourceId = `${patientId}:${outcomeDay.toISOString().slice(0, 10)}:${icd10 ?? ''}`;
    // "Useful" and "false alarm" for the same patient and day contradict each
    // other. A doctor changing their mind replaces the earlier answer; the
    // dataset never holds both.
    if (isAlert) await clearOppositeAlertAnswer(patientId, outcomeType, sourceId);
    const status = await writeOutcome({
      userId: patientId,
      outcomeType,
      outcomeDay,
      sourceKind: 'clinician',
      // Same patient + type + day + code is the same fact entered twice.
      sourceId,
      icd10,
      details,
      source: isAlert ? 'ALERT_ADJUDICATION' : 'CLINICIAN_ENTRY',
      recordedByRole,
    });
    return { ok: true, status };
  } catch (err) {
    warn('recordClinicianOutcome failed', err);
    return { ok: true, status: 'error' };
  }
}

/**
 * Withdrawal: delete everything held for this person (snapshots, their
 * predictions via cascade, outcomes). Returns purged=false when it could not
 * run (no key, or a database error), so the caller can surface that rather
 * than tell someone their data is gone when it is not.
 */
export async function purgeSubject(userId: string): Promise<{ purged: boolean; snapshots: number; outcomes: number }> {
  const subjectKey = subjectKeyFor(userId);
  if (!subjectKey) return { purged: false, snapshots: 0, outcomes: 0 };
  try {
    const [snapshots, outcomes] = await prisma.$transaction([
      prisma.researchSnapshot.deleteMany({ where: { subjectKey } }),
      prisma.researchOutcome.deleteMany({ where: { subjectKey } }),
    ]);
    return { purged: true, snapshots: snapshots.count, outcomes: outcomes.count };
  } catch (err) {
    warn('purgeSubject failed', err);
    return { purged: false, snapshots: 0, outcomes: 0 };
  }
}

/** Accrual counts for the admin dashboard. Aggregates only; no row-level data leaves this function. */
export async function researchStatus() {
  const [consentedPatients, snapshots, subjects, outcomesByType, predictionsByModel, firstDay, lastDay] = await Promise.all([
    prisma.patientConsent.count({
      where: { consentType: RESEARCH_CONSENT_TYPE, version: RESEARCH_CONSENT_VERSION, withdrawn: false },
    }),
    prisma.researchSnapshot.count(),
    // Counted in the database: grouping every subject into memory just to take a length does not scale.
    prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(DISTINCT "subjectKey") AS n FROM research_snapshots`.then((r) => Number(r[0]?.n ?? 0)),
    prisma.researchOutcome.groupBy({ by: ['outcomeType'], _count: { _all: true } }),
    prisma.researchPrediction.groupBy({ by: ['modelName', 'modelVersion'], _count: { _all: true } }),
    prisma.researchSnapshot.findFirst({ orderBy: { observedDay: 'asc' }, select: { observedDay: true } }),
    prisma.researchSnapshot.findFirst({ orderBy: { observedDay: 'desc' }, select: { observedDay: true } }),
  ]);
  // Who recorded outcomes (from the audit trail, last 90 days): lets an admin
  // see that outcome recording is happening and who is doing it, without any
  // row-level research data.
  const since = new Date(Date.now() - 90 * 86_400_000);
  const byClinician = await prisma.auditLog.groupBy({
    by: ['userId'],
    where: { resource: 'ResearchOutcome', action: 'CREATE', createdAt: { gte: since }, metadata: { path: ['status'], equals: 'captured' } },
    _count: { _all: true },
  });
  const ids = byClinician.map((r) => r.userId).filter((id): id is string => Boolean(id));
  const names = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const nameOf = new Map(names.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  return {
    outcomesRecordedByClinicianLast90Days: byClinician
      .filter((r) => r.userId)
      .map((r) => ({ clinicianId: r.userId as string, name: nameOf.get(r.userId as string) ?? 'Unknown', count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    captureEnabled: researchCaptureEnabled(),
    consentVersion: RESEARCH_CONSENT_VERSION,
    consentedPatients,
    snapshots,
    subjectsWithSnapshots: subjects,
    outcomes: Object.fromEntries(outcomesByType.map((o) => [o.outcomeType, o._count._all])),
    shadowPredictions: predictionsByModel.map((p) => ({ model: p.modelName, version: p.modelVersion, count: p._count._all })),
    firstObservedDay: firstDay?.observedDay.toISOString().slice(0, 10) ?? null,
    lastObservedDay: lastDay?.observedDay.toISOString().slice(0, 10) ?? null,
  };
}

/**
 * What is held about one person, for their own eyes (POPIA right of access).
 * Their snapshots and recorded outcomes are returned in full. Model scores are
 * returned as a COUNT only: they come from unvalidated candidate models and
 * showing a patient a risk number would amount to the clinical claim the
 * pipeline deliberately does not make. Anyone wanting those can ask the
 * Information Officer.
 */
export async function researchDataFor(userId: string) {
  const consent = await prisma.patientConsent.findFirst({
    where: { userId, consentType: RESEARCH_CONSENT_TYPE, version: RESEARCH_CONSENT_VERSION, withdrawn: false },
    select: { givenAt: true },
  });
  const subjectKey = subjectKeyFor(userId);
  if (!subjectKey) {
    return { taking_part: Boolean(consent), since: consent?.givenAt ?? null, readings: [], outcomes: [], modelScoresComputed: 0, captureEnabled: false };
  }
  const [readings, outcomes, scores] = await Promise.all([
    prisma.researchSnapshot.findMany({
      where: { subjectKey },
      orderBy: { observedDay: 'asc' },
      // Everything about the reading except the internal keys.
      select: {
        observedDay: true, ageBand: true, sex: true, smoker: true, diabetes: true, hypertensionKnown: true,
        hivPositive: true, activeTb: true, bpTreatment: true, totalCholesterolMmol: true, hdlMmol: true,
        hrResting: true, hrvRmssd: true, spo2: true, respRate: true, skinTempOffset: true, sbp: true, dbp: true,
        glucose: true, bmi: true, steps: true, sleepHours: true, ecgIrregular: true, temperatureTrend: true, source: true,
        liveAlertLevel: true, liveCvdCategory: true,
      },
    }),
    prisma.researchOutcome.findMany({
      where: { subjectKey },
      orderBy: { outcomeDay: 'asc' },
      select: { outcomeType: true, outcomeDay: true, icd10: true, details: true, source: true },
    }),
    prisma.researchPrediction.count({ where: { snapshot: { subjectKey } } }),
  ]);
  return {
    taking_part: Boolean(consent),
    since: consent?.givenAt ?? null,
    readings,
    outcomes,
    modelScoresComputed: scores,
    captureEnabled: researchCaptureEnabled(),
  };
}

