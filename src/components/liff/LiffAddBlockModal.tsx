"use client";

// src/components/liff/LiffAddBlockModal.tsx
// ブロック追加モーダル — レジストリからブロックタイプ一覧を表示

import type { LiffBlockType } from "@/types";
import { BLOCK_TYPE_REGISTRY, ALL_BLOCK_TYPES } from "./block-type-registry";

interface Props {
  saving: boolean;
  onAdd: (blockType: LiffBlockType) => void;
  onClose: () => void;
}

export function LiffAddBlockModal({ saving, onAdd, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-6 w-[480px] max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-gray-900 mb-4">
          ブロックを追加
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {ALL_BLOCK_TYPES.map((type) => {
            const entry = BLOCK_TYPE_REGISTRY[type];
            return (
              <button
                key={type}
                onClick={() => onAdd(type)}
                disabled={saving}
                className="flex items-center gap-2.5 p-3 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer text-left hover:bg-violet-50 transition-colors disabled:opacity-50"
              >
                <span className="text-xl">{entry.icon}</span>
                <div>
                  <div className="text-sm font-semibold text-gray-900">{entry.label}</div>
                  <div className="text-[11px] text-gray-500">{entry.description}</div>
                </div>
              </button>
            );
          })}
        </div>
        <button
          onClick={onClose}
          className="w-full mt-4 py-2.5 border border-gray-200 rounded-lg bg-white text-sm text-gray-500 cursor-pointer hover:bg-gray-50"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
