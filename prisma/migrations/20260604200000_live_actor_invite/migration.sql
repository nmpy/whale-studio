-- Phase 2-J: 演者招待 URL を管理する LiveActorInvite テーブル。
-- 平文 token は保存せず、sha256 hex を tokenHash として保存する。
-- 有効性は (expiresAt > now()) AND (usedAt IS NULL) AND (revokedAt IS NULL) で判定。

CREATE TABLE "live_actor_invites" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_actor_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "live_actor_invites_token_hash_key" ON "live_actor_invites"("token_hash");
CREATE INDEX "live_actor_invites_oa_id_actor_id_created_at_idx" ON "live_actor_invites"("oa_id", "actor_id", "created_at");
CREATE INDEX "live_actor_invites_actor_id_revoked_at_used_at_idx" ON "live_actor_invites"("actor_id", "revoked_at", "used_at");

ALTER TABLE "live_actor_invites" ADD CONSTRAINT "live_actor_invites_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_actor_invites" ADD CONSTRAINT "live_actor_invites_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "live_actors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
