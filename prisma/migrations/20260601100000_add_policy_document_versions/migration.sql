-- CreateEnum
CREATE TYPE "PolicyDocumentType" AS ENUM ('TERMS', 'PRIVACY_POLICY');

-- CreateTable
CREATE TABLE "policy_document_versions" (
    "id" TEXT NOT NULL,
    "type" "PolicyDocumentType" NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "last_updated" TEXT,
    "effective_at" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "policy_document_versions_type_version_key" ON "policy_document_versions"("type", "version");

-- CreateIndex
CREATE INDEX "policy_document_versions_type_is_published_idx" ON "policy_document_versions"("type", "is_published");

-- CreateIndex
CREATE INDEX "policy_document_versions_published_at_idx" ON "policy_document_versions"("published_at");
