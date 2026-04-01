const apiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.EMAIL_FROM || 'Ahava Healthcare <onboarding@resend.dev>';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<{ id?: string; error?: Error }> {
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set; skipping send');
    return {};
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { error: new Error(`Resend error: ${resp.status} ${text}`.trim()) };
    }
    const data = (await resp.json().catch(() => null)) as any;
    return { id: data?.id };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error('[email] Send failed:', e.message);
    return { error: e };
  }
}
