"use client";

// src/components/liff/SurveyRenderer.tsx
// LIFF Survey モード — フォームを表示し、送信ボタンで /api/liff/works/[workId]/survey-responses に送信する。
// 送信成功後は完了表示に切り替える。プレビュー時は API を呼ばずに完了表示まで遷移する。
//
// 設問 UI は LIFF primitives (LiffInput / LiffTextarea / LiffRadioGroup / LiffCheckboxGroup) に
// 集約しており、見た目・状態 (focus / error / disabled) と余白を共通化している。

import { useState } from "react";
import type { LiffPageConfigSettings, SurveyItem } from "@/types";
import { liffRootClass, liffDescriptionAlignClass } from "./liff-style-helpers";
import {
  LiffButton,
  LiffInput,
  LiffTextarea,
  LiffRadioGroup,
  LiffCheckboxGroup,
} from "./primitives";

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

  return (
    <div className={`liff-font ${liffRootClass(config.settings_json)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
      <main className="liff-player-main pt-5 pb-28 flex flex-col gap-4">
        {/* ページ見出し: 大きめタイトル + 薄いサブテキスト（参考デザインに合わせる）。 */}
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[22px] font-bold leading-tight text-[color:var(--liff-primary-text)] break-words">
            {config.title?.trim() || "アンケート"}
          </h1>
          {config.description && (
            <p className={`text-[14px] leading-relaxed text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words ${liffDescriptionAlignClass(config.settings_json)}`}>
              {config.description}
            </p>
          )}
        </header>

        {completed ? (
          <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[16px] px-5 py-7 text-center">
            <p className="text-3xl mb-3 text-[color:var(--liff-line-green)]">✓</p>
            <p className="text-[15px] leading-[1.8] whitespace-pre-wrap" style={{ letterSpacing: "0.02em" }}>{thanksMessage}</p>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-[color:var(--liff-tertiary-text)] text-center py-8">
            （アンケート項目が登録されていません）
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              <p className="text-[14px] text-[color:var(--liff-danger)] leading-[1.6]" role="alert">
                {error}
              </p>
            )}

            <div className="mt-2">
              <LiffButton
                type="submit"
                variant="primary"
                loading={submitting}
                loadingLabel="送信中..."
              >
                回答を送信する
              </LiffButton>
            </div>
          </form>
        )}

      </main>
    </div>
  );
}

// ── 設問ラベル: Q バッジ + 設問文 + 右側ヒント（* / 複数選択可 / 任意） ─
// primitive の label は ReactNode を受けるため、見た目の刷新は SurveyRenderer 側だけで完結する
// （LiffField 等の共有 primitive・他ページ（お問い合わせ等）は変更しない）。
function buildHint(inputType: SurveyItem["input_type"], required: boolean): React.ReactNode {
  const parts: React.ReactNode[] = [];
  if (inputType === "checkbox") parts.push(<span key="multi">複数選択可</span>);
  if (required) {
    parts.push(
      <span key="req" aria-label="必須" className="text-[color:var(--liff-danger,#E22B2B)] font-bold">*</span>,
    );
  } else if (inputType === "text" || inputType === "textarea") {
    parts.push(<span key="opt">任意</span>);
  }
  if (parts.length === 0) return null;
  return (
    <span className="shrink-0 flex items-center gap-2 text-[12px] font-medium text-[color:var(--liff-tertiary-text,#999)]">
      {parts}
    </span>
  );
}

function QuestionLabel({
  question, hint,
}: { question: string; hint: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2.5 w-full">
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-[12px] font-bold bg-[color:rgba(6,199,85,0.12)] text-[color:var(--liff-line-green,#06C755)]"
      >
        Q
      </span>
      <span className="flex-1 min-w-0 text-[16px] font-bold leading-snug break-words text-[color:var(--liff-primary-text)]">
        {question}
      </span>
      {hint}
    </span>
  );
}

// ── 設問: LiffInput / LiffTextarea / LiffRadioGroup / LiffCheckboxGroup を使う ─
// 白い角丸カード / focus / error / disabled は primitive 側が持つ。
// required の検証は親 SurveyRenderer の validate()（survey_items を見る）に集約しているため、
// 見た目用に primitive へは required を渡さず（= 二重の * を出さない）、ヒントは自前で描画する。
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
  const label = (
    <QuestionLabel question={labelText} hint={buildHint(item.input_type, required)} />
  );

  if (item.input_type === "textarea") {
    return (
      <LiffTextarea
        label={label}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (item.input_type === "radio" && Array.isArray(item.options) && item.options.length > 0) {
    const selected = typeof value === "string" ? value : "";
    return (
      <LiffRadioGroup
        label={label}
        options={item.options}
        name={`q${index}`}
        value={selected}
        onChange={(next) => onChange(next)}
      />
    );
  }

  if (item.input_type === "checkbox" && Array.isArray(item.options) && item.options.length > 0) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <LiffCheckboxGroup
        label={label}
        options={item.options}
        value={selected}
        onChange={(next) => onChange(next)}
      />
    );
  }

  // 既定: text
  return (
    <LiffInput
      label={label}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
