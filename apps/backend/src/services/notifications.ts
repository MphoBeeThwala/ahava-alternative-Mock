/**
 * Post-interaction email notifications (Resend via queue).
 * Enqueue emails for: payment receipts, triage outcomes, visit approval, prescriptions, system alerts.
 */
import { addEmailJob } from './queue';

const APP_NAME = 'Ahava Healthcare';

function wrapHtml(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #334155; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #0f172a;">${escapeHtml(title)}</h2>
  <div style="margin: 16px 0;">${body}</div>
  <p style="margin-top: 24px; font-size: 12px; color: #64748b;">This is an automated message from ${APP_NAME}. Do not reply to this email.</p>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function notifyPaymentReceipt(params: {
  to: string;
  recipientName: string;
  amountCents: number;
  currency: string;
  paymentId: string;
  description?: string;
}): Promise<void> {
  const amount = (params.amountCents / 100).toFixed(2);
  const body = `
    <p>Hi ${escapeHtml(params.recipientName)},</p>
    <p>Your payment has been received.</p>
    <ul>
      <li><strong>Amount:</strong> ${params.currency} ${amount}</li>
      <li><strong>Reference:</strong> ${escapeHtml(params.paymentId)}</li>
      ${params.description ? `<li><strong>For:</strong> ${escapeHtml(params.description)}</li>` : ''}
    </ul>
    <p>Thank you for using ${APP_NAME}.</p>
  `;
  await addEmailJob({
    to: params.to,
    subject: `Payment receipt – ${params.currency} ${amount}`,
    html: wrapHtml('Payment receipt', body),
  });
}

export async function notifyTriageApproved(params: {
  to: string;
  patientName: string;
  finalDiagnosis: string;
}): Promise<void> {
  const body = `
    <p>Hi ${escapeHtml(params.patientName)},</p>
    <p>A doctor has reviewed your recent triage and <strong>agreed with the assessment</strong>.</p>
    <p><strong>Conclusion:</strong> ${escapeHtml(params.finalDiagnosis)}</p>
    <p>If you have any follow-up concerns, please log in to the platform or contact your care team.</p>
  `;
  await addEmailJob({
    to: params.to,
    subject: 'Your triage has been approved by a doctor',
    html: wrapHtml('Triage approved', body),
  });
}

export async function notifyTriageOverride(params: {
  to: string;
  patientName: string;
  doctorNotes?: string;
  finalDiagnosis?: string;
}): Promise<void> {
  const body = `
    <p>Hi ${escapeHtml(params.patientName)},</p>
    <p>A doctor has reviewed your triage and provided a <strong>different assessment</strong> from the AI assistant.</p>
    ${params.doctorNotes ? `<p><strong>Doctor notes:</strong> ${escapeHtml(params.doctorNotes)}</p>` : ''}
    ${params.finalDiagnosis ? `<p><strong>Final diagnosis:</strong> ${escapeHtml(params.finalDiagnosis)}</p>` : '<p>You may receive a final diagnosis shortly after the doctor completes their review.</p>'}
    <p>If you have questions, please log in or contact your care team.</p>
  `;
  await addEmailJob({
    to: params.to,
    subject: 'Update on your triage – doctor assessment',
    html: wrapHtml('Triage update from doctor', body),
  });
}

export async function notifyTriageReferred(params: {
  to: string;
  patientName: string;
  referredTo: string;
  doctorNotes?: string;
}): Promise<void> {
  const body = `
    <p>Hi ${escapeHtml(params.patientName)},</p>
    <p>A doctor has reviewed your triage and recommended a <strong>follow-up</strong>.</p>
    <p><strong>Referred to:</strong> ${escapeHtml(params.referredTo)}</p>
    ${params.doctorNotes ? `<p><strong>Notes:</strong> ${escapeHtml(params.doctorNotes)}</p>` : ''}
    <p>Please arrange the appointment as indicated. If you have questions, log in to the platform or contact your care team.</p>
  `;
  await addEmailJob({
    to: params.to,
    subject: 'Follow-up recommended – ' + params.referredTo,
    html: wrapHtml('Follow-up recommended', body),
  });
}

export async function notifyVisitApproved(params: {
  to: string;
  patientName: string;
  doctorReview?: string;
}): Promise<void> {
  const body = `
    <p>Hi ${escapeHtml(params.patientName)},</p>
    <p>Your recent visit has been <strong>reviewed and approved</strong> by a doctor.</p>
    ${params.doctorReview ? `<p><strong>Doctor review:</strong> ${escapeHtml(params.doctorReview)}</p>` : ''}
    <p>Thank you for using ${APP_NAME}.</p>
  `;
  await addEmailJob({
    to: params.to,
    subject: 'Your visit has been approved',
    html: wrapHtml('Visit approved', body),
  });
}

export async function notifyPrescriptionReady(params: {
  to: string;
  patientName: string;
  prescriptionSummary: string;
  instructions?: string;
}): Promise<void> {
  const body = `
    <p>Hi ${escapeHtml(params.patientName)},</p>
    <p>Your <strong>prescription</strong> from your recent consult is ready.</p>
    <p>${escapeHtml(params.prescriptionSummary)}</p>
    ${params.instructions ? `<p><strong>Instructions:</strong> ${escapeHtml(params.instructions)}</p>` : ''}
    <p>You can collect it from your pharmacy or view the full script in the app.</p>
  `;
  await addEmailJob({
    to: params.to,
    subject: 'Your prescription is ready',
    html: wrapHtml('Prescription ready', body),
  });
}

export async function notifySystem(params: {
  to: string;
  subject: string;
  message: string;
}): Promise<void> {
  const body = `<p>${escapeHtml(params.message)}</p>`;
  await addEmailJob({
    to: params.to,
    subject: params.subject,
    html: wrapHtml(params.subject, body),
  });
}
