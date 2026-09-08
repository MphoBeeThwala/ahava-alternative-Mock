import crypto from 'crypto';
import dns from 'dns';

/**
 * PayFast integration.
 *
 * PayFast's documented ITN security model has four independent checks and all
 * four are required, because any one of them alone is defeatable:
 *
 *   1. the signature matches, using the merchant passphrase
 *   2. the request came from a PayFast server
 *   3. the amount matches what we asked to be paid
 *   4. PayFast itself confirms the notification, via a server-to-server postback
 *
 * Only (1) was implemented before, and (3) is enforced by the caller in
 * routes/payments.ts, which is the only place that knows what was owed.
 */

const PAYFAST_LIVE_HOSTS = [
  'www.payfast.co.za',
  'w1w.payfast.co.za',
  'w2w.payfast.co.za',
];
const PAYFAST_SANDBOX_HOSTS = ['sandbox.payfast.co.za'];

/**
 * Field order for the payment-request signature.
 *
 * PayFast requires the *form order* here, not alphabetical order - unlike the
 * ITN signature, which is built from the fields as received. Getting this wrong
 * produces a signature PayFast rejects at checkout.
 */
const PAYMENT_FIELD_ORDER = [
  'merchant_id',
  'merchant_key',
  'return_url',
  'cancel_url',
  'notify_url',
  'm_payment_id',
  'amount',
  'item_name',
  'custom_str1',
] as const;

export interface PayFastPaymentData {
  merchant_id: string;
  merchant_key: string;
  return_url: string;
  cancel_url: string;
  notify_url: string;
  m_payment_id: string;
  amount: string;
  item_name: string;
  custom_str1?: string;
  signature?: string;
}

export interface PayFastVerificationData {
  m_payment_id?: string;
  pf_payment_id?: string;
  payment_status?: string;
  amount_gross?: string;
  custom_str1?: string;
  signature?: string;
  [key: string]: unknown;
}

/**
 * PayFast's own encoding: urlencoded, with spaces as '+' rather than '%20',
 * and uppercase percent escapes. Used for both signature directions.
 */
function encodeForSignature(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/%[0-9a-f]{2}/g, (match) => match.toUpperCase());
}

export class PayFastService {
  private merchantId: string;
  private merchantKey: string;
  private passPhrase: string;
  private sandbox: boolean;
  private appUrl: string;
  private apiUrl: string;

  constructor() {
    this.merchantId = process.env.PAYFAST_MERCHANT_ID || '';
    this.merchantKey = process.env.PAYFAST_MERCHANT_KEY || '';
    this.passPhrase = process.env.PAYFAST_PASSPHRASE || '';
    this.sandbox = process.env.PAYFAST_SANDBOX === 'true';
    this.appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    // The ITN must reach the API directly. Routing it through the frontend
    // proxy would strip the raw body the signature is computed over.
    this.apiUrl = (process.env.API_PUBLIC_URL || this.appUrl).replace(/\/+$/, '');

    if (process.env.NODE_ENV === 'production' && this.sandbox) {
      console.warn('[payfast] PAYFAST_SANDBOX is enabled in production - no real payments will be taken');
    }
  }

  private get processUrl(): string {
    return this.sandbox
      ? 'https://sandbox.payfast.co.za/eng/process'
      : 'https://www.payfast.co.za/eng/process';
  }

  private get validateUrl(): string {
    return this.sandbox
      ? 'https://sandbox.payfast.co.za/eng/query/validate'
      : 'https://www.payfast.co.za/eng/query/validate';
  }

  /**
   * Build a signed checkout payload.
   *
   * @param amountInCents authoritative amount, resolved server-side by the caller
   * @param reference     our own unique reference for this payment attempt
   */
  async createPayment(
    amountInCents: number,
    itemName: string,
    reference: string,
  ): Promise<{ url: string; data: PayFastPaymentData }> {
    if (!this.merchantId || !this.merchantKey) {
      throw new Error('PayFast is not configured (PAYFAST_MERCHANT_ID / PAYFAST_MERCHANT_KEY)');
    }
    if (!Number.isInteger(amountInCents) || amountInCents <= 0) {
      throw new Error('PayFast amount must be a positive integer number of cents');
    }

    const paymentData: PayFastPaymentData = {
      merchant_id: this.merchantId,
      merchant_key: this.merchantKey,
      return_url: `${this.appUrl}/payments/return`,
      cancel_url: `${this.appUrl}/payments/cancel`,
      notify_url: `${this.apiUrl}/api/payments/webhook`,
      m_payment_id: reference,
      amount: (amountInCents / 100).toFixed(2),
      item_name: itemName,
      custom_str1: reference,
    };

    // Previously computed and then discarded, leaving checkout unsigned.
    paymentData.signature = this.generateSignature(paymentData);

    return { url: this.processUrl, data: paymentData };
  }

  /** Signature for an outbound payment request (form field order). */
  private generateSignature(data: PayFastPaymentData): string {
    const parts: string[] = [];
    for (const field of PAYMENT_FIELD_ORDER) {
      const value = data[field];
      if (value === undefined || value === null || value === '') continue;
      parts.push(`${field}=${encodeForSignature(String(value))}`);
    }

    let signatureString = parts.join('&');
    if (this.passPhrase) {
      signatureString += `&passphrase=${encodeForSignature(this.passPhrase)}`;
    }

    return crypto.createHash('md5').update(signatureString).digest('hex');
  }

  /**
   * Check 1: the ITN signature.
   *
   * MD5 over all posted fields except `signature`, in the order received,
   * with the passphrase appended when configured.
   */
  async verifyPayment(data: PayFastVerificationData): Promise<boolean> {
    if (!data || typeof data !== 'object') return false;

    const received = String(data.signature ?? '').toLowerCase();
    if (!received) return false;

    const entries = Object.keys(data)
      .filter((k) => k !== 'signature' && k !== 'rawBody')
      .filter((k) => data[k] !== undefined && data[k] !== null && data[k] !== '')
      .map((k) => `${k}=${encodeForSignature(String(data[k]))}`);

    let signatureString = entries.join('&');
    if (this.passPhrase) {
      signatureString += `&passphrase=${encodeForSignature(this.passPhrase)}`;
    }

    const expected = crypto.createHash('md5').update(signatureString).digest('hex');

    const a = Buffer.from(received, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /** Check 2: the notification came from a PayFast server. */
  async isValidSourceIp(ip: string | undefined): Promise<boolean> {
    if (!ip) return false;
    const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

    const hosts = this.sandbox ? PAYFAST_SANDBOX_HOSTS : PAYFAST_LIVE_HOSTS;
    const resolved = await Promise.all(
      hosts.map(async (host) => {
        try {
          return await dns.promises.resolve4(host);
        } catch {
          return [] as string[];
        }
      }),
    );

    const allowed = new Set(resolved.flat());
    if (allowed.size === 0) {
      // DNS failed entirely. Do not silently accept - the caller decides
      // whether to hold the notification for retry.
      throw new Error('Could not resolve PayFast source addresses');
    }
    return allowed.has(normalized);
  }

  /** Check 4: ask PayFast to confirm the notification it supposedly sent. */
  async validateWithPayFast(rawBody: string): Promise<boolean> {
    try {
      const res = await fetch(this.validateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return false;
      const text = (await res.text()).trim().toUpperCase();
      return text.startsWith('VALID');
    } catch {
      return false;
    }
  }
}
