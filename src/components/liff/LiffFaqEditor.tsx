"use client";

// src/components/liff/LiffFaqEditor.tsx
// LIFF FAQ モード用の Q&A 編集 UI。
// 親 (LiffConfigHeader) から settings.faq_items を受け取り、ローカル即時更新 → 親の onChange で settings_json に流す。
// 並び替え（上下）/ 追加 / 削除に対応。

import { useMemo } from "react";
import type { FaqItem, LiffPageConfigSettings } from "@/types";

interface Props {
  settings: LiffPageConfigSettings;
  readOnly: boolean;
  onChange: (patch: Partial<LiffPageConfigSettings>) => void;
}

function newFaqItem(): FaqItem {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    question: "",
    answer:   "",
  };
}

export function LiffFaqEditor({ settings, readOnly, onChange }: Props) {
  // 新規作成直後はデフォルト 1 行（空欄）を表示する。
  const items = useMemo<FaqItem[]>(() => {
    const arr = settings.faq_items;
    if (Array.isArray(arr) && arr.length > 0) return arr;
    return [newFaqItem()];
  }, [settings.faq_items]);

  const labelCls = "block text-xs font-medium text-gray-500 mb-1";
  const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-50";

  const update = (next: FaqItem[]) => onChange({ faq_items: next });

  const updateItem = (idx: number, patch: Partial<FaqItem>) => {
    update(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const addItem = () => update([...items, newFaqItem()]);

  const removeItem = (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    update(next.length > 0 ? next : [newFaqItem()]);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    update(next);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-900">FAQ 項目</h2>
        {!readOnly && (
          <button
            type="button"
            onClick={addItem}
            className="px-3 py-1.5 bg-brand text-white rounded-md text-xs font-semibold hover:bg-brand-deep transition-colors"
          >
            ＋ Q&amp;A を追加
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-3">
        {items.map((item, idx) => (
          <li key={item.id ?? idx} className="border border-gray-200 rounded-lg p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-400">Q{idx + 1}</span>
              {!readOnly && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    className="px-2 py-1 text-xs border border-gray-200 rounded transition-colors hover:bg-gray-50 disabled:opacity-30"
                    aria-label="上へ移動"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(idx, 1)}
                    disabled={idx === items.length - 1}
                    className="px-2 py-1 text-xs border border-gray-200 rounded transition-colors hover:bg-gray-50 disabled:opacity-30"
                    aria-label="下へ移動"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="px-2 py-1 text-xs border border-red-200 text-red-600 rounded transition-colors hover:bg-red-50"
                    aria-label="削除"
                  >
                    削除
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className={labelCls}>質問</label>
              <input
                className={inputCls}
                value={item.question}
                onChange={(e) => updateItem(idx, { question: e.target.value })}
                disabled={readOnly}
                placeholder="例: チケットの購入はどこからできますか?"
                maxLength={300}
              />
            </div>

            <div>
              <label className={labelCls}>回答</label>
              <textarea
                className={`${inputCls} resize-y min-h-[80px]`}
                value={item.answer}
                onChange={(e) => updateItem(idx, { answer: e.target.value })}
                disabled={readOnly}
                placeholder="例: 公式サイトのチケットページからご購入いただけます。"
                rows={3}
                maxLength={3000}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
