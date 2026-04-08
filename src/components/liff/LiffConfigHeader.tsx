"use client";

// src/components/liff/LiffConfigHeader.tsx
// LIFF設定ページのヘッダー — 有効/無効トグル + タイトル/説明入力

import type { LiffPageConfig } from "@/types";

interface Props {
  config: LiffPageConfig;
  saving: boolean;
  readOnly: boolean;
  onToggleEnabled: () => void;
  onUpdateField: (field: "title" | "description", value: string | null) => void;
  onLocalChange: (patch: Partial<LiffPageConfig>) => void;
}

export function LiffConfigHeader({ config, saving, readOnly, onToggleEnabled, onUpdateField, onLocalChange }: Props) {
  return (
    <>
      {/* 有効/無効トグル */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">LIFF表示設定</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {config.is_enabled ? "有効" : "無効"}
          </span>
          <button
            onClick={onToggleEnabled}
            disabled={saving || readOnly}
            className="relative w-12 h-[26px] rounded-full border-none cursor-pointer transition-colors"
            style={{ background: config.is_enabled ? "#06C755" : "#d1d5db" }}
          >
            <div
              className="absolute top-[2px] w-[22px] h-[22px] rounded-full bg-white shadow transition-[left]"
              style={{ left: config.is_enabled ? 24 : 2 }}
            />
          </button>
        </div>
      </div>

      {/* タイトル・説明 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            LIFFページタイトル
          </label>
          <input
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-gray-50"
            value={config.title ?? ""}
            onChange={(e) => onLocalChange({ title: e.target.value || null })}
            onBlur={(e) => onUpdateField("title", e.target.value)}
            disabled={readOnly}
            placeholder="例: 謎解き探偵ゲーム"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            説明
          </label>
          <input
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:bg-gray-50"
            value={config.description ?? ""}
            onChange={(e) => onLocalChange({ description: e.target.value || null })}
            onBlur={(e) => onUpdateField("description", e.target.value)}
            disabled={readOnly}
            placeholder="任意の説明文"
          />
        </div>
      </div>
    </>
  );
}
