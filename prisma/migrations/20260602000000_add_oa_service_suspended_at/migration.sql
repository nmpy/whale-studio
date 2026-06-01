-- AlterTable
ALTER TABLE "oas" ADD COLUMN "service_suspended_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "oas_service_suspended_at_idx" ON "oas"("service_suspended_at");
