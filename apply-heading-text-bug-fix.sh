set -e

cat > src/hooks/useLiffConfig.ts <<'EOF'
"use client";

// src/hooks/useLiffConfig.ts
// LIFF設定管理のステートとハンドラーをカプセル化するカスタムフック

import { useEffect, useState, useCallback, useRef } from "react";
import { liffConfigApi, getDevToken, workApi } from "@/lib/api-client";
import type { LiffPageConfig, LiffPageBlock, LiffBlockType, LiffPageType, LiffPublishStatus, LiffPageConfigSettings } from "@/types";

export interface UseLiffConfigReturn {
  config: LiffPageConfig | null;
  loading: boolean;
  saving: boolean;
  workTitle: string;
  editingBlockId: string | null;

  toggleEnabled: () => Promise<void>;
  updateConfigField: (field: "title" | "description", value: string | null) => Promise<void>;
  updateConfigLocal: (patch: Partial<LiffPageConfig>) => void;
  updatePageType: (next: LiffPageType) => Promise<void>;
  updatePublishStatus: (next: LiffPublishStatus) => Promise<void>;
  updateSettingsField: (key: keyof LiffPageConfigSettings, value: unknown) => Promise<void>;

  addBlock: (blockType: LiffBlockType) => Promise<void>;
  updateBlock: (block: LiffPageBlock) => Promise<void>;
  deleteBlock: (blockId: string) => Promise<void>;
  toggleBlockEnabled: (block: LiffPageBlock) => Promise<void>;
  moveBlock: (idx: number, direction: "up" | "down") => Promise<void>;
  reorderBlocks: (newBlocks: LiffPageBlock[]) => Promise<void>;

  setEditingBlockId: (id: string | null) => void;
  updateBlockLocal: (blockId: string, patch: Partial<LiffPageBlock>) => void;

  reload: () => Promise<void>;
}

export function useLiffConfig(
  workId: string,
  opts: { onSuccess?: (msg: string) => void; onError?: (msg: string) => void } = {}
): UseLiffConfigReturn {
  const [config, setConfig] = useState<LiffPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workTitle, setWorkTitle] = useState("");
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  const token = getDevToken();

  // 呼び出し側が毎レンダーで新しい inline 関数を渡しても、
  // useCallback / useEffect の deps を不安定にしないよう ref 経由で参照する。
  // これがないと reload が毎レンダー再生成されて useEffect 経由で
  // 編集中の入力をサーバ値で上書きしてしまう。
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const onSuccess = useCallback((msg: string) => optsRef.current.onSuccess?.(msg), []);
  const onError = useCallback((msg: string) => optsRef.current.onError?.(msg), []);

  const reload = useCallback(async () => {
    try {
      const [cfg, work] = await Promise.all([
        liffConfigApi.get(token, workId),
        workApi.get(token, workId),
      ]);
      setConfig(cfg);
      setWorkTitle(work.title);
    } catch {
      onError?.("LIFF設定の読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [token, workId, onError]);

  useEffect(() => { reload(); }, [reload]);

  const toggleEnabled = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { is_enabled: !config.is_enabled });
      setConfig(updated);
      onSuccess?.(updated.is_enabled ? "LIFFを有効にしました" : "LIFFを無効にしました");
    } catch {
      onError?.("更新に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onSuccess, onError]);

  const updateConfigField = useCallback(async (field: "title" | "description", value: string | null) => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { [field]: value || null });
      setConfig(updated);
      onSuccess?.("保存しました");
    } catch {
      onError?.("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onSuccess, onError]);

  const updateConfigLocal = useCallback((patch: Partial<LiffPageConfig>) => {
    if (!config) return;
    setConfig({ ...config, ...patch });
  }, [config]);

  const updatePageType = useCallback(async (next: LiffPageType) => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { page_type: next });
      setConfig(updated);
      onSuccess?.("ページ種別を更新しました");
    } catch {
      onError?.("更新に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onSuccess, onError]);

  const updatePublishStatus = useCallback(async (next: LiffPublishStatus) => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { publish_status: next });
      setConfig(updated);
      onSuccess?.(
        next === "published" ? "公開しました" :
        next === "archived"  ? "アーカイブしました" :
        "下書きに戻しました"
      );
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "公開に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onSuccess, onError]);

  const updateSettingsField = useCallback(async (key: keyof LiffPageConfigSettings, value: unknown) => {
    if (!config) return;
    const nextSettings = { ...(config.settings_json ?? {}), [key]: value };
    setConfig({ ...config, settings_json: nextSettings });
    setSaving(true);
    try {
      const updated = await liffConfigApi.update(token, workId, { settings_json: nextSettings });
      setConfig(updated);
    } catch {
      onError?.("更新に失敗しました");
      await reload();
    } finally {
      setSaving(false);
    }
  }, [config, token, workId, onError, reload]);

  const addBlock = useCallback(async (blockType: LiffBlockType) => {
    setSaving(true);
    try {
      const { BLOCK_TYPE_REGISTRY } = await import("@/components/liff/block-type-registry");
      const entry = BLOCK_TYPE_REGISTRY[blockType];
      await liffConfigApi.createBlock(token, workId, {
        block_type: blockType,
        title: entry.label,
        settings_json: entry.defaultSettings,
      });
      await reload();
      onSuccess?.("ブロックを追加しました");
    } catch {
      onError?.("追加に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [token, workId, reload, onSuccess, onError]);

  const updateBlock = useCallback(async (block: LiffPageBlock) => {
    setSaving(true);
    try {
      await liffConfigApi.updateBlock(token, workId, block.id, {
        title: block.title,
        is_enabled: block.is_enabled,
        settings_json: block.settings_json as Record<string, unknown>,
        visibility_condition_json: block.visibility_condition_json,
      });
      await reload();
      setEditingBlockId(null);
      onSuccess?.("保存しました");
    } catch {
      onError?.("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [token, workId, reload, onSuccess, onError]);

  const deleteBlock = useCallback(async (blockId: string) => {
    if (!confirm("このブロックを削除しますか？")) return;
    setSaving(true);
    try {
      await liffConfigApi.deleteBlock(token, workId, blockId);
      await reload();
      if (editingBlockId === blockId) setEditingBlockId(null);
      onSuccess?.("削除しました");
    } catch {
      onError?.("削除に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [token, workId, reload, editingBlockId, onSuccess, onError]);

  const toggleBlockEnabled = useCallback(async (block: LiffPageBlock) => {
    updateBlockLocal(block.id, { is_enabled: !block.is_enabled });
    try {
      await liffConfigApi.updateBlock(token, workId, block.id, { is_enabled: !block.is_enabled });
    } catch {
      onError?.("更新に失敗しました");
      await reload();
    }
  }, [token, workId, reload, onError]);

  const moveBlock = useCallback(async (idx: number, direction: "up" | "down") => {
    if (!config) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= config.blocks.length) return;
    const newBlocks = [...config.blocks];
    [newBlocks[idx], newBlocks[newIdx]] = [newBlocks[newIdx], newBlocks[idx]];
    const reordered = newBlocks.map((b, i) => ({ ...b, sort_order: i }));
    setConfig({ ...config, blocks: reordered });
    try {
      await liffConfigApi.reorderBlocks(token, workId, { block_ids: reordered.map((b) => b.id) });
    } catch {
      onError?.("並び替えに失敗しました");
      await reload();
    }
  }, [config, token, workId, reload, onError]);

  const reorderBlocks = useCallback(async (newBlocks: LiffPageBlock[]) => {
    if (!config) return;
    const reordered = newBlocks.map((b, i) => ({ ...b, sort_order: i }));
    setConfig({ ...config, blocks: reordered });
    try {
      await liffConfigApi.reorderBlocks(token, workId, { block_ids: reordered.map((b) => b.id) });
    } catch {
      onError?.("並び替えに失敗しました");
      await reload();
    }
  }, [config, token, workId, reload, onError]);

  const updateBlockLocal = useCallback((blockId: string, patch: Partial<LiffPageBlock>) => {
    if (!config) return;
    setConfig({
      ...config,
      blocks: config.blocks.map((b) => b.id === blockId ? { ...b, ...patch } : b),
    });
  }, [config]);

  return {
    config, loading, saving, workTitle, editingBlockId,
    toggleEnabled, updateConfigField, updateConfigLocal,
    updatePageType, updatePublishStatus, updateSettingsField,
    addBlock, updateBlock, deleteBlock, toggleBlockEnabled, moveBlock, reorderBlocks,
    setEditingBlockId, updateBlockLocal,
    reload,
  };
}
EOF

cat > src/components/liff/LiffBlockItem.tsx <<'EOF'
"use client";

// src/components/liff/LiffBlockItem.tsx
// ブロック一覧の個別アイテム — 表示・編集・ON/OFF・削除

import { useState } from "react";
import type { LiffPageBlock, LiffBlockType, VisibilityCondition } from "@/types";
import { getBlockEntry, VISIBILITY_CONDITION_LABELS } from "./block-type-registry";
import { BlockSettingsForm } from "./block-settings-forms";

interface Props {
  block: LiffPageBlock;
  index: number;
  totalBlocks: number;
  isEditing: boolean;
  readOnly: boolean;
  saving: boolean;
  onEdit: () => void;
  onCloseEdit: () => void;
  onSave: (block: LiffPageBlock) => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
  onLocalChange: (patch: Partial<LiffPageBlock>) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

export function LiffBlockItem({
  block, index, totalBlocks, isEditing, readOnly, saving,
  onEdit, onCloseEdit, onSave, onToggleEnabled, onDelete,
  onMove, onLocalChange, onDragStart, onDragOver, onDragEnd,
}: Props) {
  const entry = getBlockEntry(block.block_type);

  // 編集中ブロックのローカル draft。
  // 親（page）は preview を即時更新するために `onLocalChange` で
  // config.blocks も書き換えるが、draft はその再 render に依存せず
  // ユーザー入力を保持する。
  const [draft, setDraft] = useState<LiffPageBlock>(block);
  // draft をリセットするタイミングを id で識別する
  // （isEditing への遷移時 / 別ブロックへ切り替えた時のみ block を取り込む）
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const targetKey = isEditing ? block.id : null;

  if (draftKey !== targetKey) {
    if (targetKey) setDraft(block);
    setDraftKey(targetKey);
  }

  const updateDraft = (patch: Partial<LiffPageBlock>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    // プレビューが保存前の編集を反映できるよう、親の config にも伝搬する
    onLocalChange(patch);
  };

  return (
    <div
      draggable={!readOnly}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={`bg-white rounded-lg p-3 transition-all ${
        isEditing ? "border-2 border-violet-500" : "border border-gray-200"
      } ${!block.is_enabled ? "opacity-50" : ""} ${!readOnly ? "cursor-grab" : ""}`}
    >
      {/* ヘッダー */}
      <div className="flex items-center gap-2">
        {/* 上下ボタン */}
        {!readOnly && (
          <div className="flex flex-col gap-0.5 mr-1">
            <button
              onClick={() => onMove("up")}
              disabled={index === 0}
              className="w-5 h-4 border-none bg-transparent text-[10px] text-gray-500 disabled:opacity-30"
            >
              ▲
            </button>
            <button
              onClick={() => onMove("down")}
              disabled={index === totalBlocks - 1}
              className="w-5 h-4 border-none bg-transparent text-[10px] text-gray-500 disabled:opacity-30"
            >
              ▼
            </button>
          </div>
        )}

        <span className="text-base">{entry?.icon ?? "?"}</span>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-gray-900">
            {block.title || entry?.label || block.block_type}
          </span>
          <span className="text-[11px] text-gray-400 ml-2">
            {VISIBILITY_CONDITION_LABELS[(block.visibility_condition_json ?? "always") as VisibilityCondition]}
          </span>
        </div>

        {/* アクションボタン */}
        {!readOnly && (
          <div className="flex gap-1">
            <button
              onClick={isEditing ? onCloseEdit : onEdit}
              className={`px-2.5 py-1 text-[11px] border rounded-md cursor-pointer ${
                isEditing ? "bg-gray-100 border-gray-200 text-gray-700" : "bg-white border-gray-200 text-gray-700"
              }`}
            >
              {isEditing ? "閉じる" : "編集"}
            </button>
            <button
              onClick={onToggleEnabled}
              className={`px-2 py-1 text-[11px] border border-gray-200 rounded-md bg-white cursor-pointer ${
                block.is_enabled ? "text-green-600" : "text-gray-400"
              }`}
            >
              {block.is_enabled ? "ON" : "OFF"}
            </button>
            <button
              onClick={onDelete}
              className="px-2 py-1 text-[11px] border border-red-100 rounded-md bg-white text-red-500 cursor-pointer"
            >
              削除
            </button>
          </div>
        )}
      </div>

      {/* 編集フォーム */}
      {isEditing && (
        <div className="mt-3 p-3 bg-gray-50 rounded-lg">
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              ブロックタイトル
            </label>
            <input
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              value={draft.title ?? ""}
              onChange={(e) => updateDraft({ title: e.target.value || null })}
              disabled={readOnly}
            />
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              表示条件
            </label>
            <select
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
              value={draft.visibility_condition_json ?? "always"}
              onChange={(e) => updateDraft({ visibility_condition_json: e.target.value as VisibilityCondition })}
              disabled={readOnly}
            >
              {Object.entries(VISIBILITY_CONDITION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <BlockSettingsForm
            blockType={draft.block_type as LiffBlockType}
            settings={draft.settings_json as Record<string, unknown>}
            onChange={(s) => updateDraft({ settings_json: s as LiffPageBlock["settings_json"] })}
            readOnly={readOnly}
          />

          {!readOnly && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => onSave(draft)}
                disabled={saving}
                className="px-5 py-2 bg-violet-500 text-white rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-60"
              >
                {saving ? "保存中..." : "保存"}
              </button>
              <button
                onClick={onCloseEdit}
                className="px-5 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg text-sm cursor-pointer"
              >
                キャンセル
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
EOF

npm run build

git add src/hooks/useLiffConfig.ts src/components/liff/LiffBlockItem.tsx