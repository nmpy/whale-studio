-- CreateTable: 分析除外ユーザー（OA 単位・元データは削除せず集計時に除外）
CREATE TABLE "analytics_excluded_users" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "line_user_id" TEXT NOT NULL,
    "member_user_id" TEXT,
    "display_name" TEXT,
    "note" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_excluded_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_excluded_users_oa_id_idx" ON "analytics_excluded_users"("oa_id");

-- CreateIndex
CREATE INDEX "analytics_excluded_users_oa_id_member_user_id_idx" ON "analytics_excluded_users"("oa_id", "member_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_excluded_users_oa_id_line_user_id_key" ON "analytics_excluded_users"("oa_id", "line_user_id");

-- AddForeignKey
ALTER TABLE "analytics_excluded_users" ADD CONSTRAINT "analytics_excluded_users_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: 管理ユーザー↔LINE UID の永続紐づけ（分析除外用・nullable・既存行に影響なし）
ALTER TABLE "workspace_members" ADD COLUMN "line_user_id" TEXT;
