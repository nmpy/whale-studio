"use client";

// src/components/liff/LiffBlockItem.tsx
// ブロック一覧の個別アイテム — 表示・編集・ON/OFF・削除

import type { LiffPageBlock, LiffBlockType, VisibilityCondition } from "@/types";
import { getBlockEntry, VISIBILITY_CONDITION_LABELS } from "./block-type-registry";
import { BlockSettingsForm } from "./block-settings-forms";
import { isBlockUnconfigured } from "./block-config-status";

interface Props {
  block: LiffPageBlock;
  index: number;
  totalBlocks: number;
  isEditing: boolean;
  readOnly: boolean;
  onEdit: () => void;
  onCloseEdit: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
  onLocalChange: (patch: Partial<LiffPageBlock>) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

export function LiffBlockItem({
  block, index, totalBlocks, isEditing, readOnly,
  onEdit, onCloseEdit, onToggleEnabled, onDelete,
  onMove, onLocalChange, onDragStart, onDragOver, onDragEnd,
}: Props) {
  const entry = getBlockEntry(block.block_type);
  // PR-BLK2: 編集者向けの「未設定」視覚補助（保存・表示はブロックしない）。
  const unconfigured = isBlockUnconfigured(
    block.block_type,
    block.settings_json as Record<string, unknown> | null | undefined,
  );

  return (
    <div
      draggable={!readOnly}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={`bg-gray-50 rounded-lg p-3 transition-all ${
        isEditing ? "border-2 border-brand" : "border border-gray-200"
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
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 truncate">
              {block.title || entry?.label || block.block_type}
            </span>
            {/* PR-BLK2: 必須項目が空のブロックに控えめな「未設定」チップ（admin 配色）。 */}
            {unconfigured && (
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100">
                未設定
              </span>
            )}
            <span className="shrink-0 text-[11px] text-gray-400">
              {VISIBILITY_CONDITION_LABELS[(block.visibility_condition_json ?? "always") as VisibilityCondition]}
            </span>
          </div>
          {/* PR-BLK1: ブロック種別の補足を小さく表示。カスタムタイトル設定時は種別ラベルも併記。 */}
          {entry && (
            <span className="block text-[11px] text-gray-400 truncate">
              {block.title ? `${entry.label}・${entry.description}` : entry.description}
            </span>
          )}
        </div>

        {/* アクションボタン */}
        {!readOnly && (
          <div className="flex gap-1">
            <button
              onClick={isEditing ? onCloseEdit : onEdit}
              className={`px-2.5 py-1 text-[11px] border rounded-md cursor-pointer transition-colors ${
                isEditing ? "bg-gray-100 border-gray-200 text-gray-700" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {isEditing ? "閉じる" : "編集"}
            </button>
            <button
              onClick={onToggleEnabled}
              className={`px-2 py-1 text-[11px] border border-gray-200 rounded-md bg-white cursor-pointer transition-colors hover:bg-gray-50 ${
                block.is_enabled ? "text-green-600" : "text-gray-400"
              }`}
            >
              {block.is_enabled ? "ON" : "OFF"}
            </button>
            <button
              onClick={onDelete}
              className="px-2 py-1 text-[11px] border border-red-200 rounded-md bg-white text-red-600 cursor-pointer transition-colors hover:bg-red-50"
            >
              削除
            </button>
          </div>
        )}
      </div>

      {/* 編集フォーム */}
      {isEditing && (
        <div className="mt-3 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              ブロックタイトル
            </label>
            <input
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={block.title ?? ""}
              onChange={(e) => onLocalChange({ title: e.target.value || null })}
              disabled={readOnly}
            />
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              表示条件
            </label>
            <select
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={block.visibility_condition_json ?? "always"}
              onChange={(e) => onLocalChange({ visibility_condition_json: e.target.value as VisibilityCondition })}
              disabled={readOnly}
            >
              {Object.entries(VISIBILITY_CONDITION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <BlockSettingsForm
            blockType={block.block_type as LiffBlockType}
            settings={block.settings_json as Record<string, unknown>}
            onChange={(s) => onLocalChange({ settings_json: s as LiffPageBlock["settings_json"] })}
            readOnly={readOnly}
          />

          {!readOnly && (
            <div className="mt-4">
              {/* 一括保存方式: ブロックごとの保存ボタンは廃止。変更は自動的に下書きへ反映され、
                  画面最下部の「すべての変更を保存」で確定する。 */}
              <button
                onClick={onCloseEdit}
                className="px-5 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg text-sm cursor-pointer transition-colors hover:bg-gray-50"
              >
                閉じる
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
