"use client";

// src/app/contact/_content.tsx
// /contact のフォーム本体 (Client Component)。
//
// 設計メモ:
// - 送信先は現状 POST /api/feedback に相乗り。将来 /api/contact に差し替えやすいよう、
//   submit 内の fetch を 1 箇所に集約している。
// - 利用予定 (intent) は ?type で初期選択を切り替えるため、親 Server Component から
//   props で受け取る。
// - 認証/Stripe には触れない。/api/feedback の既存契約に合わせて payload を組み立てる。

import { useState, type FormEvent } from "react";
import { buttonClass } from "@/components/shared";

export type ContactIntent = "enterprise" | "onboarding" | "production" | "other";

const INTENT_OPTIONS: { value: ContactIntent; label: string }[] = [
  { value: "enterprise", label: "法人利用" },
  { value: "onboarding", label: "導入サポート" },
  { value: "production", label: "作品設定代行" },
  { value: "other",      label: "その他" },
];

const INTENT_LABEL: Record<ContactIntent, string> = INTENT_OPTIONS.reduce(
  (acc, o) => {
    acc[o.value] = o.label;
    return acc;
  },
  {} as Record<ContactIntent, string>,
);

// 将来 /api/contact に差し替えるときはこの定数だけ変更する。
const SUBMIT_ENDPOINT = "/api/feedback";

interface ContactFormState {
  name:    string;
  company: string;
  email:   string;
  intent:  ContactIntent;
  message: string;
}

export default function ContactContent({
  initialIntent,
}: {
  initialIntent: ContactIntent;
}) {
  const [form, setForm] = useState<ContactFormState>({
    name:    "",
    company: "",
    email:   "",
    intent:  initialIntent,
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [done, setDone]             = useState(false);

  function update<K extends keyof ContactFormState>(key: K, value: ContactFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    // 必須チェック (HTML required と二重だが、念のため明示)
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      setError("お名前・メールアドレス・相談内容は必須です。");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // GAS 側でも判別しやすいよう、本文に会社名・利用予定を組み込む。
      const content =
        `[Whale Studio お問い合わせ]\n` +
        `お名前: ${form.name.trim()}\n` +
        `会社名・団体名: ${form.company.trim() || "(未入力)"}\n` +
        `利用予定: ${INTENT_LABEL[form.intent]}\n` +
        `--- 相談内容 ---\n${form.message.trim()}`;

      const res = await fetch(SUBMIT_ENDPOINT, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // /api/feedback の既存スキーマに合わせる
          content,
          category:   "other",
          page_name:  "Contact",
          page_url:   typeof window !== "undefined" ? window.location.href : "/contact",
          user_name:  form.name.trim(),
          user_email: form.email.trim(),
          oa_id:      null,
          oa_name:    null,
          work_id:    null,
          work_name:  null,
        }),
      });

      if (!res.ok) {
        // バックエンドが返した error 文字列を優先表示
        let msg = "送信に失敗しました。時間をおいて再度お試しください。";
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error && typeof j.error === "string") msg = j.error;
        } catch {
          /* JSON でなければ既定文言 */
        }
        throw new Error(msg);
      }

      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "送信に失敗しました。";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-card border border-brand-mist bg-brand-soft p-6 text-center">
        <h2 className="font-round text-[16px] font-bold text-brand-ink">
          ご相談を受け付けました
        </h2>
        <p className="mt-2 text-[13px] leading-[1.85] text-ink-2">
          内容を確認のうえ、担当者よりご記入のメールアドレス宛にご連絡いたします。
        </p>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
      <div className="form-group">
        <label htmlFor="contact-name" className="form-label">
          お名前 <span className="text-danger">*</span>
        </label>
        <input
          id="contact-name"
          type="text"
          required
          autoComplete="name"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="form-group">
        <label htmlFor="contact-company" className="form-label">
          会社名・団体名
        </label>
        <input
          id="contact-company"
          type="text"
          autoComplete="organization"
          value={form.company}
          onChange={(e) => update("company", e.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="form-group">
        <label htmlFor="contact-email" className="form-label">
          メールアドレス <span className="text-danger">*</span>
        </label>
        <input
          id="contact-email"
          type="email"
          required
          autoComplete="email"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          disabled={submitting}
        />
      </div>

      <fieldset className="form-group">
        <legend className="form-label">利用予定</legend>
        <div className="radio-group mt-1">
          {INTENT_OPTIONS.map((opt) => (
            <label key={opt.value}>
              <input
                type="radio"
                name="intent"
                value={opt.value}
                checked={form.intent === opt.value}
                onChange={() => update("intent", opt.value)}
                disabled={submitting}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="form-group">
        <label htmlFor="contact-message" className="form-label">
          相談内容 <span className="text-danger">*</span>
        </label>
        <textarea
          id="contact-message"
          required
          rows={7}
          placeholder="作品の概要、想定規模、希望時期などをお書きください。"
          value={form.message}
          onChange={(e) => update("message", e.target.value)}
          disabled={submitting}
        />
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className={buttonClass({
          variant:   "primary",
          size:      "md",
          fullWidth: true,
          className: "!py-3 !text-[14px]",
        })}
      >
        {submitting ? "送信中..." : "送信する"}
      </button>
    </form>
  );
}
