-- メールアドレス不要の「招待URL」(MemberInvite)。既存 Invitation(メール招待)とは別系統。
-- 完全 additive: 新規テーブルのみ。既存コード未参照のため本番先行適用で無停止・安全。
-- token は平文を保存せず token_hash(sha256 hex)のみ。

CREATE TABLE "member_invites" (
    "id"                  TEXT NOT NULL,
    "oa_id"               TEXT NOT NULL,
    "role"                "MemberRole" NOT NULL DEFAULT 'viewer',
    "token_hash"          TEXT NOT NULL,
    "created_by_user_id"  TEXT NOT NULL,
    "accepted_by_user_id" TEXT,
    "accepted_at"         TIMESTAMP(3),
    "revoked_at"          TIMESTAMP(3),
    "expires_at"          TIMESTAMP(3),
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "member_invites_token_hash_key" ON "member_invites"("token_hash");
CREATE INDEX "member_invites_oa_id_idx" ON "member_invites"("oa_id");
CREATE INDEX "member_invites_token_hash_idx" ON "member_invites"("token_hash");
CREATE INDEX "member_invites_expires_at_idx" ON "member_invites"("expires_at");

ALTER TABLE "member_invites" ADD CONSTRAINT "member_invites_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
