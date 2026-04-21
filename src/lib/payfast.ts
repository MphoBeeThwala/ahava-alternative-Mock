/**
 * PayFast Payment Gateway Integration
 * South African payment gateway - no medical platform restrictions
 * 
 * Official Docs: https://developers.payfast.co.za/
 */

import { createHash } from "crypto";

export interface PayFastConfig {
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  sandbox: boolean;
}

export interface PayFastPaymentData {
  // Merchant details
  merchant_id: string;
  merchant_key: string;
  return_url: string;
  cancel_url: string;
  notify_url: string;

  // Customer details
  name_first: string;
  name_last: string;
  email_address: string;
  cell_number?: string;

  // Transaction details
  m_payment_id: string; // Unique payment ID from your system
  amount: string; // Amount in ZAR
  item_name: string;
  item_description?: string;

  // Custom fields
  custom_str1?: string; // User ID
  custom_str2?: string; // Service type
  custom_str3?: string; // Additional data
  custom_int1?: string; // Additional numeric data

  // Email confirmation
  email_confirmation?: string; // "1" to send confirmation
  confirmation_address?: string; // Alternative email for confirmation
}

export interface PayFastITNData {
  m_payment_id: string;
  pf_payment_id: string;
  payment_status: "COMPLETE" | "FAILED" | "PENDING" | "CANCELLED";
  item_name: string;
  item_description: string;
  amount_gross: string;
  amount_fee: string;
  amount_net: string;
  custom_str1?: string;
  custom_str2?: string;
  custom_str3?: string;
  custom_int1?: string;
  name_first: string;
  name_last: string;
  email_address: string;
  merchant_id: string;
  signature: string;
}

/**
 * Generate PayFast payment signature
 */
export function generatePayFastSignature(data: Record<string, string>, passphrase: string): string {
  // Remove signature if present
  const { signature, ...dataToHash } = data;

  // Sort data alphabetically
  const sortedKeys = Object.keys(dataToHash).sort();

  // Build parameter string
  const paramString = sortedKeys
    .map((key) => `${key}=${encodeURIComponent(dataToHash[key]).replace(/%20/g, "+")}`)
    .join("&");

  // Add passphrase
  const stringToHash = `${paramString}&passphrase=${encodeURIComponent(passphrase)}`;

  // Generate MD5 hash
  return createHash("md5").update(stringToHash).digest("hex");
}

/**
 * Verify PayFast ITN (Instant Transaction Notification) signature
 */
export function verifyPayFastSignature(data: Record<string, string>, passphrase: string): boolean {
  const receivedSignature = data.signature;
  const calculatedSignature = generatePayFastSignature(data, passphrase);
  return receivedSignature === calculatedSignature;
}

/**
 * Get PayFast payment URL
 */
export function getPayFastUrl(sandbox: boolean): string {
  return sandbox ? "https://sandbox.payfast.co.za/eng/process" : "https://www.payfast.co.za/eng/process";
}

/**
 * Create PayFast payment
 */
export function createPayFastPayment(
  config: PayFastConfig,
  paymentData: Omit<PayFastPaymentData, "merchant_id" | "merchant_key">,
  passphrase: string
): { url: string; data: PayFastPaymentData } {
  const fullData: PayFastPaymentData = {
    merchant_id: config.merchantId,
    merchant_key: config.merchantKey,
    ...paymentData,
  };

  // Generate signature
  const signature = generatePayFastSignature(fullData as unknown as Record<string, string>, passphrase);

  return {
    url: getPayFastUrl(config.sandbox),
    data: {
      ...fullData,
    },
  };
}

/**
 * Validate PayFast ITN data
 */
export async function validatePayFastITN(
  itnData: PayFastITNData,
  config: PayFastConfig
): Promise<{ valid: boolean; error?: string }> {
  try {
    // 1. Verify signature
    const signatureValid = verifyPayFastSignature(itnData as unknown as Record<string, string>, config.passphrase);
    if (!signatureValid) {
      return { valid: false, error: "Invalid signature" };
    }

    // 2. Verify merchant ID
    if (itnData.merchant_id !== config.merchantId) {
      return { valid: false, error: "Invalid merchant ID" };
    }

    // 3. Confirm payment status with PayFast (server-to-server)
    const payFastUrl = config.sandbox
      ? `https://sandbox.payfast.co.za/eng/query/validate`
      : `https://www.payfast.co.za/eng/query/validate`;

    const response = await fetch(payFastUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(itnData as unknown as Record<string, string>).toString(),
    });

    const result = await response.text();

    if (result !== "VALID") {
      return { valid: false, error: "PayFast validation failed" };
    }

    return { valid: true };
  } catch (error) {
    console.error("PayFast ITN validation error:", error);
    return { valid: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Service pricing (in ZAR)
 */
export const SERVICE_PRICES = {
  CONSULTATION: "300.00", // R300 per consultation
  EMERGENCY: "500.00", // R500 emergency service fee
  DIAGNOSTIC: "150.00", // R150 diagnostic analysis
  PRESCRIPTION: "100.00", // R100 prescription delivery
  HOMECARE_HOURLY: "250.00", // R250 per hour
  HOMECARE_DAILY: "1800.00", // R1800 per day
  SUBSCRIPTION_MONTHLY: "199.00", // R199/month subscription
  SUBSCRIPTION_YEARLY: "1999.00", // R1999/year subscription (2 months free)
};

/**
 * Service types
 */
export enum ServiceType {
  CONSULTATION = "CONSULTATION",
  EMERGENCY = "EMERGENCY",
  DIAGNOSTIC = "DIAGNOSTIC",
  PRESCRIPTION = "PRESCRIPTION",
  HOMECARE_HOURLY = "HOMECARE_HOURLY",
  HOMECARE_DAILY = "HOMECARE_DAILY",
  SUBSCRIPTION_MONTHLY = "SUBSCRIPTION_MONTHLY",
  SUBSCRIPTION_YEARLY = "SUBSCRIPTION_YEARLY",
}

/**
 * Get service price
 */
export function getServicePrice(serviceType: ServiceType): string {
  return SERVICE_PRICES[serviceType];
}

/**
 * Get service description
 */
export function getServiceDescription(serviceType: ServiceType): string {
  const descriptions: Record<ServiceType, string> = {
    [ServiceType.CONSULTATION]: "Video Consultation with Healthcare Professional",
    [ServiceType.EMERGENCY]: "Emergency Medical Response Service",
    [ServiceType.DIAGNOSTIC]: "AI-Powered Diagnostic Analysis",
    [ServiceType.PRESCRIPTION]: "Prescription & Medicine Delivery",
    [ServiceType.HOMECARE_HOURLY]: "In-Home Healthcare (Hourly)",
    [ServiceType.HOMECARE_DAILY]: "In-Home Healthcare (Daily)",
    [ServiceType.SUBSCRIPTION_MONTHLY]: "Ahava Premium Monthly Subscription",
    [ServiceType.SUBSCRIPTION_YEARLY]: "Ahava Premium Yearly Subscription",
  };
  return descriptions[serviceType];
}

