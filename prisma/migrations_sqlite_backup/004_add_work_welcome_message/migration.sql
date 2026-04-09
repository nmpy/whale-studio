-- Migration: 004_add_work_welcome_message
-- Add welcome_message column to works table.
-- This optional field stores the greeting text shown to users who have not
-- started the scenario yet. Falls back to a system default when NULL.

ALTER TABLE "works" ADD COLUMN "welcome_message" TEXT;
