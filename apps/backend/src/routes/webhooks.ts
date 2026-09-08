import { Router } from "express";
import { Request, Response, NextFunction } from "express";
import { handleTerraWebhook } from "./terra";
import { handleRookWebhook } from "./rook";
import { webhookRateLimiter } from "../middleware/rateLimiter";

const router: Router = Router();

// AH-20 follow-up: this file used to also carry a Paystack "POST /payment"
// webhook (event=charge.success) left over from before the PayFast
// migration. It is removed, not just renamed, because it was a live,
// unauthenticated second path to mark a Payment COMPLETED with none of the
// PayFast ITN handler's checks (routes/payments.ts POST /webhook — source
// IP, PayFast's server-to-server confirmation, amount matching). Worse: its
// signature check failed *open* whenever NODE_ENV wasn't exactly
// "production" and PAYSTACK_SECRET_KEY was unset (the deployed default,
// since env.example never documents that var) — any POST with a guessed or
// enumerated payfastReference would complete that payment. PayFast is the
// only payment gateway in this codebase; there is nothing this route was
// still needed for.

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
