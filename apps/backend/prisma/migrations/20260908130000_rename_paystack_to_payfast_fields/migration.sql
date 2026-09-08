-- AH-20: this project uses PayFast, not Paystack. Rename in place rather
-- than add/drop, so existing reference and gateway-response data survives.

-- AlterTable: bookings
ALTER TABLE "bookings" RENAME COLUMN "paystackReference" TO "payfastReference";
ALTER INDEX "bookings_paystackReference_idx" RENAME TO "bookings_payfastReference_idx";

-- AlterTable: payments
ALTER TABLE "payments" RENAME COLUMN "paystackReference" TO "payfastReference";
ALTER TABLE "payments" RENAME COLUMN "paystackData" TO "payfastData";
ALTER INDEX "payments_paystackReference_idx" RENAME TO "payments_payfastReference_idx";
