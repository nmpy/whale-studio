"use client";

// src/components/liff/LiffAddBlockModal.tsx
// ブロック追加モーダル — レジストリからブロックタイプ一覧を表示

import type { LiffBlockType } from "@/types";
import { BLOCK_TYPE_REGISTRY, ADDABLE_BLOCK_TYPES } from "./block-type-registry";

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
        className="bg-white rounded-2xl shadow-xl p-6 w-[480px] max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-gray-900 mb-1">
          ページ直下に追加
        </h3>
        {/* どの階層に入るのかをここで確定させる。アコーディオンの中に入れたい場合は
            そのアコーディオンの「＋『◯◯』の中に追加」を使う導線に誘導する。 */}
        <p className="text-[11px] text-gray-500 mb-1">
          ページの一番外側（トップレベル）に追加します。
        </p>
        <p className="text-[11px] text-gray-400 mb-4">
          アコーディオンの<span className="font-medium text-gray-500">中</span>に入れたいときは、
          そのアコーディオンを「編集」して「＋『◯◯』の中に追加」から選んでください。
        </p>
        {/* PR-BLK1: 01〜13 の番号付きリスト。左=番号 / 中央=ブロック名 / サブ=補足。
            ADDABLE_BLOCK_TYPES の順序がそのまま 01〜13 になる。 */}
        <div className="flex flex-col gap-1.5">
          {ADDABLE_BLOCK_TYPES.map((type, i) => {
            const entry = BLOCK_TYPE_REGISTRY[type];
            const num = String(i + 1).padStart(2, "0");
            return (
              <button
                key={type}
                onClick={() => onAdd(type)}
                disabled={saving}
                className="flex items-center gap-3 px-3.5 py-3 bg-white rounded-xl border border-gray-200 shadow-sm cursor-pointer text-left hover:bg-gray-50 hover:border-gray-300 transition-colors disabled:opacity-50"
              >
                <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gray-100 text-gray-500 text-[12px] font-semibold tabular-nums">
                  {num}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-gray-900">{entry.label}</span>
                </span>
                <span className="shrink-0 text-[11px] text-gray-400">{entry.description}</span>
              </button>
            );
          })}
        </div>
        <button
          onClick={onClose}
          className="w-full mt-4 py-2.5 border border-gray-200 rounded-lg bg-white text-sm text-gray-500 cursor-pointer transition-colors hover:bg-gray-50"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
