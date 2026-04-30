-- CreateTable
CREATE TABLE "beacon_triggers" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT,
    "name" TEXT NOT NULL,
    "hwid" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "event_types" TEXT NOT NULL DEFAULT 'enter',
    "cooldown_seconds" INTEGER NOT NULL DEFAULT 300,
    "action_type" TEXT NOT NULL,
    "action_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beacon_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beacon_event_logs" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT,
    "beacon_trigger_id" TEXT,
    "line_user_id" TEXT,
    "hwid" TEXT NOT NULL,
    "beacon_type" TEXT NOT NULL,
    "device_message" TEXT,
    "webhook_event_id" TEXT NOT NULL,
    "is_redelivery" BOOLEAN NOT NULL DEFAULT false,
    "action_status" TEXT NOT NULL,
    "error_message" TEXT,
    "raw_event" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "beacon_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "beacon_triggers_oa_id_hwid_key" ON "beacon_triggers"("oa_id", "hwid");

-- CreateIndex
CREATE INDEX "beacon_triggers_oa_id_idx" ON "beacon_triggers"("oa_id");

-- CreateIndex
CREATE INDEX "beacon_triggers_work_id_idx" ON "beacon_triggers"("work_id");

-- CreateIndex
CREATE UNIQUE INDEX "beacon_event_logs_webhook_event_id_key" ON "beacon_event_logs"("webhook_event_id");

-- CreateIndex
CREATE INDEX "beacon_event_logs_oa_id_hwid_idx" ON "beacon_event_logs"("oa_id", "hwid");

-- CreateIndex
CREATE INDEX "beacon_event_logs_line_user_id_idx" ON "beacon_event_logs"("line_user_id");

-- CreateIndex
CREATE INDEX "beacon_event_logs_created_at_idx" ON "beacon_event_logs"("created_at");

-- AddForeignKey
ALTER TABLE "beacon_event_logs" ADD CONSTRAINT "beacon_event_logs_beacon_trigger_id_fkey" FOREIGN KEY ("beacon_trigger_id") REFERENCES "beacon_triggers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
