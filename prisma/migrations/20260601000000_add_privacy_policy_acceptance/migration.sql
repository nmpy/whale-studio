-- CreateTable
CREATE TABLE "privacy_policy_acceptances" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "privacy_policy_version" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_policy_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "privacy_policy_acceptances_user_id_privacy_policy_version_key" ON "privacy_policy_acceptances"("user_id", "privacy_policy_version");

-- CreateIndex
CREATE INDEX "privacy_policy_acceptances_user_id_idx" ON "privacy_policy_acceptances"("user_id");

-- CreateIndex
CREATE INDEX "privacy_policy_acceptances_accepted_at_idx" ON "privacy_policy_acceptances"("accepted_at");
