/**
 * Cover for the payment path. The signature assertions fail against the
 * pre-fix implementation, which built the payment-request signature in a
 * pipe-delimited format and then discarded it.
 */
import crypto from "crypto";
import { PayFastService } from "./payfast";

const MERCHANT_ID = "10000100";
const MERCHANT_KEY = "46f0cd694581a";
const PASSPHRASE = "test-passphrase";

function encodeForSignature(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/%[0-9a-f]{2}/g, (m) => m.toUpperCase());
}

/** Independent reimplementation of PayFast's ITN signature, as a cross-check. */
function itnSignature(fields: Record<string, string>, passphrase: string): string {
  const parts = Object.keys(fields)
    .filter((k) => k !== "signature")
    .filter((k) => fields[k] !== undefined && fields[k] !== "")
    .map((k) => `${k}=${encodeForSignature(fields[k])}`);
  let s = parts.join("&");
  if (passphrase) s += `&passphrase=${encodeForSignature(passphrase)}`;
  return crypto.createHash("md5").update(s).digest("hex");
}

const ENV_KEYS = [
  "PAYFAST_MERCHANT_ID",
  "PAYFAST_MERCHANT_KEY",
  "PAYFAST_PASSPHRASE",
  "PAYFAST_SANDBOX",
  "APP_URL",
  "API_PUBLIC_URL",
] as const;

describe("PayFastService", () => {
  const original: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) original[key] = process.env[key];

  beforeEach(() => {
    process.env.PAYFAST_MERCHANT_ID = MERCHANT_ID;
    process.env.PAYFAST_MERCHANT_KEY = MERCHANT_KEY;
    process.env.PAYFAST_PASSPHRASE = PASSPHRASE;
    process.env.PAYFAST_SANDBOX = "true";
    process.env.APP_URL = "https://app.example.test";
    process.env.API_PUBLIC_URL = "https://api.example.test";
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  describe("createPayment", () => {
    it("signs the checkout payload", async () => {
      const service = new PayFastService();
      const { data } = await service.createPayment(25000, "Nurse Visit", "AHV-abc");

      expect(data.signature).toMatch(/^[0-9a-f]{32}$/);
    });

    it("converts cents to a two-decimal rand amount", async () => {
      const service = new PayFastService();
      const { data } = await service.createPayment(25000, "Nurse Visit", "AHV-abc");

      expect(data.amount).toBe("250.00");
    });

    it("sends the ITN to the API, not the frontend proxy", async () => {
      const service = new PayFastService();
      const { data } = await service.createPayment(25000, "Nurse Visit", "AHV-abc");

      expect(data.notify_url).toBe("https://api.example.test/api/payments/webhook");
    });

    it("uses the sandbox endpoint when configured", async () => {
      const service = new PayFastService();
      const { url } = await service.createPayment(1000, "Nurse Visit", "AHV-abc");

      expect(url).toBe("https://sandbox.payfast.co.za/eng/process");
    });

    it("rejects a non-positive amount", async () => {
      const service = new PayFastService();
      await expect(service.createPayment(0, "Nurse Visit", "AHV-abc")).rejects.toThrow(
        /positive integer/,
      );
    });

    it("rejects a fractional cent amount", async () => {
      const service = new PayFastService();
      await expect(service.createPayment(10.5, "Nurse Visit", "AHV-abc")).rejects.toThrow(
        /positive integer/,
      );
    });

    it("refuses to build a payload when unconfigured", async () => {
      process.env.PAYFAST_MERCHANT_ID = "";
      const service = new PayFastService();
      await expect(service.createPayment(1000, "Nurse Visit", "AHV-abc")).rejects.toThrow(
        /not configured/,
      );
    });
  });

  describe("verifyPayment", () => {
    const baseFields: Record<string, string> = {
      m_payment_id: "AHV-abc",
      pf_payment_id: "1089250",
      payment_status: "COMPLETE",
      item_name: "Nurse Visit",
      amount_gross: "250.00",
      amount_fee: "-5.75",
      amount_net: "244.25",
      merchant_id: MERCHANT_ID,
    };

    it("accepts a correctly signed notification", async () => {
      const service = new PayFastService();
      const data = { ...baseFields, signature: itnSignature(baseFields, PASSPHRASE) };

      await expect(service.verifyPayment(data)).resolves.toBe(true);
    });

    it("rejects a notification whose amount was altered after signing", async () => {
      const service = new PayFastService();
      const signature = itnSignature(baseFields, PASSPHRASE);
      const data = { ...baseFields, amount_gross: "1.00", signature };

      await expect(service.verifyPayment(data)).resolves.toBe(false);
    });

    it("rejects a notification signed with the wrong passphrase", async () => {
      const service = new PayFastService();
      const data = { ...baseFields, signature: itnSignature(baseFields, "wrong") };

      await expect(service.verifyPayment(data)).resolves.toBe(false);
    });

    it("rejects a notification with no signature", async () => {
      const service = new PayFastService();

      await expect(service.verifyPayment({ ...baseFields })).resolves.toBe(false);
    });

    it("handles values needing urlencoding", async () => {
      const service = new PayFastService();
      const fields = { ...baseFields, item_name: "Nurse Visit & Follow-up" };
      const data = { ...fields, signature: itnSignature(fields, PASSPHRASE) };

      await expect(service.verifyPayment(data)).resolves.toBe(true);
    });
  });
});
