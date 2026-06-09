"use client";

// src/components/liff/LiffSurveyEditor.tsx
// LIFF Survey モード用の質問項目編集 UI。
// 入力種別: text / textarea / radio / checkbox。
// radio / checkbox の場合は options（改行区切り入力）を編集できる。

import { useMemo } from "react";
import type { LiffPageConfigSettings, SurveyInputType, SurveyItem } from "@/types";

interface Props {
  settings: LiffPageConfigSettings;
  readOnly: boolean;
  onChange: (patch: Partial<LiffPageConfigSettings>) => void;
}

const INPUT_TYPE_LABEL: Record<SurveyInputType, string> = {
  text:     "テキスト（1 行）",
  textarea: "テキスト（複数行）",
  radio:    "ラジオ（1 つ選択）",
  checkbox: "チェックボックス（複数選択）",
};

function newSurveyItem(): SurveyItem {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    question:   "",
    input_type: "text",
  };
}

export function LiffSurveyEditor({ settings, readOnly, onChange }: Props) {
  const items = useMemo<SurveyItem[]>(() => {
    const arr = settings.survey_items;
    if (Array.isArray(arr) && arr.length > 0) return arr;
    return [newSurveyItem()];
  }, [settings.survey_items]);

  const labelCls = "block text-xs font-medium text-gray-500 mb-1";
  const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-50";

  const update = (next: SurveyItem[]) => onChange({ survey_items: next });

  const updateItem = (idx: number, patch: Partial<SurveyItem>) => {
    update(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const addItem = () => update([...items, newSurveyItem()]);

  const removeItem = (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    update(next.length > 0 ? next : [newSurveyItem()]);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    update(next);
  };

  const needsOptions = (t: SurveyInputType) => t === "radio" || t === "checkbox";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-900">アンケート項目</h2>
        {!readOnly && (
          <button
            type="button"
            onClick={addItem}
            className="px-3 py-1.5 bg-brand text-white rounded-md text-xs font-semibold hover:bg-brand-deep transition-colors"
          >
            ＋ 質問を追加
          </button>
        )}
      </div>

      <div>
        <label className={labelCls}>送信完了メッセージ（任意）</label>
        <input
          className={inputCls}
          value={settings.survey_thanks_message ?? ""}
          onChange={(e) => onChange({ survey_thanks_message: e.target.value })}
          disabled={readOnly}
          placeholder="例: 送信しました。ご協力ありがとうございました。"
          maxLength={500}
        />
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
                    className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30"
                    aria-label="上へ移動"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(idx, 1)}
                    disabled={idx === items.length - 1}
                    className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30"
                    aria-label="下へ移動"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50"
                    aria-label="削除"
                  >
                    削除
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className={labelCls}>質問文</label>
              <input
                className={inputCls}
                value={item.question}
                onChange={(e) => updateItem(idx, { question: e.target.value })}
                disabled={readOnly}
                placeholder="例: ご感想をお聞かせください"
                maxLength={300}
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>入力種別</label>
                <select
                  className={inputCls}
                  value={item.input_type}
                  onChange={(e) => updateItem(idx, { input_type: e.target.value as SurveyInputType })}
                  disabled={readOnly}
                >
                  {(["text", "textarea", "radio", "checkbox"] as SurveyInputType[]).map((t) => (
                    <option key={t} value={t}>{INPUT_TYPE_LABEL[t]}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={item.required ?? false}
                    onChange={(e) => updateItem(idx, { required: e.target.checked })}
                    disabled={readOnly}
                    className="rounded border-gray-300"
                  />
                  必須回答にする
                </label>
              </div>
            </div>

            {needsOptions(item.input_type) && (
              <div>
                <label className={labelCls}>選択肢（1 行 1 項目）</label>
                <textarea
                  className={`${inputCls} min-h-[80px] resize-y`}
                  value={(item.options ?? []).join("\n")}
                  onChange={(e) =>
                    updateItem(idx, {
                      options: e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter((s) => s.length > 0)
                        .slice(0, 20),
                    })
                  }
                  disabled={readOnly}
                  placeholder={"例:\nとても満足\n満足\n普通\n不満"}
                  rows={4}
                />
                <p className="text-[11px] text-gray-400 mt-1">最大 20 個まで。空行は無視されます。</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
