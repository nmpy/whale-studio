-- 同意ログ（監査用・追記型）: 利用規約 / プライバシーポリシー同意を記録する新規テーブル。
-- additive のみ（CREATE TABLE + INDEX）。既存テーブル・データは無変更。FK は張らない（他同意系テーブルと同方針）。

CREATE TABLE "user_consent_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "consent_type" TEXT NOT NULL,
    "document_version" TEXT,
    "document_url" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "agreed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_consent_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_consent_logs_user_id_idx" ON "user_consent_logs"("user_id");
CREATE INDEX "user_consent_logs_consent_type_idx" ON "user_consent_logs"("consent_type");
CREATE INDEX "user_consent_logs_agreed_at_idx" ON "user_consent_logs"("agreed_at");

-- 同一 (user_id, consent_type, document_version) は 1 行に制限（DB レベルで重複防止）。
-- 新規テーブルのため既存データへの影響なし。
CREATE UNIQUE INDEX "user_consent_logs_user_id_consent_type_document_version_key" ON "user_consent_logs"("user_id", "consent_type", "document_version");
