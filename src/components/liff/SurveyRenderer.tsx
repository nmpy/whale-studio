"use client";

// src/components/liff/SurveyRenderer.tsx
// LIFF Survey モード — フォームを表示し、送信ボタンで /api/liff/works/[workId]/survey-responses に送信する。
// 送信成功後は完了表示に切り替える。プレビュー時は API を呼ばずに完了表示まで遷移する。

import { useState } from "react";
import type { LiffPageConfigSettings, SurveyItem } from "@/types";
import { LiffShareButton } from "./LiffShareButton";
import { LiffPlayerHeader } from "./LiffPlayerHeader";
import { liffRootClass } from "./liff-style-helpers";

export interface SurveyRendererConfig {
  work_id:       string;
  /** どの LIFF ページ (LiffPageConfig) から送信されたかを記録するため API に同梱する。
   *  pageId 不明な旧経路では undefined のまま (API 側は許容)。 */
  page_id?:      string;
  /** 作品名。ヘッダーに表示する (新仕様)。未指定なら title にフォールバック */
  work_title?:   string | null;
  /** LIFF ページ名。本文側 h2 として表示する */
  title:         string | null;
  description:   string | null;
  settings_json: LiffPageConfigSettings;
}

interface Props {
  config: SurveyRendererConfig;
  /** プレビュー時は true（API 送信せず完了表示のみ） */
  preview?: boolean;
  /** ログイン中の LINE ユーザー ID（送信時に同梱） */
  lineUserId?: string | null;
}

type AnswerMap = Record<string, string | string[]>;

function itemKey(item: SurveyItem, idx: number): string {
  return item.id || `q${idx}`;
}

export function SurveyRenderer({ config, preview, lineUserId }: Props) {
  const items = config.settings_json.survey_items ?? [];
  const thanksMessage = config.settings_json.survey_thanks_message?.trim() || "送信しました。ご回答ありがとうございました。";

  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAnswer = (key: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const validate = (): string | null => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.required) continue;
      const key = itemKey(it, i);
      const v = answers[key];
      if (it.input_type === "checkbox") {
        if (!Array.isArray(v) || v.length === 0) return `「${it.question || `Q${i + 1}`}」は必須項目です`;
      } else {
        if (typeof v !== "string" || v.trim() === "") return `「${it.question || `Q${i + 1}`}」は必須項目です`;
      }
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    if (preview) {
      // プレビュー時は実送信しない
      setCompleted(true);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/liff/works/${config.work_id}/survey-responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_user_id: lineUserId ?? null,
          // page_id を渡すことで、サーバー側が LiffSurveyResponse には保存しないが
          // LiffEventLog (survey_submit) には liffPageConfigId として保存できるようになる。
          // 古い経路 (page_id 不明) でも未指定で OK。
          page_id:      config.page_id ?? null,
          answers,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "送信に失敗しました");
        return;
      }
      setCompleted(true);
    } catch {
      setError("通信エラーが発生しました。電波の良いところで再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  };

  const pageTitle = config.title?.trim();

  return (
    <div className={`liff-font ${liffRootClass(config.settings_json)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
      <LiffPlayerHeader workTitle={config.work_title} pageTitle={config.title} />
      <main className="max-w-md mx-auto px-4 py-5 flex flex-col gap-4 pb-24">
        {/* 本文先頭にページタイトルを h2 として表示する。ヘッダーは作品名。 */}
        {pageTitle && (
          <h2 className="text-[20px] leading-tight font-bold tracking-tight break-words text-[color:var(--liff-primary-text)]">
            {pageTitle}
          </h2>
        )}
        {config.description && (
          <p className="text-[14px] leading-relaxed text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words">
            {config.description}
          </p>
        )}

        {completed ? (
          <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[12px] px-4 py-6 text-center">
            <p className="text-3xl mb-2">✓</p>
            <p className="text-[15px] leading-[1.6] whitespace-pre-wrap">{thanksMessage}</p>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-[color:var(--liff-tertiary-text)] text-center py-8">
            （アンケート項目が登録されていません）
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {items.map((it, idx) => (
              <SurveyField
                key={itemKey(it, idx)}
                item={it}
                index={idx}
                value={answers[itemKey(it, idx)]}
                onChange={(v) => setAnswer(itemKey(it, idx), v)}
              />
            ))}

            {error && (
              <p className="text-[14px] text-[color:var(--liff-danger)] leading-[1.6]">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-12 px-4 rounded-[10px] text-white font-bold text-[15px] tracking-tight transition-opacity disabled:opacity-50 active:opacity-90 mt-2"
              style={{ background: "var(--liff-line-green, #06C755)" }}
            >
              {submitting ? "送信中..." : "回答を送信する"}
            </button>
          </form>
        )}

        {config.settings_json.share_enabled && (
          <div className="pt-2">
            <LiffShareButton settings={config.settings_json} pageTitle={config.title || ""} preview={preview} />
          </div>
        )}
      </main>
    </div>
  );
}

// ── 設問カード共通構造 ─────────────────────────────────────────────
// LINE Design System を踏まえた最小限の Question Card:
//   - label 行 (タイトル + 必須マーク)
//   - control area (input / textarea / radio / checkbox)
// fieldset/legend を使わない理由:
//   ブラウザの既定で legend は fieldset の border 上に位置決めされ、
//   border-radius を付けた角丸カードでは「タイトルがカード外にはみ出して見える」現象が
//   起こる。div + role="group" + aria-labelledby で同等のセマンティクスを得つつ
//   通常フローで描画できるようにする。

const QUESTION_CARD_CLS =
  "bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[12px] px-4 py-3 flex flex-col gap-2";

const INPUT_CLS =
  "w-full px-3 py-2 border border-[color:var(--liff-border)] rounded-[8px] text-[15px] leading-[1.6] " +
  "focus:outline-none focus:ring-2 focus:ring-[color:var(--liff-line-green)] focus:border-[color:var(--liff-line-green)] " +
  "bg-[color:var(--liff-surface)] text-[color:var(--liff-primary-text)] placeholder:text-[color:var(--liff-tertiary-text)]";

function QuestionLabel({ id, text, required }: { id?: string; text: string; required?: boolean }) {
  return (
    <span id={id} className="text-[14px] font-bold leading-[1.5] text-[color:var(--liff-primary-text)] break-words">
      {text}
      {required && (
        <span
          aria-label="必須"
          className="ml-1 text-[color:var(--liff-danger,#E22B2B)] font-bold"
        >
          *
        </span>
      )}
    </span>
  );
}

function SurveyField({
  item, index, value, onChange,
}: {
  item: SurveyItem;
  index: number;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
}) {
  const labelText = item.question?.trim() || `Q${index + 1}`;
  const required = !!item.required;
  // 設問ごとの label id (radio/checkbox の aria-labelledby に使う)
  const labelId = `survey-q-${index}-label`;

  if (item.input_type === "textarea") {
    return (
      <label className={QUESTION_CARD_CLS}>
        <QuestionLabel text={labelText} required={required} />
        <textarea
          className={`${INPUT_CLS} min-h-[96px] resize-y`}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
        />
      </label>
    );
  }

  if (item.input_type === "radio" && Array.isArray(item.options) && item.options.length > 0) {
    const selected = typeof value === "string" ? value : "";
    return (
      <div className={QUESTION_CARD_CLS} role="radiogroup" aria-labelledby={labelId}>
        <QuestionLabel id={labelId} text={labelText} required={required} />
        <div className="flex flex-col gap-2">
          {item.options.map((opt, i) => (
            <label
              key={i}
              className="flex items-start gap-2 text-[15px] leading-[1.5] cursor-pointer py-1 min-h-[28px]"
            >
              <input
                type="radio"
                name={`q${index}`}
                value={opt}
                checked={selected === opt}
                onChange={(e) => onChange(e.target.value)}
                className="mt-[3px] accent-[color:var(--liff-line-green,#06C755)]"
              />
              <span className="flex-1 min-w-0 break-words">{opt}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (item.input_type === "checkbox" && Array.isArray(item.options) && item.options.length > 0) {
    const selected = Array.isArray(value) ? value : [];
    const toggle = (opt: string) => {
      if (selected.includes(opt)) onChange(selected.filter((s) => s !== opt));
      else onChange([...selected, opt]);
    };
    return (
      <div className={QUESTION_CARD_CLS} role="group" aria-labelledby={labelId}>
        <QuestionLabel id={labelId} text={labelText} required={required} />
        <div className="flex flex-col gap-2">
          {item.options.map((opt, i) => (
            <label
              key={i}
              className="flex items-start gap-2 text-[15px] leading-[1.5] cursor-pointer py-1 min-h-[28px]"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                className="mt-[3px] accent-[color:var(--liff-line-green,#06C755)]"
              />
              <span className="flex-1 min-w-0 break-words">{opt}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  // 既定: text
  return (
    <label className={QUESTION_CARD_CLS}>
      <QuestionLabel text={labelText} required={required} />
      <input
        type="text"
        className={INPUT_CLS}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
