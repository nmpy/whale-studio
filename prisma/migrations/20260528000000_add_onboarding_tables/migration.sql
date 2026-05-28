-- CreateEnum
CREATE TYPE "OaOnboardingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "terms_acceptances" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "terms_version" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terms_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "terms_acceptances_user_id_idx" ON "terms_acceptances"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "terms_acceptances_user_id_terms_version_key" ON "terms_acceptances"("user_id", "terms_version");

-- CreateTable
CREATE TABLE "oa_onboarding_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "oa_id" TEXT,
    "status" "OaOnboardingStatus" NOT NULL DEFAULT 'DRAFT',
    "oa_name" TEXT,
    "channel_id" TEXT,
    "channel_secret" TEXT,
    "channel_access_token" TEXT,
    "basic_id" TEXT,
    "liff_id" TEXT,
    "permission_url" TEXT,
    "submitted_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oa_onboarding_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oa_onboarding_requests_user_id_idx" ON "oa_onboarding_requests"("user_id");

-- CreateIndex
CREATE INDEX "oa_onboarding_requests_status_idx" ON "oa_onboarding_requests"("status");
