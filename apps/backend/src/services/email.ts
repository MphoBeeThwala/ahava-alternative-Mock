/**
 * Email sending via Resend.
 * Set RESEND_API_KEY and EMAIL_FROM (e.g. "Ahava Healthcare <notifications@yourdomain.com>") in env.
 */
import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.EMAIL_FROM || 'Ahava Healthcare <onboarding@resend.dev>';

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!apiKey) return null;
  if (!resend) resend = new Resend(apiKey);
  return resend;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<{ id?: string; error?: Error }> {
  const client = getResend();
  if (!client) {
    console.warn('[email] RESEND_API_KEY not set; skipping send');
    return {};
  }
  try {
    const { data, error } = await client.emails.send({
      from: fromEmail,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    if (error) {
      console.error('[email] Resend error:', error);
      return { error: new Error(error.message) };
    }
    return { id: data?.id };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error('[email] Send failed:', e.message);
    return { error: e };
  }
}
