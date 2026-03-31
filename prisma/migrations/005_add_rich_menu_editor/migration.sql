-- prisma/migrations/005_add_rich_menu_editor/migration.sql
-- RichMenu と RichMenuArea テーブルを追加

CREATE TABLE "rich_menus" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "oa_id"            TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "chat_bar_text"    TEXT NOT NULL DEFAULT 'メニュー',
  "size"             TEXT NOT NULL DEFAULT 'compact',
  "image_url"        TEXT,
  "line_rich_menu_id" TEXT,
  "is_active"        INTEGER NOT NULL DEFAULT 1,
  "created_at"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rich_menus_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "rich_menus_oa_id_idx"     ON "rich_menus"("oa_id");
CREATE INDEX "rich_menus_is_active_idx" ON "rich_menus"("is_active");

CREATE TABLE "rich_menu_areas" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "rich_menu_id" TEXT NOT NULL,
  "x"            INTEGER NOT NULL DEFAULT 0,
  "y"            INTEGER NOT NULL DEFAULT 0,
  "width"        INTEGER NOT NULL DEFAULT 833,
  "height"       INTEGER NOT NULL DEFAULT 843,
  "action_type"  TEXT NOT NULL DEFAULT 'message',
  "action_label" TEXT NOT NULL DEFAULT '',
  "action_text"  TEXT,
  "action_data"  TEXT,
  "action_uri"   TEXT,
  "sort_order"   INTEGER NOT NULL DEFAULT 0,
  "created_at"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rich_menu_areas_rich_menu_id_fkey" FOREIGN KEY ("rich_menu_id") REFERENCES "rich_menus" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "rich_menu_areas_rich_menu_id_idx" ON "rich_menu_areas"("rich_menu_id");
CREATE INDEX "rich_menu_areas_sort_order_idx"   ON "rich_menu_areas"("sort_order");
