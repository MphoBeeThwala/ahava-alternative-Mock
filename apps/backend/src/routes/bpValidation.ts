import { Router } from 'express';
import { AuthenticatedRequest, requireAdmin } from '../middleware/auth';
import { writeRequestAudit as createAuditLog } from '../services/clinicalAudit';
import prisma from '../lib/prisma';

// Retrospective validation for AH-45.5a's bp_risk.prompt_bp_check flag —
// docs/ENGINEERING_PLAN.md #32. The whole point of persisting
// bpPromptCheck/cvdRiskCategory (#29) and building the nurse calibration
// workflow (this file's sibling change in visits.ts) was to eventually
// answer: does the flag actually correlate with a real elevated cuff
// reading? Nothing computed that until now. Admin-only — this is
// population-level research/QA data, not a single patient's clinical
// record, and doesn't belong on the doctor monitoring worklist (#30).
const router: Router = Router();

// Standard clinical convention (WHO, JNC7/8, ACC/AHA all broadly agree in
// this range) for an elevated/hypertensive cuff reading — used here only
// to classify calibration readings for this internal validation report,
// never surfaced to a patient and never fed back into cvd_risk or
// bp_risk. Not the same kind of claim as CLINICAL_SIGNOFF_CHECKLIST.md's
// gated items: this doesn't tell a patient anything, it evaluates whether
// an existing (already gated, already signed-off) flag is doing its job.
const ELEVATED_SYSTOLIC = 140;
const ELEVATED_DIASTOLIC = 90;

// How far back from a calibration reading to look for the most recent
// bp_risk-bearing reading it validates against. Chosen to match the
// "prompt for a reading within days, not weeks" framing of AH-45.5a
// itself — a flag from a month ago validating today's cuff reading would
// be testing something closer to coincidence than the actual claim.
const PAIRING_WINDOW_DAYS = 7;

router.get('/bp-flag-validation', requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const windowMs = PAIRING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    const calibrationReadings = await prisma.biometricReading.findMany({
      where: { deviceType: 'nurse_calibration' },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        bloodPressureSystolic: true,
        bloodPressureDiastolic: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (calibrationReadings.length === 0) {
      return res.json({
        success: true,
        sampleSize: 0,
        message: 'No calibration readings recorded yet (nurse-recorded BP during an in-progress visit). Nothing to validate against.',
      });
    }

    const userIds = Array.from(new Set(calibrationReadings.map((r) => r.userId)));
    // Real integration-test bug, caught 2026-09-25 (docs/ENGINEERING_PLAN.md
    // #34): a `NOT: { deviceType: 'nurse_calibration' }` clause here hit
    // SQL's three-valued NULL logic (`deviceType <> 'x'` evaluates to NULL,
    // not TRUE, for rows where deviceType IS NULL) and silently excluded
    // almost every real biometric reading, since deviceType is unset for
    // most of them. Removed rather than patched — it was also redundant:
    // bpPromptCheck is never populated on a calibration reading (only BP
    // values are), so `bpPromptCheck: { not: null }` alone already
    // excludes them, without the NULL-handling trap.
    const candidateReadings = await prisma.biometricReading.findMany({
      where: {
        userId: { in: userIds },
        bpPromptCheck: { not: null },
      },
      select: { id: true, userId: true, createdAt: true, bpPromptCheck: true },
      orderBy: { createdAt: 'asc' },
    });
    const byUser = new Map<string, typeof candidateReadings>();
    for (const r of candidateReadings) {
      const list = byUser.get(r.userId) ?? [];
      list.push(r);
      byUser.set(r.userId, list);
    }

    let tp = 0, fp = 0, fn = 0, tn = 0;
    let pairedCount = 0;
    const pairs: Array<{
      userId: string;
      calibrationReadingId: string;
      calibrationAt: string;
      elevated: boolean;
      flaggedReadingId: string;
      flaggedAt: string;
      promptBpCheck: boolean;
    }> = [];

    for (const cal of calibrationReadings) {
      const elevated =
        (cal.bloodPressureSystolic ?? 0) >= ELEVATED_SYSTOLIC ||
        (cal.bloodPressureDiastolic ?? 0) >= ELEVATED_DIASTOLIC;

      const candidates = (byUser.get(cal.userId) ?? []).filter((r) => {
        const dt = cal.createdAt.getTime() - r.createdAt.getTime();
        return dt >= 0 && dt <= windowMs;
      });
      if (candidates.length === 0) continue;
      // Most recent qualifying reading before the calibration event.
      const match = candidates[candidates.length - 1];

      pairedCount++;
      const flagged = match.bpPromptCheck === true;
      if (flagged && elevated) tp++;
      else if (flagged && !elevated) fp++;
      else if (!flagged && elevated) fn++;
      else tn++;

      pairs.push({
        userId: cal.userId,
        calibrationReadingId: cal.id,
        calibrationAt: cal.createdAt.toISOString(),
        elevated,
        flaggedReadingId: match.id,
        flaggedAt: match.createdAt.toISOString(),
        promptBpCheck: flagged,
      });
    }

    const sensitivity = tp + fn > 0 ? tp / (tp + fn) : null;
    const specificity = tn + fp > 0 ? tn / (tn + fp) : null;
    const ppv = tp + fp > 0 ? tp / (tp + fp) : null;

    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'READ',
      resource: 'BpFlagValidationReport',
      metadata: { calibrationReadingCount: calibrationReadings.length, pairedCount },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    return res.json({
      success: true,
      sampleSize: pairedCount,
      totalCalibrationReadings: calibrationReadings.length,
      unpairedCalibrationReadings: calibrationReadings.length - pairedCount,
      pairingWindowDays: PAIRING_WINDOW_DAYS,
      elevatedThreshold: { systolic: ELEVATED_SYSTOLIC, diastolic: ELEVATED_DIASTOLIC },
      confusionMatrix: { truePositive: tp, falsePositive: fp, falseNegative: fn, trueNegative: tn },
      sensitivity,
      specificity,
      positivePredictiveValue: ppv,
      caveat:
        pairedCount < 30
          ? 'Sample size is below any threshold that would support a real conclusion. This report describes what data exists, not whether the flag works.'
          : null,
      pairs,
    });
  } catch (error) { return next(error); }
});

export default router;
