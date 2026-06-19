"use client";

// src/components/liff/ContactRenderer.tsx
// LIFF お問い合わせ（page_type="contact"）— フォームを表示し /api/liff/works/[workId]/contact に送信する。
// 送信成功後は完了表示。プレビュー時は API を呼ばず完了表示まで遷移する。
// バリデーション（必須/メール形式/本文100文字）は contact-helpers をクライアント/サーバで共有する。
//
// UI は LIFF 新UI foundation（ui/: 下線 LiffTextInput / LiffUiTextarea / LiffChoiceRow / LiffActionButton）
// に寄せる。フォーム全体を 1 枚の白カードにし、各項目はラベル + 下線 control で並べる。
// ※ payload / validate / submit / Slack 通知 / LiffSubmission 保存 / custom fields は不変（見た目のみ）。

import { useState } from "react";
import type { LiffPageConfigSettings, SurveyItem } from "@/types";
import { liffRootClass } from "./liff-style-helpers";
import {
  LiffActionButton,
  LiffTextInput,
  LiffTextarea as LiffUiTextarea,
  LiffChoiceRow,
} from "./ui";
import {
  resolveContactConfig,
  validateContactSubmission,
  CONTACT_BODY_MAX,
  CONTACT_LABELS,
  type ContactPayload,
} from "./contact-helpers";

export interface ContactRendererConfig {
  work_id:       string;
  page_id?:      string;
  work_title?:   string | null;
  title:         string | null;
  description:   string | null;
  settings_json: LiffPageConfigSettings;
}

interface Props {
  config: ContactRendererConfig;
  preview?: boolean;
  lineUserId?: string | null;
}

type CustomAnswers = Record<string, string | string[]>;
function customItemKey(item: SurveyItem, idx: number): string {
  return item.id || `q${idx}`;
}

// フォームラベル（15px / normal）+ 必須マーク *（赤）。primitive の label slot には注入しない。
function ContactLabel({
  text, required, htmlFor, id, className,
}: {
  text: string;
  required?: boolean;
  /** input と関連付ける（input 系で使用）。 */
  htmlFor?: string;
  /** group の aria-labelledby 参照先（radio/checkbox group で使用）。 */
  id?: string;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} id={id} className={`block text-[15px] font-normal text-[color:var(--liff-primary-text)] ${className ?? ""}`}>
      {text}
      {required && <span className="ml-1 text-[color:var(--liff-danger,#E0405A)]">*</span>}
    </label>
  );
}

export function ContactRenderer({ config, preview, lineUserId }: Props) {
  const cfg = resolveContactConfig(config.settings_json);

  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [custom, setCustom] = useState<CustomAnswers>({});
  const [honeypot, setHoneypot] = useState(""); // bot 用の隠しフィールド（人間は触らない）

  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payload = (): ContactPayload => ({
    category: cfg.categories.length > 0 ? category : null,
    name:     cfg.showName ? name : null,
    email:    cfg.showEmail ? email : null,
    body,
    custom_answers: custom,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = validateContactSubmission(cfg, payload());
    if (v) { setError(v); return; }
    if (preview) { setCompleted(true); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/liff/works/${config.work_id}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page_id:      config.page_id ?? null,
          line_user_id: lineUserId ?? null,
          category:     cfg.categories.length > 0 ? category : null,
          name:         cfg.showName ? name : null,
          email:        cfg.showEmail ? email : null,
          body,
          custom_answers: custom,
          honeypot,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
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
      <main className="liff-player-main pt-5 pb-24 flex flex-col gap-4">
        {/* 説明文（config.description）は LiffSinglePageRenderer のページ見出し側で 1 度だけ表示する。
            ここで再表示すると二重になるため出さない（document.title は LINE 上部バー）。 */}
        {completed ? (
          // サンクスカード: 白カード + 緑ソフトの丸 + チェック + 既存 successMessage。
          <div className="bg-[color:var(--liff-surface,#fff)] rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.05)] px-6 py-11 text-center">
            <div className="mx-auto mb-4 flex w-[58px] h-[58px] items-center justify-center rounded-full bg-[color:var(--liff-ui-green-soft,#E8F9EE)] text-[28px] text-[color:var(--liff-line-green,#06C755)]">
              ✓
            </div>
            <p className="text-[15px] leading-[1.85] whitespace-pre-wrap text-[color:var(--liff-primary-text)]">{cfg.successMessage}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* フォーム全体 = 1 枚の白カード（radius 10 / 薄影）。section 間隔 22px。 */}
            <div className="bg-[color:var(--liff-surface,#fff)] rounded-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.05)] px-4 pt-[18px] pb-3 flex flex-col gap-[22px]">
              {/* 問い合わせ種別 */}
              {cfg.categories.length > 0 && (
                <div>
                  <ContactLabel id="contact-category-label" text={CONTACT_LABELS.category} required={cfg.categoryRequired} className="mb-1.5" />
                  <div role="radiogroup" aria-labelledby="contact-category-label" className="flex flex-col">
                    {cfg.categories.map((opt) => (
                      <LiffChoiceRow
                        key={opt}
                        type="radio"
                        name="contact_category"
                        value={opt}
                        checked={category === opt}
                        onChange={(val) => setCategory(val)}
                        label={opt}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* お名前 */}
              {cfg.showName && (
                <div>
                  <ContactLabel htmlFor="contact-name" text={CONTACT_LABELS.name} required={cfg.nameRequired} className="mb-1.5" />
                  <LiffTextInput id="contact-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              )}

              {/* メールアドレス */}
              {cfg.showEmail && (
                <div>
                  <ContactLabel htmlFor="contact-email" text={CONTACT_LABELS.email} required={cfg.emailRequired} className="mb-1.5" />
                  <LiffTextInput id="contact-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              )}

              {/* お問い合わせ内容（既存仕様: 最大 CONTACT_BODY_MAX 文字・カウンター付き） */}
              <div>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <ContactLabel htmlFor="contact-body" text={CONTACT_LABELS.body} required={cfg.bodyRequired} />
                  <span className="shrink-0 whitespace-nowrap text-[12px] text-[color:var(--liff-tertiary-text)] tabular-nums">{body.length}/{CONTACT_BODY_MAX}</span>
                </div>
                <LiffUiTextarea
                  id="contact-body"
                  value={body}
                  maxLength={CONTACT_BODY_MAX}
                  onChange={(e) => setBody(e.target.value.slice(0, CONTACT_BODY_MAX))}
                />
              </div>

              {/* その他項目 */}
              {cfg.customFields.map((it, idx) => (
                <ContactCustomField
                  key={customItemKey(it, idx)}
                  item={it}
                  index={idx}
                  value={custom[customItemKey(it, idx)]}
                  onChange={(val) => setCustom((p) => ({ ...p, [customItemKey(it, idx)]: val }))}
                />
              ))}

              {/* honeypot（bot 検出用・人間には見えない） */}
              <input
                type="text"
                name="company_website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
              />
            </div>

            {error && (
              <p className="text-[12px] text-[color:var(--liff-danger,#E0405A)] leading-[1.6]" role="alert">{error}</p>
            )}

            <div className="mt-1">
              <LiffActionButton type="submit" variant="filled" loading={submitting} loadingLabel="送信中...">
                送信する
              </LiffActionButton>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

// その他項目（SurveyField と同じロジック）。ラベル + 下線 control（box primitive は使わない）。
function ContactCustomField({
  item, index, value, onChange,
}: {
  item: SurveyItem;
  index: number;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
}) {
  const labelText = item.question?.trim() || `項目${index + 1}`;
  const required = !!item.required;
  const fieldId = `contact-custom-${item.id || index}`;
  const labelId = `${fieldId}-label`;

  if (item.input_type === "textarea") {
    return (
      <div>
        <ContactLabel htmlFor={fieldId} text={labelText} required={required} className="mb-1.5" />
        <LiffUiTextarea id={fieldId} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }

  if (item.input_type === "radio" && Array.isArray(item.options) && item.options.length > 0) {
    const selected = typeof value === "string" ? value : "";
    return (
      <div>
        <ContactLabel id={labelId} text={labelText} required={required} className="mb-1.5" />
        <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col">
          {item.options.map((opt) => (
            <LiffChoiceRow key={opt} type="radio" name={`c${index}`} value={opt} checked={selected === opt} onChange={(val) => onChange(val)} label={opt} />
          ))}
        </div>
      </div>
    );
  }

  if (item.input_type === "checkbox" && Array.isArray(item.options) && item.options.length > 0) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div>
        <ContactLabel id={labelId} text={labelText} required={required} className="mb-1.5" />
        <div role="group" aria-labelledby={labelId} className="flex flex-col">
          {item.options.map((opt) => (
            <LiffChoiceRow
              key={opt}
              type="checkbox"
              value={opt}
              checked={selected.includes(opt)}
              onChange={(val, checked) => onChange(checked ? [...selected, val] : selected.filter((x) => x !== val))}
              label={opt}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <ContactLabel htmlFor={fieldId} text={labelText} required={required} className="mb-1.5" />
      <LiffTextInput id={fieldId} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
