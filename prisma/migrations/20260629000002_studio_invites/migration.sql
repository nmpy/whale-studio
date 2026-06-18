-- スタジオ管理から発行する「招待URL」(StudioInvite)。
-- MemberInvite(OA メンバー招待) / BusinessInviteLink(法人申込キュー) とは別系統の独立テーブル。
-- 完全 additive: 新規テーブルのみ。既存テーブル・既存データへの破壊的変更なし(本番先行適用で無停止・安全)。
-- token は平文を保存せず token_hash(sha256 hex)のみ。plan_tier は課金非連動の付与 snapshot(Stripe 非連動)。
-- 参照する enum "BusinessUsageType" / "MemberRole" は既存テーブルで使用済みのため新規作成は不要。

CREATE TABLE "studio_invites" (
    "id"                  TEXT NOT NULL,
    "oa_id"               TEXT NOT NULL,
    "usage_type"          "BusinessUsageType" NOT NULL,
    "plan_tier"           TEXT NOT NULL,
    "role"                "MemberRole" NOT NULL DEFAULT 'viewer',
    "token_hash"          TEXT NOT NULL,
    "note"                TEXT,
    "created_by_user_id"  TEXT NOT NULL,
    "accepted_by_user_id" TEXT,
    "accepted_at"         TIMESTAMP(3),
    "revoked_at"          TIMESTAMP(3),
    "expires_at"          TIMESTAMP(3) NOT NULL,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "studio_invites_token_hash_key" ON "studio_invites"("token_hash");
CREATE INDEX "studio_invites_oa_id_idx" ON "studio_invites"("oa_id");
CREATE INDEX "studio_invites_token_hash_idx" ON "studio_invites"("token_hash");
CREATE INDEX "studio_invites_expires_at_idx" ON "studio_invites"("expires_at");

ALTER TABLE "studio_invites" ADD CONSTRAINT "studio_invites_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
