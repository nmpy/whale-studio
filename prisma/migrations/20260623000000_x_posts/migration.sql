-- X投稿管理（PR1）: 新規テーブルのみ・additive。既存テーブル/データは無変更。
-- x_posts: 作品単位の X 告知ポスト + UTM + 計測URL。
-- x_post_click_events: 計測URL(/r/[code]) のクリックログ（IP は hash 保存）。

CREATE TABLE "x_posts" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "hashtags" TEXT,
    "image_url" TEXT,
    "uploaded_image_url" TEXT,
    "link_url" TEXT,
    "utm_enabled" BOOLEAN NOT NULL DEFAULT false,
    "utm_name" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "utm_term" TEXT,
    "generated_url" TEXT,
    "tracking_code" TEXT,
    "tracking_url" TEXT,
    "x_post_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "note" TEXT,
    "posted_at" TIMESTAMP(3),
    "scheduled_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "x_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "x_post_click_events" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "x_post_id" TEXT NOT NULL,
    "tracking_code" TEXT NOT NULL,
    "destination_url" TEXT NOT NULL,
    "referer" TEXT,
    "user_agent" TEXT,
    "ip_hash" TEXT,
    "clicked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "x_post_click_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "x_posts_tracking_code_key" ON "x_posts"("tracking_code");
CREATE INDEX "x_posts_oa_id_idx" ON "x_posts"("oa_id");
CREATE INDEX "x_posts_work_id_idx" ON "x_posts"("work_id");
CREATE INDEX "x_posts_tracking_code_idx" ON "x_posts"("tracking_code");

CREATE INDEX "x_post_click_events_oa_id_idx" ON "x_post_click_events"("oa_id");
CREATE INDEX "x_post_click_events_work_id_idx" ON "x_post_click_events"("work_id");
CREATE INDEX "x_post_click_events_x_post_id_idx" ON "x_post_click_events"("x_post_id");
CREATE INDEX "x_post_click_events_tracking_code_idx" ON "x_post_click_events"("tracking_code");

ALTER TABLE "x_posts" ADD CONSTRAINT "x_posts_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "x_posts" ADD CONSTRAINT "x_posts_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "x_post_click_events" ADD CONSTRAINT "x_post_click_events_x_post_id_fkey" FOREIGN KEY ("x_post_id") REFERENCES "x_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
