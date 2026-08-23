import crypto from 'crypto';

export interface PayFastPaymentData {
  merchant_id: string;
  merchant_key: string;
  return_url: string;
  cancel_url: string;
  notify_url: string;
  amount: string;
  item_name: string;
  custom_str1?: string;
}

export interface PayFastVerificationData {
  txn_id?: string;
  amount_gross?: string;
  custom_str1?: string;
  [key: string]: any;
}

export class PayFastService {
  private merchantId: string;
  private merchantKey: string;
  private passPhrase: string;
  private sandbox: boolean;
  private appUrl: string;

  constructor() {
    this.merchantId = process.env.PAYFAST_MERCHANT_ID || '';
    this.merchantKey = process.env.PAYFAST_MERCHANT_KEY || '';
    this.passPhrase = process.env.PAYFAST_PASSPHRASE || '';
    this.sandbox = process.env.PAYFAST_SANDBOX === 'true';
    this.appUrl = process.env.APP_URL || 'http://localhost:3000';
  }

  async createPayment(amount: number, itemName: string, customStr: string): Promise<{ url: string; data: PayFastPaymentData }> {
    const baseUrl = this.sandbox 
      ? 'https://sandbox.payfast.co.za/eng/process' 
      : 'https://www.payfast.co.za/eng/process';

    const paymentData: PayFastPaymentData = {
      merchant_id: this.merchantId,
      merchant_key: this.merchantKey,
      return_url: this.appUrl + '/payments/return',
      cancel_url: this.appUrl + '/payments/cancel',
      notify_url: this.appUrl + '/api/payments/webhook',
      amount: (amount / 100).toFixed(2),
      item_name: itemName,
      custom_str1: customStr,
    };

    // Generate signature
    const signature = this.generateSignature(paymentData);
    
    // In a real implementation, we would send this to PayFast
    // For now, return the data and URL
    return {
      url: baseUrl,
      data: paymentData,
    };
  }

  async verifyPayment(data: PayFastVerificationData): Promise<boolean> {
    // Verify the signature from PayFast
    // This is a placeholder - actual implementation requires PayFast credentials
    return true;
  }

  private generateSignature(data: PayFastPaymentData): string {
    const fields = [
      'merchant_id',
      'merchant_key',
      'return_url',
      'cancel_url',
      'notify_url',
      'amount',
      'item_name',
      'custom_str1',
    ];

    let signatureString = '';
    for (const field of fields) {
      if (data[field as keyof PayFastPaymentData]) {
        signatureString += data[field as keyof PayFastPaymentData] + '|';
      }
    }

    // Remove trailing pipe
    signatureString = signatureString.slice(0, -1);

    if (this.passPhrase) {
      signatureString += '|' + this.passPhrase;
    }

    return crypto.createHash('md5').update(signatureString).digest('hex');
  }
}
