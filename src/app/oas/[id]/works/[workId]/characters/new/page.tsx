"use client";

// src/app/oas/[id]/works/[workId]/characters/new/page.tsx
// 作品配下キャラクター 新規作成フォーム。
// Phase 4.1b: UI を Phase 0 トークン + shared/Button + buttonClass に揃える。
// ImageUploadField 本体 / ViewerBanner / Breadcrumb / API / 認可ロジックは触らない。
// create payload 6 キー (work_id / name / icon_type / icon_image_url / sort_order / is_active) と
// name.trim() / icon_image_url.trim() / icon_type:"image" の送信構造は完全維持。
// toast 文言 / router 遷移 / validation 文言 / submitting state / canEdit ゲートも完全維持。

import { useState } from "react";
import { useParams } from "next/navigation";
import { useTesterRouter as useRouter } from "@/hooks/useTesterRouter";
import { TLink as Link } from "@/components/TLink";
import { Breadcrumb } from "@/components/Breadcrumb";
import { characterApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";
import { ImageUploadField } from "@/components/ImageUploadField";
import { Button, buttonClass } from "@/components/shared";

// キャラクターアイコンの対応形式 (GIF は対象外)。
const ICON_ACCEPT = "image/jpeg,image/png,image/webp";
const ICON_FORMATS_TEXT = "対応形式: JPEG / PNG / WebP (最大 5MB)";

// ── ローカル共通: 必須マーク (= /account / works edit と同じパターン) ──
function RequiredMark() {
  return <span aria-hidden="true" className="ml-0.5 text-danger">*</span>;
}

// ── ローカル共通: section heading ──
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-[13px] font-bold text-ink">{children}</p>;
}

// ── 共通スタイル: 行内 input / number (= Phase 3.1 compactInputClass と同パターン) ──
const compactInputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink " +
  "placeholder:text-ink-3 transition-shadow focus:border-brand focus:outline-none " +
  "focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-bg-tint " +
  "disabled:text-ink-3 read-only:cursor-not-allowed read-only:bg-bg-tint read-only:text-ink-3";

export default function WorkCharacterNewPage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const router  = useRouter();
  const { showToast } = useToast();
  const { role, canEdit } = useWorkspaceRole(oaId);

  const [name, setName]                 = useState("");
  const [description, setDescription]   = useState("");
  const [iconImageUrl, setIconImageUrl] = useState("");
  const [sortOrder, setSortOrder]       = useState(0);
  const [isActive, setIsActive]         = useState(true);

  const [errors, setErrors]         = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  function clearError(key: string) {
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    const errs: Record<string, string[]> = {};
    if (!name.trim())          errs.name          = ["キャラクター名を入力してください"];
    if (!iconImageUrl.trim())  errs.icon_image_url = ["アイコン画像を設定してください"];
    if (Object.keys(errs).length) { setErrors(errs); setSubmitting(false); return; }

    try {
      await characterApi.create(getDevToken(), {
        work_id:        workId,
        name:           name.trim(),
        description:    description.trim() || null,
        icon_type:      "image",
        icon_image_url: iconImageUrl.trim(),
        sort_order:     sortOrder,
        is_active:      isActive,
      });
      showToast(`「${name.trim()}」を追加しました`, "success");
      router.push(`/oas/${oaId}/works/${workId}/characters`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "作成に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <ViewerBanner role={role} />

      {/* ── ページヘッダー ── */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            { label: "キャラクター", href: `/oas/${oaId}/works/${workId}/characters` },
            { label: "追加" },
          ]} />
          <h2 className="font-round mt-1 text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
            キャラクターを追加
          </h2>
        </div>
        <Link
          href={`/oas/${oaId}/works/${workId}/characters`}
          className={buttonClass({ variant: "ghost", size: "md" })}
        >
          ← 一覧に戻る
        </Link>
      </div>

      {/* ── フォーム本体 ── */}
      <div className="w-full max-w-[560px] rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6">
        <form onSubmit={handleSubmit}>
          <SectionHeading>基本情報</SectionHeading>

          {/* name */}
          <div className="mb-5">
            <label htmlFor="name" className="mb-1.5 block text-[13px] font-bold text-ink">
              キャラクター名<RequiredMark />
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); clearError("name"); }}
              placeholder="例: 探偵 田中"
              maxLength={50}
              autoFocus
              readOnly={!canEdit}
              aria-required="true"
              aria-invalid={errors.name ? "true" : undefined}
              aria-describedby={errors.name ? "name-error" : undefined}
              className={compactInputClass + " w-full"}
            />
            {errors.name?.map((m) => (
              <p key={m} id="name-error" role="alert" className="mt-1 text-[12px] text-danger">{m}</p>
            ))}
          </div>

          {/* description (任意) */}
          <div className="mb-5">
            <label htmlFor="description" className="mb-1.5 block text-[13px] font-bold text-ink">
              説明文<span className="ml-1 text-[11px] font-normal text-ink-3">（任意）</span>
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例: 主人公を導くナビゲーター。物語の鍵を握る。"
              maxLength={500}
              rows={3}
              readOnly={!canEdit}
              className={compactInputClass + " w-full resize-y leading-[1.7]"}
            />
            <p className="mt-1 text-[11px] text-ink-3">
              キャラクター紹介に使う任意の説明文（最大 500 文字）。
            </p>
          </div>

          {/* icon_image_url */}
          <div className="mb-5">
            <label className="mb-1.5 block text-[13px] font-bold text-ink">
              アイコン画像<RequiredMark />
            </label>
            <ImageUploadField
              value={iconImageUrl}
              onChange={(next) => { setIconImageUrl(next); clearError("icon_image_url"); }}
              readOnly={!canEdit}
              previewShape="circle"
              previewSize={88}
              previewAlt="アイコンプレビュー"
              accept={ICON_ACCEPT}
              supportedFormatsText={ICON_FORMATS_TEXT}
              emptyContent={
                <span style={{ fontSize: 28, fontWeight: 600 }}>
                  {(name.trim().charAt(0) || "?").toUpperCase()}
                </span>
              }
              showEmptyOnImageError
              urlInputCollapsibleLabel="URLを直接指定する"
              errors={{
                invalidType: "対応している画像形式は jpg / png / webp です。",
                tooLarge:    "画像サイズは5MB以内にしてください。",
                uploadFailed: "画像のアップロードに失敗しました。時間をおいて再度お試しください。",
              }}
            />
            {errors.icon_image_url?.map((m) => (
              <p key={m} id="icon-image-url-error" role="alert" className="mt-1 text-[12px] text-danger">{m}</p>
            ))}
            <p className="mt-1 text-[11px] text-ink-3">
              正方形推奨（200×200px 以上）。LINE の sender.iconUrl として使用します。
            </p>
          </div>

          <hr className="my-5 border-t border-line-2" />

          <SectionHeading>表示設定</SectionHeading>

          {/* sort_order */}
          <div className="mb-5">
            <label htmlFor="sort_order" className="mb-1.5 block text-[13px] font-bold text-ink">
              表示順
            </label>
            <input
              id="sort_order"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              min={0}
              disabled={!canEdit}
              className={compactInputClass + " w-[120px]"}
            />
          </div>

          {/* is_active */}
          <div className="mb-5">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 cursor-pointer accent-brand disabled:cursor-not-allowed"
              />
              このキャラクターを有効にする
            </label>
          </div>

          {/* form actions */}
          <div className="mt-7 flex flex-col-reverse items-stretch gap-3 border-t border-line-2 pt-5 sm:flex-row sm:items-center sm:justify-end">
            <Link
              href={`/oas/${oaId}/works/${workId}/characters`}
              className={buttonClass({ variant: "ghost", size: "md" })}
            >
              キャンセル
            </Link>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!canEdit || submitting}
              aria-busy={submitting || undefined}
            >
              {submitting && <span className="spinner" aria-hidden="true" />}
              {submitting ? "追加中..." : "キャラクターを追加"}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
