"use client";

// src/components/liff/SurveyRenderer.tsx
// LIFF Survey モード — フォームを表示し、送信ボタンで /api/liff/works/[workId]/survey-responses に送信する。
// 送信成功後は完了表示に切り替える。プレビュー時は API を呼ばずに完了表示まで遷移する。
//
// 設問 UI は LIFF 新UI foundation (ui/: LiffQuestionCard + LiffTextInput / LiffUiTextarea /
// LiffChoiceRow) に集約。1 設問 = カード（Q バッジ + 設問文 + 右ヒント）+ children に control。
// ※ payload / validate() / submit / preview / completed は不変（UI 構造のみの差し替え）。

import { useEffect, useState, type ReactNode } from "react";
import type { LiffPageConfigSettings, SurveyItem } from "@/types";
import { liffRootClass } from "./liff-style-helpers";
import { SurveyCompletionButton } from "./SurveyCompletionButton";
import { isMultipleAllowed, resolveAlreadyAnsweredMessage } from "@/lib/liff/survey-completion";
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
  const allowMultiple = isMultipleAllowed(config.settings_json);
  const alreadyAnsweredMessage = resolveAlreadyAnsweredMessage(config.settings_json);

  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [alreadyAnswered, setAlreadyAnswered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 再アクセス時の回答済み判定（サーバーの回答データで判定・localStorage 非依存）。
  //   複数回答不可 かつ LINE ユーザー特定可 かつ page 特定可 のときのみ問い合わせる。
  //   判定できない/失敗時はフォームを表示し、送信時に POST 側 409 を最終防波堤とする。
  const needAnsweredCheck = !preview && !!lineUserId && !!config.page_id && !allowMultiple;
  const [checkingAnswered, setCheckingAnswered] = useState(needAnsweredCheck);

  useEffect(() => {
    if (!needAnsweredCheck) {
      setCheckingAnswered(false);
      return;
    }
    setCheckingAnswered(true); // lineUserId が遅れて届いた場合もフォームを一瞬出さずに判定する
    let cancelled = false;
    (async () => {
      try {
        const url = `/api/liff/works/${config.work_id}/survey-responses`
          + `?page_id=${encodeURIComponent(config.page_id!)}`
          + `&line_user_id=${encodeURIComponent(lineUserId!)}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!cancelled && json?.success && json.data?.answered === true) {
          setAlreadyAnswered(true);
        }
      } catch {
        // 判定失敗時はフォームを表示（送信時の POST 側 409 で二重回答は防止）。
      } finally {
        if (!cancelled) setCheckingAnswered(false);
      }
    })();
    return () => { cancelled = true; };
  }, [needAnsweredCheck, config.work_id, config.page_id, lineUserId]);

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
        // 送信直前に他経路で回答済みになった / 競合送信 → 回答済み画面へ（重複登録しない）。
        if (res.status === 409 || json.error?.code === "ALREADY_ANSWERED") {
          setAlreadyAnswered(true);
          return;
        }
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
        {checkingAnswered ? (
          <div className="px-5 py-7 text-center text-[14px] text-[color:var(--liff-secondary-text)]">読み込み中...</div>
        ) : alreadyAnswered ? (
          // 回答済み画面: フォームは出さず、回答済みメッセージ + 完了後ボタン。
          <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[16px] px-5 py-7 text-center">
            <p className="text-[15px] leading-[1.8] whitespace-pre-wrap" style={{ letterSpacing: "0.02em" }}>{alreadyAnsweredMessage}</p>
            <SurveyCompletionButton settings={config.settings_json} preview={preview} />
          </div>
        ) : completed ? (
          // 送信完了画面: 送信完了メッセージ + 完了後ボタン。
          <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[16px] px-5 py-7 text-center">
            <p className="text-3xl mb-3 text-[color:var(--liff-line-green)]">✓</p>
            <p className="text-[15px] leading-[1.8] whitespace-pre-wrap" style={{ letterSpacing: "0.02em" }}>{thanksMessage}</p>
            <SurveyCompletionButton settings={config.settings_json} preview={preview} />
          </div>
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
