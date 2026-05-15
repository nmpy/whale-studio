-- 人狼 / 配役閲覧モード Phase 1 — DB 構造のみ。
--
-- 追加対象テーブル:
--   - werewolf_titles      : 1 ゲーム単位 (LiffPageConfig 配下に複数)
--   - werewolf_role_slots  : 1 タイトルに対する 1 プレイヤー分のスロット (QR の単位)
--   - werewolf_role_cards  : 1 スロットに並ぶ配役カード (複数枚 OK)
--
-- 既存データ:
--   既存 LIFF / Work データは触らない。完全に additive な migration。
--   pageType = "werewolf" の LiffPageConfig が作られると配下に Title 群を持てるようになる。
--
-- スコープ外 (将来):
--   閲覧ログ / LINE UID 紐付け / QR 一度きり制限 などのテーブルはこの migration には含まない。

-- ── werewolf_titles ──────────────────────────────────────
CREATE TABLE "werewolf_titles" (
  "id"                   TEXT NOT NULL PRIMARY KEY,
  -- 10 文字短縮 ID。既存 works/locations/liff_page_configs と同じ PG 関数を流用。
  "public_id"            TEXT NOT NULL DEFAULT gen_unique_public_id('werewolf_titles'::text),
  "liff_page_config_id"  TEXT NOT NULL,
  "work_id"              TEXT NOT NULL,
  "title"                TEXT NOT NULL,
  "description"          TEXT,
  "scheduled_at"         TIMESTAMP(3),
  "player_count"         INTEGER NOT NULL DEFAULT 0,
  "is_started"           BOOLEAN NOT NULL DEFAULT FALSE,
  "started_at"           TIMESTAMP(3),
  "sort_order"           INTEGER NOT NULL DEFAULT 0,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "werewolf_titles_liff_page_config_id_fkey"
    FOREIGN KEY ("liff_page_config_id") REFERENCES "liff_page_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "werewolf_titles_work_id_fkey"
    FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "werewolf_titles_public_id_key" ON "werewolf_titles"("public_id");
CREATE INDEX "werewolf_titles_liff_page_config_id_idx" ON "werewolf_titles"("liff_page_config_id");
CREATE INDEX "werewolf_titles_work_id_idx" ON "werewolf_titles"("work_id");
CREATE INDEX "werewolf_titles_scheduled_at_idx" ON "werewolf_titles"("scheduled_at");


-- ── werewolf_role_slots ──────────────────────────────────
CREATE TABLE "werewolf_role_slots" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "title_id"     TEXT NOT NULL,
  "slot_number"  INTEGER NOT NULL,
  "label"        TEXT,
  -- QR / URL 用の opaque な短縮トークン。10 文字 (a-z + 0-9)。
  -- 既存の gen_unique_public_id() を流用するので、works/locations/liff_page_configs
  -- と同じ衝突しない名前空間で発番される。
  "token"        TEXT NOT NULL DEFAULT gen_unique_public_id('werewolf_role_slots'::text),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "werewolf_role_slots_title_id_fkey"
    FOREIGN KEY ("title_id") REFERENCES "werewolf_titles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "werewolf_role_slots_token_key" ON "werewolf_role_slots"("token");
-- 1 タイトル内で slot_number 重複を禁止
CREATE UNIQUE INDEX "werewolf_role_slots_title_id_slot_number_key"
  ON "werewolf_role_slots"("title_id", "slot_number");
CREATE INDEX "werewolf_role_slots_title_id_idx" ON "werewolf_role_slots"("title_id");


-- ── werewolf_role_cards ──────────────────────────────────
CREATE TABLE "werewolf_role_cards" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "slot_id"      TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "subtitle"     TEXT,
  "badge_label"  TEXT,
  "body"         TEXT NOT NULL,
  "sort_order"   INTEGER NOT NULL DEFAULT 0,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "werewolf_role_cards_slot_id_fkey"
    FOREIGN KEY ("slot_id") REFERENCES "werewolf_role_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "werewolf_role_cards_slot_id_idx" ON "werewolf_role_cards"("slot_id");
