/**
 * Worker Type Definitions
 * Extends Hono context with auth and user types
 */

import type { Context } from "hono";
import type { Auth } from "@/lib/auth";

export interface Env {
  DB: D1Database;
  MEDICAL_IMAGES_BUCKET?: R2Bucket;
  PUBLIC_BUCKET_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_URL?: string;
  GEMINI_API_KEY?: string;
  VITE_AURA_API_URL?: string;
  VITE_AURA_API_KEY?: string;
  PAYFAST_MERCHANT_ID?: string;
  PAYFAST_MERCHANT_KEY?: string;
  PAYFAST_PASSPHRASE?: string;
  PAYFAST_SANDBOX?: string;
  SMS_PROVIDER?: string;
  SMS_AT_API_KEY?: string;
  SMS_AT_USERNAME?: string;
  SMS_AT_FROM?: string;
  SMS_TWILIO_ACCOUNT_SID?: string;
  SMS_TWILIO_AUTH_TOKEN?: string;
  SMS_TWILIO_FROM?: string;
  SMS_CLICKATELL_API_KEY?: string;
  SMS_CLICKATELL_FROM?: string;
  DEV_TEST_TOKEN?: string;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: Auth;
    user: {
      id: string;
      email: string;
      name: string;
      emailVerified: boolean;
      createdAt: Date;
    };
    userRole?: string;
  }
}

