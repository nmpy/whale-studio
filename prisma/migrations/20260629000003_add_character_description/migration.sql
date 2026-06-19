-- Add optional (nullable) description to characters.
-- Additive only: nullable column, no default, no backfill, no destructive change.
-- AlterTable
ALTER TABLE "characters" ADD COLUMN "description" TEXT;
