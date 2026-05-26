"use client";

// src/app/oas/[id]/account/page.tsx
// GET   /api/oas/:id → フォームプリフィル
// PATCH /api/oas/:id → アカウント情報 + LINE接続情報の更新 (= oaApi.update)
//
// Phase 2.1: UI を Phase 0 トークン + shared/Button に揃える。
// 保存 payload / API endpoint / toast / router 遷移 / validation は完全維持。

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { oaApi, getDevToken } from "@/lib/api-client";
import { MaskedField } from "@/components/MaskedField";
import { useToast } from "@/components/Toast";
import { Button, buttonClass } from "@/components/shared";
import type { PublishStatus } from "@/types";

interface FormState {
  title:                string;
  description:          string;
  channel_id:           string;
  channel_secret:       string;
  channel_access_token: string;
  publish_status:       PublishStatus;
}

const STATUS_OPTIONS: { value: PublishStatus; label: string; desc: string }[] = [
  { value: "draft",  label: "未設定", desc: "LINE と未接続" },
  { value: "active", label: "稼働中", desc: "Webhook 受信中" },
  { value: "paused", label: "停止中", desc: "一時停止中" },
];

// ── 共通: 必須マーク ──
function RequiredMark() {
  return <span aria-hidden="true" className="ml-0.5 text-danger">*</span>;
}

// ── 共通: section heading (= ガイド §1 風の控えめなブロック見出し) ──
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-[13px] font-bold text-ink">{children}</p>
  );
}

export default function OaAccountPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const router = useRouter();
  const { showToast } = useToast();

  // ── OA フォーム ──
  const [oaTitle, setOaTitle]         = useState("");
  const [form, setForm]               = useState<FormState | null>(null);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [errors, setErrors]           = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting]   = useState(false);

  useEffect(() => {
    oaApi.get(getDevToken(), oaId)
      .then((oa) => {
        setOaTitle(oa.title);
        setForm({
          title:                oa.title,
          description:          oa.description ?? "",
          channel_id:           oa.channel_id,
          channel_secret:       oa.channel_secret,
          channel_access_token: oa.channel_access_token,
          publish_status:       oa.publish_status,
        });
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [oaId]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => f ? { ...f, [key]: value } : null);
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;

    const errs: Record<string, string[]> = {};
    if (!form.title.trim())                errs.title                = ["アカウント名を入力してください"];
    if (!form.channel_id.trim())           errs.channel_id           = ["Channel ID を入力してください"];
    if (!form.channel_secret.trim())       errs.channel_secret       = ["Channel Secret を入力してください"];
    if (!form.channel_access_token.trim()) errs.channel_access_token = ["Channel Access Token を入力してください"];
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSubmitting(true);
    try {
      await oaApi.update(getDevToken(), oaId, {
        title:                form.title.trim(),
        description:          form.description.trim() || undefined,
        channel_id:           form.channel_id.trim(),
        channel_secret:       form.channel_secret.trim(),
        channel_access_token: form.channel_access_token.trim(),
        publish_status:       form.publish_status,
      });
      showToast("アカウント情報を保存しました", "success");
      router.push(`/oas/${oaId}/settings`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  // ── breadcrumb ──
  const breadcrumbItems = [
    { label: "アカウントリスト", href: "/oas" },
    ...(oaTitle ? [{ label: oaTitle, href: `/oas/${oaId}/works` }] : []),
    { label: "設定", href: `/oas/${oaId}/settings` },
    { label: "アカウント情報" },
  ];

  // ── ヘッダー (= 各 state 共通) ──
  const header = (
    <div className="mb-5">
      <Breadcrumb items={breadcrumbItems} />
      <h2 className="font-round mt-1 text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
        アカウント情報
      </h2>
      <p className="mt-1 text-[13px] text-ink-2">
        アカウント名・LINE接続情報・接続ステータスを管理します。
      </p>
    </div>
  );

  // ── ローディング (skeleton) ──
  if (!form && !loadError) {
    return (
      <>
        {header}
        <div className="w-full max-w-[560px] rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="mb-5">
              <div className="skeleton mb-1.5" style={{ width: 100, height: 13, borderRadius: 4 }} />
              <div className="skeleton" style={{ height: 36, borderRadius: 8 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  // ── ロードエラー ──
  if (loadError) {
    return (
      <>
        {header}
        <div
          role="alert"
          className="rounded-field border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] leading-[1.6] text-danger"
        >
          {loadError}
        </div>
      </>
    );
  }

  return (
    <>
      {header}

      {/* ── OA 設定フォーム ── */}
      <div className="w-full max-w-[560px] rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6">
        <form onSubmit={handleSubmit}>

          {/* ── アカウント基本情報 ── */}
          <SectionHeading>アカウント基本情報</SectionHeading>

          {/* title */}
          <div className="mb-5">
            <label htmlFor="title" className="mb-1.5 block text-[13px] font-bold text-ink">
              アカウント名<RequiredMark />
            </label>
            <input
              id="title"
              type="text"
              value={form!.title}
              onChange={(e) => setField("title", e.target.value)}
              placeholder="例: ミステリー作品公式"
              maxLength={100}
              aria-required="true"
              aria-invalid={errors.title ? "true" : undefined}
              aria-describedby={errors.title ? "title-error" : undefined}
            />
            {errors.title?.map((m) => (
              <p key={m} id="title-error" role="alert" className="field-error">{m}</p>
            ))}
          </div>

          {/* description */}
          <div className="mb-5">
            <label htmlFor="description" className="mb-1.5 block text-[13px] font-bold text-ink">
              メモ（任意）
            </label>
            <textarea
              id="description"
              value={form!.description}
              onChange={(e) => setField("description", e.target.value)}
              placeholder="このアカウントについてのメモ"
              maxLength={500}
            />
          </div>

          {/* publish_status — radio card 3 枚 */}
          <div className="mb-5">
            <span id="publish-status-label" className="mb-1.5 block text-[13px] font-bold text-ink">
              接続ステータス
            </span>
            <div
              role="radiogroup"
              aria-labelledby="publish-status-label"
              className="flex flex-col gap-2"
            >
              {STATUS_OPTIONS.map(({ value, label, desc }) => {
                const selected = form!.publish_status === value;
                return (
                  <label
                    key={value}
                    className={
                      "flex cursor-pointer items-start gap-2.5 rounded-field border-2 px-3 py-2.5 transition-colors " +
                      (selected
                        ? "border-brand bg-brand-soft"
                        : "border-line bg-surface hover:bg-bg-tint")
                    }
                  >
                    <input
                      type="radio"
                      name="publish_status"
                      value={value}
                      checked={selected}
                      onChange={() => setField("publish_status", value)}
                      className="mt-[3px] accent-brand"
                    />
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold text-ink">{label}</div>
                      <div className="text-[12px] text-ink-2">{desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <hr className="my-6 border-0 border-t border-line-2" />

          {/* ── LINE 接続情報 ── */}
          <SectionHeading>LINE 接続情報</SectionHeading>
          <div
            role="status"
            className="mb-5 rounded-field border border-sky/30 bg-sky-soft px-4 py-3 text-[13px] leading-[1.6] text-sky-ink"
          >
            LINE Developers コンソール → Messaging API タブから取得してください。
            変更しない場合もそのまま保存できます。
          </div>

          {/* channel_id */}
          <div className="mb-5">
            <label htmlFor="channel_id" className="mb-1.5 block text-[13px] font-bold text-ink">
              Channel ID<RequiredMark />
            </label>
            <input
              id="channel_id"
              type="text"
              value={form!.channel_id}
              onChange={(e) => setField("channel_id", e.target.value)}
              placeholder="例: 1234567890"
              style={{ fontFamily: "ui-monospace, monospace" }}
              aria-required="true"
              aria-invalid={errors.channel_id ? "true" : undefined}
              aria-describedby={errors.channel_id ? "channel_id-error" : undefined}
            />
            {errors.channel_id?.map((m) => (
              <p key={m} id="channel_id-error" role="alert" className="field-error">{m}</p>
            ))}
          </div>

          {/* channel_secret / channel_access_token — MaskedField は別 PR スコープ、本 PR では触らない */}
          <MaskedField
            id="channel_secret"
            label="Channel Secret"
            value={form!.channel_secret}
            onChange={(v) => setField("channel_secret", v)}
            required
            errorMessages={errors.channel_secret}
          />

          <MaskedField
            id="channel_access_token"
            label="Channel Access Token"
            value={form!.channel_access_token}
            onChange={(v) => setField("channel_access_token", v)}
            required
            errorMessages={errors.channel_access_token}
          />

          {/* form actions */}
          <div className="mt-7 flex flex-col-reverse items-stretch gap-3 border-t border-line-2 pt-5 sm:flex-row sm:items-center sm:justify-end">
            <Link
              href={`/oas/${oaId}/settings`}
              className={buttonClass({ variant: "ghost", size: "md" })}
            >
              キャンセル
            </Link>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={submitting}
              aria-busy={submitting || undefined}
            >
              {submitting && <span className="spinner" aria-hidden="true" />}
              {submitting ? "保存中..." : "保存する"}
            </Button>
          </div>

        </form>
      </div>
    </>
  );
}
