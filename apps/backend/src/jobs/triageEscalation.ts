/**
 * triageEscalation.ts
 *
 * SLA-based triage case escalation cron job.
 *
 * SLA rules (from IMPLEMENTATION_PLAN):
 *   Level 1 (Red)    — 5 minutes
 *   Level 2 (Orange) — 15 minutes
 *   Level 3 (Yellow) — 60 minutes
 *   Level 4 (Green)  — 4 hours
 *   Level 5 (Blue)   — 8 hours
 *
 * Run every 2 minutes: checks for overdue PENDING_REVIEW cases and escalates them.
 * Escalation levels: 0 = normal, 1 = escalated (notify admin), 2 = critical (page on-call).
 */

import { addEmailJob } from '../services/queue';
import prisma from '../lib/prisma';

// SLA thresholds in minutes per triage level
const SLA_MINUTES: Record<number, number> = {
  1: 5,
  2: 15,
  3: 60,
  4: 240,
  5: 480,
};

// Doctor compensation in ZAR cents per level
const DOCTOR_FEE_CENTS: Record<number, number> = {
  1: 15000, // R150
  2: 10000, // R100
  3: 7500,  // R75
  4: 5000,  // R50
  5: 3000,  // R30
};

/**
 * Calculate the SLA deadline for a triage case at creation time.
 */
export function calculateSlaDeadline(triageLevel: number, createdAt: Date): Date {
  const minutes = SLA_MINUTES[triageLevel] ?? 60;
  return new Date(createdAt.getTime() + minutes * 60 * 1000);
}

/**
 * Calculate doctor compensation for reviewing a case.
 */
export function getDoctorFee(triageLevel: number): number {
  return DOCTOR_FEE_CENTS[triageLevel] ?? 5000;
}

/**
 * Main escalation job — run on a cron schedule (every 2 minutes).
 */
export async function runEscalationCheck(): Promise<void> {
  const now = new Date();

  try {
    // Find all PENDING_REVIEW cases where SLA deadline has passed
    const overdueCases = await prisma.triageCase.findMany({
      where: {
        status: 'PENDING_REVIEW',
        slaDeadline: { lt: now },
        escalationLevel: { lt: 2 }, // Don't re-escalate critical cases
      },
      include: {
        patient: { select: { firstName: true, lastName: true, email: true } },
        doctor:  { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { slaDeadline: 'asc' },
      take: 50, // Process max 50 per run to avoid thundering herd
    });

    if (overdueCases.length === 0) return;

    console.log(`[triageEscalation] Processing ${overdueCases.length} overdue triage cases`);

    for (const tc of overdueCases) {
      const newEscalationLevel = tc.escalationLevel + 1;
      const minutesOverdue = Math.floor((now.getTime() - (tc.slaDeadline?.getTime() ?? 0)) / 60000);

      await prisma.triageCase.update({
        where: { id: tc.id },
        data: {
          escalationLevel: newEscalationLevel,
          escalatedAt: now,
        } as any,
      });

      // Notify admin about escalated case
      const adminUsers = await prisma.user.findMany({
        where: { role: 'ADMIN', isActive: true },
        select: { email: true, firstName: true, lastName: true },
        take: 3,
      });

      for (const admin of adminUsers) {
        if (!admin.email) continue;
        await addEmailJob({
          to: admin.email,
          subject: `[ESCALATION L${newEscalationLevel}] Triage case ${tc.id.slice(-6)} overdue by ${minutesOverdue}min`,
          priority: tc.aiTriageLevel <= 2 ? 1 : 3,
          html: buildEscalationEmail({
            caseId: tc.id,
            triageLevel: tc.aiTriageLevel,
            escalationLevel: newEscalationLevel,
            minutesOverdue,
            patientName: `${tc.patient.firstName} ${tc.patient.lastName}`,
            symptoms: tc.symptoms,
            recipientName: `${admin.firstName} ${admin.lastName}`,
          }),
        });
      }

      // For Level 1-2 critical cases at escalation 2: notify on-call doctor directly
      if (tc.aiTriageLevel <= 2 && newEscalationLevel >= 2) {
        const onCallDoctors = await prisma.user.findMany({
          where: { role: 'DOCTOR', isAvailable: true, isActive: true },
          select: { email: true, firstName: true, lastName: true },
          take: 3,
          orderBy: { updatedAt: 'desc' },
        });

        for (const doctor of onCallDoctors) {
          if (!doctor.email) continue;
          await addEmailJob({
            to: doctor.email,
            subject: `[CRITICAL] SATS Level ${tc.aiTriageLevel} triage case requires immediate review`,
            priority: 1,
            html: buildEscalationEmail({
              caseId: tc.id,
              triageLevel: tc.aiTriageLevel,
              escalationLevel: newEscalationLevel,
              minutesOverdue,
              patientName: `${tc.patient.firstName} ${tc.patient.lastName}`,
              symptoms: tc.symptoms,
              recipientName: `Dr ${doctor.firstName} ${doctor.lastName}`,
            }),
          });
        }
      }

      console.log(`[triageEscalation] Case ${tc.id.slice(-6)}: escalated to L${newEscalationLevel} (${minutesOverdue}min overdue, SATS ${tc.aiTriageLevel})`);

      // Real-time WebSocket alert to all online doctors
      try {
        const { broadcastToUsers } = await import('../services/websocket');
        const onlineDoctors = await prisma.user.findMany({
          where: { role: 'DOCTOR', isAvailable: true, isActive: true },
          select: { id: true },
        });
        if (onlineDoctors.length > 0) {
          broadcastToUsers(onlineDoctors.map(d => d.id), {
            type: 'TRIAGE_ESCALATION',
            data: {
              triageCaseId: tc.id,
              triageLevel: tc.aiTriageLevel,
              escalationLevel: newEscalationLevel,
              minutesOverdue,
              slaDeadline: tc.slaDeadline?.toISOString(),
            },
          });
        }
      } catch (wsErr) {
        console.warn('[triageEscalation] WebSocket notify failed (non-fatal):', (wsErr as Error).message);
      }
    }
  } catch (err) {
    console.error('[triageEscalation] Escalation check failed:', err);
  }
}

/**
 * Mark a case as reviewed, record whether it was within SLA, set doctor fee.
 * Call this when a doctor approves/overrides a triage case.
 */
export async function markCaseReviewed(
  caseId: string,
  doctorId: string
): Promise<void> {
  const tc = await prisma.triageCase.findUnique({ where: { id: caseId } });
  if (!tc) return;

  const reviewedWithinSla = tc.slaDeadline ? new Date() <= tc.slaDeadline : true;
  const feeCents = getDoctorFee(tc.aiTriageLevel);

  await prisma.triageCase.update({
    where: { id: caseId },
    data: {
      doctorId,
      reviewedWithinSla,
      doctorFeeCents: feeCents,
    } as any,
  });
}

// ---------------------------------------------------------------------------
// Email template helper
// ---------------------------------------------------------------------------
function buildEscalationEmail(params: {
  caseId: string;
  triageLevel: number;
  escalationLevel: number;
  minutesOverdue: number;
  patientName: string;
  symptoms: string;
  recipientName: string;
}): string {
  const levelLabel = ['', 'Red/Immediate', 'Orange/Very Urgent', 'Yellow/Urgent', 'Green/Less Urgent', 'Blue/Non-Urgent'];
  const urgencyColor = params.triageLevel <= 2 ? '#dc2626' : params.triageLevel <= 3 ? '#d97706' : '#16a34a';

  return `
  <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
    <img src="https://019beed4-58f9-79ea-8acd-d59b2c121f81.mochausercontent.com/Ahava-on-88-logo.png" height="40" alt="Ahava Healthcare" />
    <hr/>
    <h2 style="color:${urgencyColor}">⚠️ Escalation Level ${params.escalationLevel}: Overdue Triage Case</h2>
    <p>Dear ${params.recipientName},</p>
    <p>A <strong>SATS Level ${params.triageLevel} (${levelLabel[params.triageLevel]})</strong> triage case has not been reviewed and is <strong>${params.minutesOverdue} minutes overdue</strong>.</p>
    <table style="border-collapse:collapse;width:100%">
      <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">Case ID</td><td style="padding:8px">${params.caseId}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">Patient</td><td style="padding:8px">${params.patientName}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">SATS Level</td><td style="padding:8px;color:${urgencyColor};font-weight:bold">${params.triageLevel} — ${levelLabel[params.triageLevel]}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">Symptoms</td><td style="padding:8px">${params.symptoms.slice(0, 200)}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">Overdue</td><td style="padding:8px;color:#dc2626">${params.minutesOverdue} minutes</td></tr>
    </table>
    <p style="margin-top:16px">Please log in to the Ahava Doctor Dashboard immediately to review this case.</p>
    <p style="color:#6b7280;font-size:12px;margin-top:24px">Ahava Healthcare — Automated Escalation System</p>
  </div>`;
}
