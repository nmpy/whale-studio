-- CreateTable
CREATE TABLE "friend_add_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "oa_id" TEXT NOT NULL UNIQUE,
    "campaign_name" TEXT,
    "add_url" TEXT NOT NULL,
    "qr_code_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "friend_add_settings_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sns_posts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "oa_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "image_url" TEXT,
    "target_url" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "sns_posts_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "sns_posts_oa_id_idx" ON "sns_posts"("oa_id");
CREATE INDEX "sns_posts_order_idx" ON "sns_posts"("order");
