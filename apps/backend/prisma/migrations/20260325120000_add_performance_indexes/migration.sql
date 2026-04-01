-- Add performance indexes for common query patterns
-- Safe to run multiple times (IF NOT EXISTS)

-- Refresh tokens
CREATE INDEX IF NOT EXISTS "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- Bookings
CREATE INDEX IF NOT EXISTS "bookings_patientId_idx" ON "bookings"("patientId");
CREATE INDEX IF NOT EXISTS "bookings_nurseId_idx" ON "bookings"("nurseId");
CREATE INDEX IF NOT EXISTS "bookings_doctorId_idx" ON "bookings"("doctorId");
CREATE INDEX IF NOT EXISTS "bookings_scheduledDate_idx" ON "bookings"("scheduledDate");
CREATE INDEX IF NOT EXISTS "bookings_paymentStatus_idx" ON "bookings"("paymentStatus");
CREATE INDEX IF NOT EXISTS "bookings_paystackReference_idx" ON "bookings"("paystackReference");

-- Visits
CREATE INDEX IF NOT EXISTS "visits_nurseId_idx" ON "visits"("nurseId");
CREATE INDEX IF NOT EXISTS "visits_doctorId_idx" ON "visits"("doctorId");
CREATE INDEX IF NOT EXISTS "visits_status_idx" ON "visits"("status");
CREATE INDEX IF NOT EXISTS "visits_createdAt_idx" ON "visits"("createdAt");

-- Messages
CREATE INDEX IF NOT EXISTS "messages_visitId_createdAt_idx" ON "messages"("visitId", "createdAt");
CREATE INDEX IF NOT EXISTS "messages_senderId_createdAt_idx" ON "messages"("senderId", "createdAt");
CREATE INDEX IF NOT EXISTS "messages_recipientId_createdAt_idx" ON "messages"("recipientId", "createdAt");

-- Payments
CREATE INDEX IF NOT EXISTS "payments_visitId_createdAt_idx" ON "payments"("visitId", "createdAt");
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments"("status");
CREATE INDEX IF NOT EXISTS "payments_paystackReference_idx" ON "payments"("paystackReference");
