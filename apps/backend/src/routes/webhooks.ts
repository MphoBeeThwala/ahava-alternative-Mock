import { Router } from "express";
import { PaymentStatus } from "@prisma/client";
import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { notifyPaymentReceipt } from "../services/notifications";
import { handleTerraWebhook } from "./terra";
import { handleRookWebhook } from "./rook";
import { webhookRateLimiter } from "../middleware/rateLimiter";
import { createAuditLog } from "../services/auditLog";
import prisma from "../lib/prisma";

const router: Router = Router();

/**
 * Verify a Paystack webhook signature (HMAC SHA512 over the raw body).
 * Fails closed in production when PAYSTACK_SECRET_KEY is not configured.
 */
function verifyPaystackSignature(req: Request): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") return false;
    // Non-production: allow unsigned test webhooks
    return true;
  }
  const signature = req.headers["x-paystack-signature"] as string | undefined;
  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (!signature || !rawBody) return false;

  const expected = crypto
    .createHmac("sha512", secret)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(signature.toLowerCase(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Payment webhook (e.g. Paystack: event=charge.success, data.reference=paystack_reference)
router.post(
  "/payment",
  webhookRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!verifyPaystackSignature(req)) {
        await createAuditLog({
          userId: null,
          userRole: undefined,
          action: "UPDATE",
          resource: "Payment",
          metadata: { event: "WEBHOOK_SIGNATURE_INVALID", provider: "paystack" },
          ipAddress: req.ip,
          userAgent: req.get("User-Agent"),
        }).catch(() => undefined);
        return res.status(401).json({ error: "Invalid signature" });
      }

      const event = req.body?.event as string | undefined;
      const reference = req.body?.data?.reference as string | undefined;

      if (event === "charge.success" && reference) {
        const payment = await prisma.payment.findFirst({
          where: { paystackReference: reference },
          include: {
            visit: {
              include: {
                booking: {
                  include: {
                    patient: {
                      select: { email: true, firstName: true, lastName: true },
                    },
                  },
                },
              },
            },
          },
        });

        if (payment && payment.status !== PaymentStatus.COMPLETED) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.COMPLETED, paystackData: req.body },
          });
          await createAuditLog({
            userId: null,
            userRole: undefined,
            action: "PAYMENT_COMPLETED",
            resource: "Payment",
            resourceId: payment.id,
            metadata: {
              provider: "paystack",
              reference,
              amountInCents: payment.amountInCents,
              currency: payment.currency,
            },
            ipAddress: req.ip,
            userAgent: req.get("User-Agent"),
          }).catch(() => undefined);
          const patient = payment.visit?.booking?.patient;
          if (patient?.email) {
            await notifyPaymentReceipt({
              to: patient.email,
              recipientName: `${patient.firstName} ${patient.lastName}`,
              amountCents: payment.amountInCents,
              currency: payment.currency,
              paymentId: payment.id,
              description: "Visit payment",
            });
          }
        }
      }

      res.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

// Terra wearable data webhook
router.post("/terra", webhookRateLimiter, handleTerraWebhook);

// ROOK wearable data webhook
router.post("/rook", webhookRateLimiter, handleRookWebhook);

// List webhook events (for debugging; optional)
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, events: [] });
  } catch (error) {
    next(error);
  }
});

export default router;
