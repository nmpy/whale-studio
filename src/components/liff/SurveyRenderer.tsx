"use client";

// src/components/liff/SurveyRenderer.tsx
// LIFF Survey モード — フォームを表示し、送信ボタンで /api/liff/works/[workId]/survey-responses に送信する。
// 送信成功後は完了表示に切り替える。プレビュー時は API を呼ばずに完了表示まで遷移する。
//
// 設問 UI は LIFF 新UI foundation (ui/: LiffQuestionCard + LiffTextInput / LiffUiTextarea /
// LiffChoiceRow) に集約。1 設問 = カード（Q バッジ + 設問文 + 右ヒント）+ children に control。
// ※ payload / validate() / submit / preview / completed は不変（UI 構造のみの差し替え）。

import { useState, type ReactNode } from "react";
import type { LiffPageConfigSettings, SurveyItem } from "@/types";
import { liffRootClass } from "./liff-style-helpers";
import { LineRegisterReportButton } from "./LineRegisterReportButton";
import {
  LiffActionButton,
  LiffEmptyState,
  LiffQuestionCard,
  LiffTextInput,
  LiffTextarea as LiffUiTextarea,
  LiffChoiceRow,
} from "./ui";

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
        {/* 説明文（config.description）は LiffSinglePageRenderer のページ見出し側で 1 度だけ表示する。
            ここで再表示すると二重になるため出さない（document.title は LINE 上部バー）。 */}
        {completed ? (
          config.settings_json.survey_line_register_report ? (
            // opt-in: 回答保存成功後に LINE への「登録完了報告」導線を出す（固定文言）。
            <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[16px] px-5 py-7 text-center">
              <p className="text-3xl mb-3 text-[color:var(--liff-line-green)]">✓</p>
              <h3 className="text-[17px] font-bold leading-snug mb-2">エージェント情報を受け付けました。</h3>
              <p className="text-[14px] leading-[1.8] text-[color:var(--liff-secondary-text)]">最後に、下のボタンから登録完了を本部へ報告してください。</p>
              <LineRegisterReportButton preview={preview} />
            </div>
          ) : (
            <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[16px] px-5 py-7 text-center">
              <p className="text-3xl mb-3 text-[color:var(--liff-line-green)]">✓</p>
              <p className="text-[15px] leading-[1.8] whitespace-pre-wrap" style={{ letterSpacing: "0.02em" }}>{thanksMessage}</p>
            </div>
          )
        ) : items.length === 0 ? (
          <LiffEmptyState text="（アンケート項目が登録されていません）" />
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
              <LiffActionButton
                type="submit"
                variant="filled"
                loading={submitting}
                loadingLabel="送信中..."
              >
                回答を送信する
              </LiffActionButton>
            </div>
          </form>
        )}

      </main>
    </div>
  );
}

// ── 設問: LiffQuestionCard + 下線 control（LiffTextInput / LiffUiTextarea / LiffChoiceRow）─
// 右寄せヒント（必須 * / 複数選択可 / 任意）を組み立てて LiffQuestionCard の hint に渡す。
// ※ #379 の反省: primitive の label に複合 ReactNode を注入しない。カード（badge/設問/hint）は
//    LiffQuestionCard が所有し、ここは hint プロップ用の小片だけを返す（QuestionCard 標準API）。
//    required の検証は親 SurveyRenderer の validate() に集約（HTML required は付けない＝挙動を増やさない）。
// デザイン仕様: 設問文は 15px・normal weight（LiffQuestionCard 既定の太字を上書き）。
const SURVEY_QUESTION_CLASS =
  "text-[15px] font-normal leading-snug text-[color:var(--liff-primary-text)] break-words";

function buildSurveyHint(item: SurveyItem): ReactNode {
  const parts: ReactNode[] = [];
  if (item.input_type === "checkbox") parts.push(<span key="multi">複数選択可</span>);
  if (item.required) {
    parts.push(
      <span key="req" aria-label="必須" className="text-[color:var(--liff-danger,#E22B2B)] font-bold">*</span>,
    );
  } else if (item.input_type === "text" || item.input_type === "textarea") {
    parts.push(<span key="opt">任意</span>);
  }
  return parts.length > 0 ? <>{parts}</> : undefined;
}

// 1 設問 = LiffQuestionCard（Q バッジ + 設問文 + 右ヒント）+ children に control。
// 入力欄は ui/ の下線 control（LiffTextInput / LiffUiTextarea / LiffChoiceRow）に統一（box 混在しない）。
function SurveyField({
  item, index, value, onChange,
}: {
  item: SurveyItem;
  index: number;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
}) {
  const labelText = item.question?.trim() || `Q${index + 1}`;
  const name = `q${index}`;
  const labelId = `${name}-label`;
  const hint = buildSurveyHint(item);

  if (item.input_type === "textarea") {
    return (
      <LiffQuestionCard question={labelText} hint={hint} labelId={labelId} questionClassName={SURVEY_QUESTION_CLASS}>
        <LiffUiTextarea
          aria-labelledby={labelId}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </LiffQuestionCard>
    );
  }

  if (item.input_type === "radio" && Array.isArray(item.options) && item.options.length > 0) {
    const selected = typeof value === "string" ? value : "";
    return (
      <LiffQuestionCard question={labelText} hint={hint} labelId={labelId} questionClassName={SURVEY_QUESTION_CLASS}>
        <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col">
          {item.options.map((opt) => (
            <LiffChoiceRow
              key={opt}
              type="radio"
              name={name}
              value={opt}
              checked={selected === opt}
              onChange={(val) => onChange(val)}
              label={opt}
            />
          ))}
        </div>
      </LiffQuestionCard>
    );
  }

  if (item.input_type === "checkbox" && Array.isArray(item.options) && item.options.length > 0) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <LiffQuestionCard question={labelText} hint={hint} labelId={labelId} questionClassName={SURVEY_QUESTION_CLASS}>
        <div role="group" aria-labelledby={labelId} className="flex flex-col">
          {item.options.map((opt) => (
            <LiffChoiceRow
              key={opt}
              type="checkbox"
              value={opt}
              checked={selected.includes(opt)}
              onChange={(val, checked) =>
                onChange(checked ? [...selected, val] : selected.filter((x) => x !== val))
              }
              label={opt}
            />
          ))}
        </div>
      </LiffQuestionCard>
    );
  }

  // 既定: text（radio/checkbox で options 未設定もここに落ちる＝従来どおり）
  return (
    <LiffQuestionCard question={labelText} hint={hint} labelId={labelId} questionClassName={SURVEY_QUESTION_CLASS}>
      <LiffTextInput
        aria-labelledby={labelId}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </LiffQuestionCard>
  );
}
