-- /api/works の `groupBy by: [workId, reachedEnding] where: { workId IN (...), isPreview: false }`
-- を index-only scan で完結させる 3 列複合 index を追加する。
--
-- 既存 user_progress index:
--   - user_progress_line_user_id_work_id_key  (UNIQUE on line_user_id, work_id)
--   - user_progress_line_user_id_idx          (btree on line_user_id)
--   - user_progress_work_id_idx               (btree on work_id)  ← 既存単独 index
--   - user_progress_last_interacted_at_idx    (btree on last_interacted_at)
--
-- 単独 work_id index のみだと、`is_preview = false` フィルタは index scan 後の
-- 各行を heap fetch して評価する必要があり、さらに groupBy 対象 `reached_ending`
-- も heap fetch が必要になる。3 列複合にすることで filter + group の両方を
-- index 内で完結させる（heap fetch 削減）。
--
-- 新 index 名 `user_progress_work_id_is_preview_reached_ending_idx` は
-- 既存 4 つの index 名と衝突しないことを確認済み。
-- CREATE INDEX のみで既存挙動・既存データには影響しない。
CREATE INDEX "user_progress_work_id_is_preview_reached_ending_idx"
  ON "user_progress"("work_id", "is_preview", "reached_ending");
