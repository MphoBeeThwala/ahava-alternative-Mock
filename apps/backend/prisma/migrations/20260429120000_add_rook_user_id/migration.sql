-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "rookUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_rookUserId_key" ON "users"("rookUserId");
