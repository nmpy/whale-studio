"use client";

// src/components/liff/ContactRenderer.tsx
// LIFF お問い合わせ（page_type="contact"）— フォームを表示し /api/liff/works/[workId]/contact に送信する。
// 送信成功後は完了表示。プレビュー時は API を呼ばず完了表示まで遷移する。
// バリデーション（必須/メール形式/本文100文字）は contact-helpers をクライアント/サーバで共有する。

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
        {config.description && (
          <p className={`text-[14px] leading-relaxed text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words ${liffDescriptionAlignClass(config.settings_json)}`}>
            {config.description}
          </p>
        )}

        {completed ? (
          <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[16px] px-5 py-7 text-center">
            <p className="text-3xl mb-3 text-[color:var(--liff-line-green)]">✓</p>
            <p className="text-[15px] leading-[1.8] whitespace-pre-wrap" style={{ letterSpacing: "0.02em" }}>{cfg.successMessage}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {/* 問い合わせ種別 */}
            {cfg.categories.length > 0 && (
              <LiffRadioGroup
                label={CONTACT_LABELS.category}
                required={cfg.categoryRequired}
                options={cfg.categories}
                name="contact_category"
                value={category}
                onChange={setCategory}
              />
            )}

            {/* お名前 */}
            {cfg.showName && (
              <LiffInput label={CONTACT_LABELS.name} required={cfg.nameRequired} value={name} onChange={(e) => setName(e.target.value)} />
            )}

            {/* メールアドレス */}
            {cfg.showEmail && (
              <LiffInput label={CONTACT_LABELS.email} required={cfg.emailRequired} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            )}

            {/* お問い合わせ内容（最大100文字・カウンター付き） */}
            <div>
              <LiffTextarea
                label={CONTACT_LABELS.body}
                required={cfg.bodyRequired}
                value={body}
                maxLength={CONTACT_BODY_MAX}
                onChange={(e) => setBody(e.target.value.slice(0, CONTACT_BODY_MAX))}
              />
              <p className="mt-1 text-[11px] text-[color:var(--liff-tertiary-text)] text-right">{body.length}/{CONTACT_BODY_MAX}</p>
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

            {error && (
              <p className="text-[14px] text-[color:var(--liff-danger)] leading-[1.6]" role="alert">{error}</p>
            )}

            <div className="mt-2">
              <LiffButton type="submit" variant="primary" loading={submitting} loadingLabel="送信中...">
                送信する
              </LiffButton>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

// その他項目（SurveyField と同じロジック）。
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

  if (item.input_type === "textarea") {
    return <LiffTextarea label={labelText} required={required} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />;
  }
  if (item.input_type === "radio" && Array.isArray(item.options) && item.options.length > 0) {
    return <LiffRadioGroup label={labelText} required={required} options={item.options} name={`c${index}`} value={typeof value === "string" ? value : ""} onChange={(next) => onChange(next)} />;
  }
  if (item.input_type === "checkbox" && Array.isArray(item.options) && item.options.length > 0) {
    return <LiffCheckboxGroup label={labelText} required={required} options={item.options} value={Array.isArray(value) ? value : []} onChange={(next) => onChange(next)} />;
  }
  return <LiffInput label={labelText} required={required} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />;
}
