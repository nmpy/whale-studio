-- β版 / 7日トライアルの内部状態を追加。
-- grant_type: null=通常/Stripe / "beta"=β版(無期限Pro Max相当) / "trial"=7日トライアル
-- trial_ends_at: トライアル終了日時 (trial のみ)。feature gate の期限判定はこれを正とする。
-- Stripe には一切連動しない（externalId 有のサブスクは変更対象外）。

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "grant_type" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "trial_ends_at" TIMESTAMP(3);

-- Data migration 1: 既存の個人利用 OA（externalId=null = Stripe 非連動）の subscription を β版化。
-- Stripe 連動中（external_id IS NOT NULL）は絶対に変更しない。
UPDATE "subscriptions" s
SET "status" = 'active',
    "grant_type" = 'beta',
    "trial_ends_at" = NULL,
    "plan_id" = (SELECT id FROM "plans" WHERE name = 'pro' LIMIT 1)
WHERE s."external_id" IS NULL
  AND s."oa_id" IN (SELECT id FROM "oas" WHERE "usage_type" = 'personal')
  AND (SELECT id FROM "plans" WHERE name = 'pro' LIMIT 1) IS NOT NULL;

-- Data migration 2: subscription が無い個人利用 OA にも β版 subscription を起票。
-- （既存ユーザーに突然制限がかからないよう、漏れなく β版扱いにする）
INSERT INTO "subscriptions"
  ("id", "oa_id", "plan_id", "status", "grant_type", "trial_ends_at",
   "current_period_start", "current_period_end", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  o."id",
  (SELECT id FROM "plans" WHERE name = 'pro' LIMIT 1),
  'active',
  'beta',
  NULL,
  now(),
  now() + interval '100 years',  -- β版は期限を見ないためのプレースホルダ
  now(),
  now()
FROM "oas" o
WHERE o."usage_type" = 'personal'
  AND (SELECT id FROM "plans" WHERE name = 'pro' LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."oa_id" = o."id");
