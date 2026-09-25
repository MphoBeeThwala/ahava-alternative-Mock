import { Router } from "express";
import { AuthenticatedRequest, requireDoctor } from "../middleware/auth";
import { writeRequestAudit } from "../services/clinicalAudit";
import prisma from "../lib/prisma";

// Doctor-facing biometric monitoring worklist — the clinician-side
// counterpart to the patient's Early Warning page. Did not exist before
// 2026-09-24: no route anywhere under doctor/nurse read BiometricReading,
// EarlyWarningSummary, cvd_risk, or bp_risk (docs/ENGINEERING_PLAN.md #29).
// A separate concern from triage-review (TriageCase, AI-triage-driven) —
// this is continuous biometric monitoring, not a single symptom report.
const router: Router = Router();

// Severity ranking used only for sort order within this worklist — NOT a
// clinical score, and not derived from or feeding into cvd_risk.risk_category
// or bp_risk.prompt_bp_check, both of which are computed independently
// upstream (apps/ml-service/engine.py). This is display ordering only.
function severityRank(r: {
  alertLevel: string | null;
  bpPromptCheck: boolean | null;
  cvdRiskCategory: string | null;
}): number {
  if (r.alertLevel === "RED") return 3;
  if (r.alertLevel === "YELLOW") return 2;
  if (r.bpPromptCheck || r.cvdRiskCategory === ">20%") return 1;
  return 0;
}

router.get("/", requireDoctor, async (req: AuthenticatedRequest, res, next) => {
  try {
    // Only patients who've given BIOMETRIC_MONITORING consent — the
    // PatientConsent type already modeled for exactly this (see
    // ENGINEERING_PLAN.md #25's note that this is the natural extension
    // point), never previously read by any route.
    const consented = await prisma.patientConsent.findMany({
      where: { consentType: "BIOMETRIC_MONITORING", withdrawn: false },
      select: { userId: true },
    });
    const consentedIds = consented.map((c) => c.userId);
    if (consentedIds.length === 0) {
      return res.json({ success: true, patients: [] });
    }

    // One row per patient — their single most recent reading, not any
    // historical match. A patient whose latest reading is GREEN shouldn't
    // appear here just because an older reading was RED; deliberately not
    // filtering by alertLevel in this query (which would let `distinct`
    // pick an old matching row instead of the true latest one) — filtered
    // in application code below instead, against the confirmed-latest row.
    const latestPerUser = await prisma.biometricReading.findMany({
      where: { userId: { in: consentedIds } },
      distinct: ["userId"],
      orderBy: [{ userId: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        userId: true,
        createdAt: true,
        alertLevel: true,
        anomalies: true,
        readinessScore: true,
        bpPromptCheck: true,
        bpContributingSignals: true,
        cvdRiskCategory: true,
        framinghamRiskPct: true,
        framinghamRiskBound: true,
        heartRateResting: true,
        hrvRmssd: true,
        oxygenSaturation: true,
        user: {
          select: { id: true, firstName: true, lastName: true, dateOfBirth: true },
        },
      },
    });

    const flagged = latestPerUser.filter(
      (r) =>
        r.alertLevel === "YELLOW" ||
        r.alertLevel === "RED" ||
        r.bpPromptCheck === true ||
        r.cvdRiskCategory === ">20%",
    );
    flagged.sort(
      (a, b) =>
        severityRank(b) - severityRank(a) ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    await writeRequestAudit({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: "LIST",
      resource: "PatientMonitoringWorklist",
      metadata: {
        flaggedCount: flagged.length,
        totalConsented: consentedIds.length,
      },
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
    });

    res.json({
      success: true,
      patients: flagged.map((r) => ({
        userId: r.userId,
        firstName: r.user.firstName,
        lastName: r.user.lastName,
        dateOfBirth: r.user.dateOfBirth,
        latestReadingAt: r.createdAt,
        alertLevel: r.alertLevel ?? "GREEN",
        anomalies: Array.isArray(r.anomalies) ? r.anomalies : [],
        readinessScore: r.readinessScore,
        // AH-45.5a: still gated server-side (BP_CHECK_PROMPT_SIGNED_OFF) —
        // this is always false today regardless of underlying signals.
        // See CLINICAL_SIGNOFF_CHECKLIST.md row 10.
        bpPromptCheck: Boolean(r.bpPromptCheck),
        bpContributingSignals: Array.isArray(r.bpContributingSignals)
          ? r.bpContributingSignals
          : [],
        // Gated behind WHO_2019_CHART_SIGNED_OFF — null today regardless
        // of profile. See CLINICAL_SIGNOFF_CHECKLIST.md row 7.
        cvdRiskCategory: r.cvdRiskCategory,
        // Gated behind FRAMINGHAM_LAB_CHART_SIGNED_OFF — null today
        // regardless of profile. See CLINICAL_SIGNOFF_CHECKLIST.md row 11.
        framinghamRiskPct: r.framinghamRiskPct,
        framinghamRiskBound: r.framinghamRiskBound,
        heartRateResting: r.heartRateResting,
        hrvRmssd: r.hrvRmssd,
        oxygenSaturation: r.oxygenSaturation,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
