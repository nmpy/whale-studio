-- prisma/migrations/001_init/migration.sql
-- LINE謎解きBot MVP — 初期マイグレーション（SQLite 互換版）
--
-- ローカル開発は `npm run db:push` で自動生成されるため
-- このファイルを手動実行する必要はありません。
-- PostgreSQL 本番移行時は `prisma migrate dev` で自動生成してください。

-- ────────────────────────────────────────────────
-- OAs
-- （SQLite: enums は TEXT として保存）
-- ────────────────────────────────────────────────
CREATE TABLE "oas" (
  "id"                   TEXT        NOT NULL PRIMARY KEY,
  "title"                TEXT        NOT NULL,
  "description"          TEXT,
  "channel_id"           TEXT        NOT NULL,
  "channel_secret"       TEXT        NOT NULL,
  "channel_access_token" TEXT        NOT NULL,
  "publish_status"       TEXT        NOT NULL DEFAULT 'draft',
  "created_at"           DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "oas_title_idx"          ON "oas" ("title");
CREATE INDEX "oas_publish_status_idx" ON "oas" ("publish_status");
CREATE INDEX "oas_created_at_idx"     ON "oas" ("created_at");

-- ────────────────────────────────────────────────
-- Characters
-- ────────────────────────────────────────────────
CREATE TABLE "characters" (
  "id"             TEXT     NOT NULL PRIMARY KEY,
  "oa_id"          TEXT     NOT NULL,
  "name"           TEXT     NOT NULL,
  "icon_type"      TEXT     NOT NULL DEFAULT 'text',
  "icon_text"      TEXT,
  "icon_image_url" TEXT,
  "icon_color"     TEXT,
  "sort_order"     INTEGER  NOT NULL DEFAULT 0,
  "is_active"      BOOLEAN  NOT NULL DEFAULT 1,
  "created_at"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY ("oa_id") REFERENCES "oas" ("id") ON DELETE CASCADE
);

CREATE INDEX "characters_oa_id_idx"      ON "characters" ("oa_id");
CREATE INDEX "characters_name_idx"       ON "characters" ("name");
CREATE INDEX "characters_sort_order_idx" ON "characters" ("sort_order");
CREATE INDEX "characters_is_active_idx"  ON "characters" ("is_active");

-- ────────────────────────────────────────────────
-- Phases
-- ────────────────────────────────────────────────
CREATE TABLE "phases" (
  "id"          TEXT     NOT NULL PRIMARY KEY,
  "oa_id"       TEXT     NOT NULL,
  "name"        TEXT     NOT NULL,
  "description" TEXT,
  "sort_order"  INTEGER  NOT NULL DEFAULT 0,
  "is_active"   BOOLEAN  NOT NULL DEFAULT 1,
  "created_at"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY ("oa_id") REFERENCES "oas" ("id") ON DELETE CASCADE
);

CREATE INDEX "phases_oa_id_idx"      ON "phases" ("oa_id");
CREATE INDEX "phases_name_idx"       ON "phases" ("name");
CREATE INDEX "phases_sort_order_idx" ON "phases" ("sort_order");
CREATE INDEX "phases_is_active_idx"  ON "phases" ("is_active");

-- ────────────────────────────────────────────────
-- Messages
-- ────────────────────────────────────────────────
CREATE TABLE "messages" (
  "id"           TEXT     NOT NULL PRIMARY KEY,
  "oa_id"        TEXT     NOT NULL,
  "phase_id"     TEXT,
  "character_id" TEXT,
  "message_type" TEXT     NOT NULL DEFAULT 'text',
  "body"         TEXT,
  "asset_url"    TEXT,
  "sort_order"   INTEGER  NOT NULL DEFAULT 0,
  "is_active"    BOOLEAN  NOT NULL DEFAULT 1,
  "created_at"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY ("oa_id")        REFERENCES "oas"        ("id") ON DELETE CASCADE,
  FOREIGN KEY ("phase_id")     REFERENCES "phases"     ("id") ON DELETE SET NULL,
  FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE SET NULL
);

CREATE INDEX "messages_oa_id_idx"        ON "messages" ("oa_id");
CREATE INDEX "messages_phase_id_idx"     ON "messages" ("phase_id");
CREATE INDEX "messages_character_id_idx" ON "messages" ("character_id");
CREATE INDEX "messages_message_type_idx" ON "messages" ("message_type");
CREATE INDEX "messages_sort_order_idx"   ON "messages" ("sort_order");
CREATE INDEX "messages_is_active_idx"    ON "messages" ("is_active");

-- ────────────────────────────────────────────────
-- updated_at トリガー（SQLite 版）
-- Prisma の @updatedAt で JavaScript 側から更新するため、
-- ここのトリガーは参考実装です。db:push では不要です。
-- ────────────────────────────────────────────────
CREATE TRIGGER update_oas_updated_at
  AFTER UPDATE ON "oas"
  FOR EACH ROW
  BEGIN
    UPDATE "oas" SET "updated_at" = CURRENT_TIMESTAMP WHERE "id" = OLD."id";
  END;

CREATE TRIGGER update_characters_updated_at
  AFTER UPDATE ON "characters"
  FOR EACH ROW
  BEGIN
    UPDATE "characters" SET "updated_at" = CURRENT_TIMESTAMP WHERE "id" = OLD."id";
  END;

CREATE TRIGGER update_phases_updated_at
  AFTER UPDATE ON "phases"
  FOR EACH ROW
  BEGIN
    UPDATE "phases" SET "updated_at" = CURRENT_TIMESTAMP WHERE "id" = OLD."id";
  END;

CREATE TRIGGER update_messages_updated_at
  AFTER UPDATE ON "messages"
  FOR EACH ROW
  BEGIN
    UPDATE "messages" SET "updated_at" = CURRENT_TIMESTAMP WHERE "id" = OLD."id";
  END;
