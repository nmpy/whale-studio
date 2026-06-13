-- LINE Beacon 強化: BeaconTrigger / BeaconEventLog に運用フィールドを追加。
-- すべて ADD COLUMN（DEFAULT 付き / NULL 許容）で非破壊。既存行・既存挙動に影響しない。

-- AlterTable: beacon_triggers
ALTER TABLE "beacon_triggers"
  ADD COLUMN "once_per_user" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "max_triggers_per_user" INTEGER,
  ADD COLUMN "valid_from" TIMESTAMP(3),
  ADD COLUMN "valid_to" TIMESTAMP(3),
  ADD COLUMN "note" TEXT;

-- AlterTable: beacon_event_logs
ALTER TABLE "beacon_event_logs"
  ADD COLUMN "message_id" TEXT,
  ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;
