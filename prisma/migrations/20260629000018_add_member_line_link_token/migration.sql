-- CreateTable: 会員 LINE 連携ワンタイムトークン（hash 保存・期限付き・one-time）
CREATE TABLE "member_line_link_tokens" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "workspace_member_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_line_link_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_line_link_tokens_token_hash_key" ON "member_line_link_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "member_line_link_tokens_oa_id_idx" ON "member_line_link_tokens"("oa_id");

-- CreateIndex
CREATE INDEX "member_line_link_tokens_expires_at_idx" ON "member_line_link_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "member_line_link_tokens" ADD CONSTRAINT "member_line_link_tokens_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: 同一 OA 内で同じ line_user_id を複数メンバーに紐づけない（NULL は区別＝未設定は重複可）
CREATE UNIQUE INDEX "workspace_members_workspace_id_line_user_id_key" ON "workspace_members"("workspace_id", "line_user_id");
