"use client";

// src/components/liff/SurveyRenderer.tsx
// LIFF Survey モード — フォームを表示し、送信ボタンで /api/liff/works/[workId]/survey-responses に送信する。
// 送信成功後は完了表示に切り替える。プレビュー時は API を呼ばずに完了表示まで遷移する。
//
// 設問 UI は LIFF primitives (LiffInput / LiffTextarea / LiffRadioGroup / LiffCheckboxGroup) に
// 集約しており、見た目・状態 (focus / error / disabled) と余白を共通化している。

import { useState } from "react";
import type { LiffPageConfigSettings, SurveyItem } from "@/types";
import { LiffShareButton } from "./LiffShareButton";
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
      {/* 画面内ヘッダーは廃止。document.title (= LIFF 上部バー) で文脈表現する。 */}
      <main className="liff-player-main pt-5 pb-24 flex flex-col gap-4">
        {/* ページタイトル h2 は廃止。description だけ表示。 */}
        {config.description && (
          <p className={`text-[14px] leading-relaxed text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words ${liffDescriptionAlignClass(config.settings_json)}`}>
            {config.description}
          </p>
        )}

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

        {config.settings_json.share_enabled && (
          <div className="pt-2">
            <LiffShareButton settings={config.settings_json} pageTitle={config.title || ""} preview={preview} />
          </div>
        )}
      </main>
    </div>
  );
}

// ── 設問: LiffInput / LiffTextarea / LiffRadioGroup / LiffCheckboxGroup を使う ─
// 共通の Question Card 構造 (label / required / control / helper) は primitives 側で持つ。
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

  if (item.input_type === "textarea") {
    return (
      <LiffTextarea
        label={labelText}
        required={required}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (item.input_type === "radio" && Array.isArray(item.options) && item.options.length > 0) {
    const selected = typeof value === "string" ? value : "";
    return (
      <LiffRadioGroup
        label={labelText}
        required={required}
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
        label={labelText}
        required={required}
        options={item.options}
        value={selected}
        onChange={(next) => onChange(next)}
      />
    );
  }

  // 既定: text
  return (
    <LiffInput
      label={labelText}
      required={required}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
