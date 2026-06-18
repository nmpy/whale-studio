"use client";

// src/components/liff/LiffContactEditor.tsx
// LIFF お問い合わせ（page_type="contact"）設定エディタ。
//   - 問い合わせ種別の選択肢（追加/削除/並び替え）
//   - お名前 / メール / 本文の表示・必須トグル
//   - その他項目（SurveyItem 流用: text/textarea/radio/checkbox）
//   - 送信完了メッセージ
// 既存 LiffSurveyEditor / LiffFaqEditor の UI トーンに合わせる。保存は親の onChange に委譲。

import { useMemo, useState } from "react";
import type { LiffPageConfigSettings, SurveyInputType, SurveyItem } from "@/types";
import { CONTACT_BODY_MAX } from "./contact-helpers";

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

const labelCls = "block text-xs font-medium text-gray-500 mb-1";
const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-gray-50";

function newCustomItem(): SurveyItem {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    question:   "",
    input_type: "text",
  };
}

/** 表示・必須トグルの 1 行。 */
function ToggleRow({
  label, showValue, requiredValue, onShowChange, onRequiredChange, readOnly, alwaysShown,
}: {
  label: string;
  showValue: boolean;
  requiredValue: boolean;
  onShowChange?: (v: boolean) => void;
  onRequiredChange: (v: boolean) => void;
  readOnly: boolean;
  /** 常に表示（本文など）の場合は表示トグルを出さない。 */
  alwaysShown?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap border border-gray-100 rounded-lg px-3 py-2">
      <span className="text-sm font-medium text-gray-800">{label}</span>
      <div className="flex items-center gap-4">
        {!alwaysShown && onShowChange && (
          <label className="flex items-center gap-1.5 text-xs text-gray-700">
            <input type="checkbox" checked={showValue} onChange={(e) => onShowChange(e.target.checked)} disabled={readOnly} className="rounded border-gray-300" />
            表示する
          </label>
        )}
        <label className="flex items-center gap-1.5 text-xs text-gray-700">
          <input type="checkbox" checked={requiredValue} onChange={(e) => onRequiredChange(e.target.checked)} disabled={readOnly || (!alwaysShown && !showValue)} className="rounded border-gray-300" />
          必須にする
        </label>
      </div>
    </div>
  );
}

export function LiffContactEditor({ settings, readOnly, onChange }: Props) {
  const categories = useMemo<string[]>(
    () => (Array.isArray(settings.contact_categories) ? settings.contact_categories : []),
    [settings.contact_categories],
  );
  const customFields = useMemo<SurveyItem[]>(
    () => (Array.isArray(settings.contact_custom_fields) ? settings.contact_custom_fields : []),
    [settings.contact_custom_fields],
  );

  // 既定値（未設定=表示/必須の方針）。
  const categoryRequired = settings.contact_category_required !== false;
  const showName         = settings.contact_show_name !== false;
  const nameRequired     = settings.contact_name_required === true;
  const showEmail        = settings.contact_show_email !== false;
  const emailRequired    = settings.contact_email_required === true;
  const bodyRequired     = settings.contact_body_required !== false;

  const [optionsText, setOptionsText] = useState<Record<string, string>>({});

  // ── 種別 ──
  const setCategories = (next: string[]) => onChange({ contact_categories: next });
  const addCategory = () => setCategories([...categories, ""]);
  const updateCategory = (idx: number, v: string) => setCategories(categories.map((c, i) => (i === idx ? v : c)));
  const removeCategory = (idx: number) => setCategories(categories.filter((_, i) => i !== idx));
  const moveCategory = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= categories.length) return;
    const next = categories.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    setCategories(next);
  };

  // ── その他項目 ──
  const setCustom = (next: SurveyItem[]) => onChange({ contact_custom_fields: next });
  const updateCustom = (idx: number, patch: Partial<SurveyItem>) => setCustom(customFields.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const addCustom = () => setCustom([...customFields, newCustomItem()]);
  const removeCustom = (idx: number) => setCustom(customFields.filter((_, i) => i !== idx));
  const moveCustom = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= customFields.length) return;
    const next = customFields.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    setCustom(next);
  };
  const needsOptions = (t: SurveyInputType) => t === "radio" || t === "checkbox";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-5">
      <h2 className="text-sm font-semibold text-gray-900">お問い合わせ設定</h2>

      {/* 問い合わせ種別 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-xs font-semibold text-gray-700">問い合わせ種別</h3>
          {!readOnly && (
            <button type="button" onClick={addCategory} className="px-3 py-1.5 bg-brand text-white rounded-md text-xs font-semibold hover:bg-brand-deep transition-colors">
              ＋ 種別を追加
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-400">未設定の場合、種別の選択欄は表示されません。最大 20 件。</p>
        {categories.length > 0 && (
          <ul className="flex flex-col gap-2">
            {categories.map((c, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <input className={inputCls} value={c} onChange={(e) => updateCategory(idx, e.target.value)} disabled={readOnly} placeholder="例: 不具合の報告" maxLength={50} />
                {!readOnly && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => moveCategory(idx, -1)} disabled={idx === 0} className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30" aria-label="上へ移動">↑</button>
                    <button type="button" onClick={() => moveCategory(idx, 1)} disabled={idx === categories.length - 1} className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30" aria-label="下へ移動">↓</button>
                    <button type="button" onClick={() => removeCategory(idx)} className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50" aria-label="削除">削除</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <label className="flex items-center gap-1.5 text-xs text-gray-700">
          <input type="checkbox" checked={categoryRequired} onChange={(e) => onChange({ contact_category_required: e.target.checked })} disabled={readOnly || categories.length === 0} className="rounded border-gray-300" />
          種別を必須にする
        </label>
      </section>

      {/* 固定項目（お名前 / メール / 本文） */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-700">入力項目</h3>
        <ToggleRow label="お名前" showValue={showName} requiredValue={nameRequired} onShowChange={(v) => onChange({ contact_show_name: v })} onRequiredChange={(v) => onChange({ contact_name_required: v })} readOnly={readOnly} />
        <ToggleRow label="メールアドレス" showValue={showEmail} requiredValue={emailRequired} onShowChange={(v) => onChange({ contact_show_email: v })} onRequiredChange={(v) => onChange({ contact_email_required: v })} readOnly={readOnly} />
        <ToggleRow label={`お問い合わせ内容（最大${CONTACT_BODY_MAX}文字）`} showValue requiredValue={bodyRequired} onRequiredChange={(v) => onChange({ contact_body_required: v })} readOnly={readOnly} alwaysShown />
      </section>

      {/* その他項目 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-xs font-semibold text-gray-700">その他項目</h3>
          {!readOnly && (
            <button type="button" onClick={addCustom} className="px-3 py-1.5 bg-brand text-white rounded-md text-xs font-semibold hover:bg-brand-deep transition-colors">
              ＋ 項目を追加
            </button>
          )}
        </div>
        {customFields.length > 0 && (
          <ul className="flex flex-col gap-3">
            {customFields.map((item, idx) => (
              <li key={item.id ?? idx} className="border border-gray-200 rounded-lg p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-gray-400">項目 {idx + 1}</span>
                  {!readOnly && (
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => moveCustom(idx, -1)} disabled={idx === 0} className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30" aria-label="上へ移動">↑</button>
                      <button type="button" onClick={() => moveCustom(idx, 1)} disabled={idx === customFields.length - 1} className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30" aria-label="下へ移動">↓</button>
                      <button type="button" onClick={() => removeCustom(idx)} className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50" aria-label="削除">削除</button>
                    </div>
                  )}
                </div>
                <div>
                  <label className={labelCls}>項目名</label>
                  <input className={inputCls} value={item.question} onChange={(e) => updateCustom(idx, { question: e.target.value })} disabled={readOnly} placeholder="例: ご利用のプラン" maxLength={300} />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>入力種別</label>
                    <select className={inputCls} value={item.input_type} onChange={(e) => updateCustom(idx, { input_type: e.target.value as SurveyInputType })} disabled={readOnly}>
                      {(["text", "textarea", "radio", "checkbox"] as SurveyInputType[]).map((t) => (
                        <option key={t} value={t}>{INPUT_TYPE_LABEL[t]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={item.required ?? false} onChange={(e) => updateCustom(idx, { required: e.target.checked })} disabled={readOnly} className="rounded border-gray-300" />
                      必須にする
                    </label>
                  </div>
                </div>
                {needsOptions(item.input_type) && (
                  <div>
                    <label className={labelCls}>選択肢（1 行 1 項目）</label>
                    <textarea
                      className={`${inputCls} min-h-[80px] resize-y`}
                      value={optionsText[item.id ?? String(idx)] ?? (item.options ?? []).join("\n")}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const key = item.id ?? String(idx);
                        setOptionsText((prev) => ({ ...prev, [key]: raw }));
                        updateCustom(idx, { options: raw.split("\n").map((s) => s.trim()).filter((s) => s.length > 0).slice(0, 20) });
                      }}
                      disabled={readOnly}
                      placeholder={"例:\nプランA\nプランB"}
                      rows={3}
                    />
                    <p className="text-[11px] text-gray-400 mt-1">最大 20 個まで。空行は無視されます。</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 送信完了メッセージ */}
      <section>
        <label className={labelCls}>送信完了メッセージ（任意）</label>
        <input className={inputCls} value={settings.contact_success_message ?? ""} onChange={(e) => onChange({ contact_success_message: e.target.value })} disabled={readOnly} placeholder="例: お問い合わせありがとうございました。" maxLength={500} />
      </section>
    </div>
  );
}
