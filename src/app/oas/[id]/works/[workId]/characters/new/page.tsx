"use client";

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

// キャラクターアイコンの対応形式 (GIF は対象外)。
const ICON_ACCEPT = "image/jpeg,image/png,image/webp";
const ICON_FORMATS_TEXT = "対応形式: JPEG / PNG / WebP (最大 5MB)";

export default function WorkCharacterNewPage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const router  = useRouter();
  const { showToast } = useToast();
  const { role, canEdit } = useWorkspaceRole(oaId);

  const [name, setName]                 = useState("");
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
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            { label: "キャラクター", href: `/oas/${oaId}/works/${workId}/characters` },
            { label: "追加" },
          ]} />
          <h2>キャラクターを追加</h2>
        </div>
        <Link href={`/oas/${oaId}/works/${workId}/characters`} className="btn btn-ghost">← 一覧に戻る</Link>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="name">キャラクター名 <span style={{ color: "#ef4444" }}>*</span></label>
            <input id="name" type="text" value={name}
              onChange={(e) => { setName(e.target.value); clearError("name"); }}
              placeholder="例: 探偵 田中" maxLength={50} autoFocus readOnly={!canEdit} />
            {errors.name?.map((m) => <p key={m} className="field-error">{m}</p>)}
          </div>

          <div className="form-group">
            <label>
              アイコン画像 <span style={{ color: "#ef4444" }}>*</span>
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
            {errors.icon_image_url?.map((m) => <p key={m} className="field-error">{m}</p>)}
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
              正方形推奨（200×200px 以上）。LINE の sender.iconUrl として使用します。
            </p>
          </div>

          <hr className="section-divider" />

          <div className="form-group">
            <label htmlFor="sort_order">表示順</label>
            <input id="sort_order" type="number" value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))} min={0} style={{ width: 120 }} disabled={!canEdit} />
          </div>

          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, cursor: "pointer" }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ width: "auto" }} disabled={!canEdit} />
              このキャラクターを有効にする
            </label>
          </div>

          <div className="form-actions">
            <Link href={`/oas/${oaId}/works/${workId}/characters`} className="btn btn-ghost">キャンセル</Link>
            <button type="submit" className="btn btn-primary" disabled={!canEdit || submitting}>
              {submitting && <span className="spinner" />}
              {submitting ? "追加中..." : "キャラクターを追加"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
