-- X投稿管理 PR3 追補: 取り込み元の生データ保存用 raw_json を追加（additive・nullable）。
-- X投稿エクスポート形式の元データ（mentions / hashtags / media / profile 等）を保持する。
-- 既存テーブルへの nullable ADD COLUMN のみ。DROP / 既存データ変更 / 破壊的 ALTER は無し。

ALTER TABLE "x_post_imported_metrics" ADD COLUMN "raw_json" TEXT;
ALTER TABLE "x_imported_mentions" ADD COLUMN "raw_json" TEXT;
