// src/lib/liff-utils.ts
// LIFF 設定関連の共通ユーティリティ

/** DB の LiffPageBlock レコードを API レスポンス形式に変換する */
export function toBlockResponse(b: {
  id: string;
  pageConfigId: string;
  blockType: string;
  sortOrder: number;
  isEnabled: boolean;
  title: string | null;
  settingsJson: unknown;
  visibilityConditionJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id:                        b.id,
    page_config_id:            b.pageConfigId,
    block_type:                b.blockType,
    sort_order:                b.sortOrder,
    is_enabled:                b.isEnabled,
    title:                     b.title,
    settings_json:             b.settingsJson,
    visibility_condition_json: b.visibilityConditionJson,
    created_at:                b.createdAt,
    updated_at:                b.updatedAt,
  };
}

/** DB の LiffPageConfig レコード（blocks 含む）を API レスポンス形式に変換する
 *  公開 URL 用短縮 ID は work.publicId / config.publicId をそれぞれ work_public_id / public_id として返す */
export function toConfigResponse(c: {
  id: string;
  publicId?: string | null;
  workId: string;
  /** include: { work: true } で取得した場合に使う。未指定 (旧呼出) でも互換 */
  work?: { publicId?: string | null } | null;
  isEnabled: boolean;
  title: string | null;
  description: string | null;
  pageType?: string | null;
  publishStatus?: string | null;
  settingsJson?: unknown;
  createdAt: Date;
  updatedAt: Date;
  blocks: Array<{
    id: string;
    pageConfigId: string;
    blockType: string;
    sortOrder: number;
    isEnabled: boolean;
    title: string | null;
    settingsJson: unknown;
    visibilityConditionJson: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  return {
    id:              c.id,
    public_id:       c.publicId ?? undefined,
    work_id:         c.workId,
    work_public_id:  c.work?.publicId ?? undefined,
    is_enabled:      c.isEnabled,
    title:           c.title,
    description:     c.description,
    page_type:       (c.pageType ?? "default") as "default" | "hint" | "faq" | "survey" | "location",
    publish_status:  (c.publishStatus ?? "draft") as "draft" | "published" | "archived",
    settings_json:   (c.settingsJson ?? {}) as Record<string, unknown>,
    blocks:          c.blocks
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toBlockResponse),
    created_at:      c.createdAt,
    updated_at:      c.updatedAt,
  };
}
