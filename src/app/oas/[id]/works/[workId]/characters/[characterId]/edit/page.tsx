"use client";

// src/app/oas/[id]/works/[workId]/characters/[characterId]/edit/page.tsx
// 作品配下キャラクター 編集フォーム。
// Phase 4.1b: UI を Phase 0 トークン + shared/Button + buttonClass に揃える。
// ImageUploadField 本体 / ViewerBanner / Breadcrumb / API / 認可ロジックは触らない。
// update payload 6 キー (name / icon_type / icon_image_url / icon_text:null / sort_order / is_active) と
// name.trim() / icon_image_url.trim() / icon_type:"image" / icon_text:null の送信構造は完全維持。
// characterApi.get / update / toast 文言 / router 遷移 / validation / submitting / canEdit ゲートも完全維持。

import { useEffect, useState } from "react";
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

interface FormState {
  name:           string;
  icon_image_url: string;
  sort_order:     number;
  is_active:      boolean;
}

export default function WorkCharacterEditPage() {
  const params      = useParams<{ id: string; workId: string; characterId: string }>();
  const oaId        = params.id;
  const workId      = params.workId;
  const charId      = params.characterId;
  const router      = useRouter();
  const { showToast } = useToast();
  const { role, canEdit } = useWorkspaceRole(oaId);

  const [form, setForm]             = useState<FormState | null>(null);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [errors, setErrors]         = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    characterApi.get(getDevToken(), charId)
      .then((c) => setForm({
        name:           c.name,
        icon_image_url: c.icon_image_url ?? "",
        sort_order:     c.sort_order,
        is_active:      c.is_active,
      }))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [charId]);

  function setField<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => f ? { ...f, [key]: val } : null);
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSubmitting(true);
    setErrors({});

    const errs: Record<string, string[]> = {};
    if (!form.name.trim())          errs.name          = ["キャラクター名を入力してください"];
    if (!form.icon_image_url.trim()) errs.icon_image_url = ["アイコン画像を設定してください"];
    if (Object.keys(errs).length) { setErrors(errs); setSubmitting(false); return; }

    try {
      await characterApi.update(getDevToken(), charId, {
        name:           form.name.trim(),
        icon_type:      "image",
        icon_image_url: form.icon_image_url.trim(),
        icon_text:      null,
        sort_order:     form.sort_order,
        is_active:      form.is_active,
      });
      showToast(`「${form.name}」を保存しました`, "success");
      router.push(`/oas/${oaId}/works/${workId}/characters`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  // ── 読み込み中: skeleton ──
  if (!form && !loadError) {
    return (
      <>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="font-round text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
            キャラクター編集
          </h2>
          <Link
            href={`/oas/${oaId}/works/${workId}/characters`}
            className={buttonClass({ variant: "ghost", size: "md" })}
          >
            ← 一覧に戻る
          </Link>
        </div>
        <div className="w-full max-w-[560px] rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="mb-5">
              <div className="skeleton" style={{ width: 100, height: 13, marginBottom: 4 }} />
              <div className="skeleton" style={{ height: 36 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  // ── 読み込みエラー ──
  if (loadError) {
    return (
      <>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="font-round text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
            キャラクター編集
          </h2>
          <Link
            href={`/oas/${oaId}/works/${workId}/characters`}
            className={buttonClass({ variant: "ghost", size: "md" })}
          >
            ← 一覧に戻る
          </Link>
        </div>
        <div
          role="alert"
          className="w-full max-w-[560px] rounded-field border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] leading-[1.6] text-danger"
        >
          {loadError}
        </div>
      </>
    );
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
            { label: "編集" },
          ]} />
          <h2 className="font-round mt-1 truncate text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
            {form!.name}
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
              value={form!.name}
              onChange={(e) => setField("name", e.target.value)}
              maxLength={50}
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

          {/* icon_image_url */}
          <div className="mb-5">
            <label className="mb-1.5 block text-[13px] font-bold text-ink">
              アイコン画像<RequiredMark />
            </label>
            <ImageUploadField
              value={form!.icon_image_url}
              onChange={(next) => setField("icon_image_url", next)}
              readOnly={!canEdit}
              previewShape="circle"
              previewSize={88}
              previewAlt="アイコンプレビュー"
              accept={ICON_ACCEPT}
              supportedFormatsText={ICON_FORMATS_TEXT}
              emptyContent={
                <span style={{ fontSize: 28, fontWeight: 600 }}>
                  {(form!.name.trim().charAt(0) || "?").toUpperCase()}
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
              value={form!.sort_order}
              onChange={(e) => setField("sort_order", Number(e.target.value))}
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
                checked={form!.is_active}
                onChange={(e) => setField("is_active", e.target.checked)}
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
              {submitting ? "保存中..." : "変更を保存"}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
