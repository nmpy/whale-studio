"use client";

// src/components/liff/LiffBlockItem.tsx
// ブロック一覧の個別アイテム — 表示・編集・ON/OFF・削除

import { useRef, useState } from "react";
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
  // 編集開始時点のスナップショット。キャンセル時に親の config を元に戻すために使う。
  const originalRef = useRef<LiffPageBlock>(block);
  // draft をリセットするタイミングを id で識別する
  // （isEditing への遷移時 / 別ブロックへ切り替えた時のみ block を取り込む）
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const targetKey = isEditing ? block.id : null;

  if (draftKey !== targetKey) {
    if (targetKey) {
      setDraft(block);
      originalRef.current = block;
    }
    setDraftKey(targetKey);
  }

  const updateDraft = (patch: Partial<LiffPageBlock>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    // プレビューが保存前の編集を反映できるよう、親の config にも伝搬する
    onLocalChange(patch);
  };

  // 閉じる/キャンセル: preview 用に伝搬していた変更を元に戻してから親に通知。
  // これで親側で reload() を呼ばなくて済む。
  const handleClose = () => {
    const orig = originalRef.current;
    onLocalChange({
      title: orig.title,
      visibility_condition_json: orig.visibility_condition_json,
      settings_json: orig.settings_json,
      is_enabled: orig.is_enabled,
    });
    onCloseEdit();
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
              onClick={isEditing ? handleClose : onEdit}
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
                onClick={handleClose}
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
