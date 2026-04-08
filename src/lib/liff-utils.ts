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

/** DB の LiffPageConfig レコード（blocks 含む）を API レスポンス形式に変換する */
export function toConfigResponse(c: {
  id: string;
  workId: string;
  isEnabled: boolean;
  title: string | null;
  description: string | null;
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
    id:          c.id,
    work_id:     c.workId,
    is_enabled:  c.isEnabled,
    title:       c.title,
    description: c.description,
    blocks:      c.blocks
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toBlockResponse),
    created_at:  c.createdAt,
    updated_at:  c.updatedAt,
  };
}
