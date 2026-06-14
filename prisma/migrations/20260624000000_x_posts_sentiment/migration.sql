-- X投稿管理 感情分析（PR3）: 新規テーブルのみ・additive。既存テーブル/データは無変更。
-- x_post_imported_metrics: CSV 取り込みの投稿実績（インプレッション等）。
-- x_imported_mentions: CSV 取り込みの口コミ（NLP 対象）。
-- x_imported_mention_analyses: 口コミの分析結果（1:1・ルールベース）。

CREATE TABLE "x_post_imported_metrics" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "x_post_id" TEXT,
    "x_post_url" TEXT,
    "x_post_external_id" TEXT,
    "post_title" TEXT,
    "posted_at" TIMESTAMP(3),
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "reposts" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "quotes" INTEGER NOT NULL DEFAULT 0,
    "bookmarks" INTEGER NOT NULL DEFAULT 0,
    "csv_url_clicks" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "x_post_imported_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "x_imported_mentions" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "related_x_post_id" TEXT,
    "related_x_post_url" TEXT,
    "posted_at" TIMESTAMP(3),
    "author_name" TEXT,
    "author_handle" TEXT,
    "text" TEXT NOT NULL,
    "text_hash" TEXT NOT NULL,
    "url" TEXT,
    "source" TEXT,
    "note" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "x_imported_mentions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "x_imported_mention_analyses" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "mention_id" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "sentiment_score" INTEGER,
    "repeat_intent" TEXT NOT NULL,
    "repeat_intent_score" INTEGER,
    "matched_keywords" TEXT,
    "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "x_imported_mention_analyses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "x_post_imported_metrics_oa_id_idx" ON "x_post_imported_metrics"("oa_id");
CREATE INDEX "x_post_imported_metrics_work_id_idx" ON "x_post_imported_metrics"("work_id");
CREATE INDEX "x_post_imported_metrics_x_post_id_idx" ON "x_post_imported_metrics"("x_post_id");

CREATE INDEX "x_imported_mentions_oa_id_idx" ON "x_imported_mentions"("oa_id");
CREATE INDEX "x_imported_mentions_work_id_idx" ON "x_imported_mentions"("work_id");
CREATE INDEX "x_imported_mentions_text_hash_idx" ON "x_imported_mentions"("text_hash");
CREATE INDEX "x_imported_mentions_related_x_post_id_idx" ON "x_imported_mentions"("related_x_post_id");

CREATE UNIQUE INDEX "x_imported_mention_analyses_mention_id_key" ON "x_imported_mention_analyses"("mention_id");
CREATE INDEX "x_imported_mention_analyses_oa_id_idx" ON "x_imported_mention_analyses"("oa_id");
CREATE INDEX "x_imported_mention_analyses_work_id_idx" ON "x_imported_mention_analyses"("work_id");

ALTER TABLE "x_post_imported_metrics" ADD CONSTRAINT "x_post_imported_metrics_x_post_id_fkey" FOREIGN KEY ("x_post_id") REFERENCES "x_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "x_imported_mentions" ADD CONSTRAINT "x_imported_mentions_related_x_post_id_fkey" FOREIGN KEY ("related_x_post_id") REFERENCES "x_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "x_imported_mention_analyses" ADD CONSTRAINT "x_imported_mention_analyses_mention_id_fkey" FOREIGN KEY ("mention_id") REFERENCES "x_imported_mentions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
