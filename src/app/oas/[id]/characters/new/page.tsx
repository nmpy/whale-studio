"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { characterApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { Breadcrumb } from "@/components/Breadcrumb";

export default function CharacterNewPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const router = useRouter();
  const { showToast } = useToast();

  const [name, setName]                 = useState("");
  const [iconImageUrl, setIconImageUrl] = useState("");
  const [sortOrder, setSortOrder]       = useState(0);
  const [isActive, setIsActive]         = useState(true);

  const [errors, setErrors]         = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  function clearError(key: string) {
    setErrors((e) => { const next = { ...e }; delete next[key]; return next; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    const clientErrors: Record<string, string[]> = {};
    if (!name.trim())         clientErrors.name          = ["キャラクター名を入力してください"];
    if (!iconImageUrl.trim()) clientErrors.icon_image_url = ["アイコン画像 URL を入力してください"];
    if (Object.keys(clientErrors).length) { setErrors(clientErrors); setSubmitting(false); return; }

    try {
      await characterApi.create(getDevToken(), {
        work_id:        oaId,
        name:           name.trim(),
        icon_type:      "image",
        icon_image_url: iconImageUrl.trim(),
        sort_order:     sortOrder,
        is_active:      isActive,
      });
      showToast(`「${name.trim()}」を追加しました`, "success");
      router.push(`/oas/${oaId}/characters`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "作成に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "OA一覧", href: "/oas" },
            { label: "キャラクター一覧", href: `/oas/${oaId}/characters` },
            { label: "新規作成" },
          ]} />
          <h2>キャラクター追加</h2>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        {/* アイコンプレビュー */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
          {iconImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={iconImageUrl} alt="プレビュー"
              style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: "2px solid #e5e5e5" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{
              width: 56, height: 56, borderRadius: "50%", background: "#e5e7eb",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, color: "#9ca3af", border: "2px solid #e5e5e5",
            }}>?</div>
          )}
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            <p style={{ fontWeight: 500 }}>アイコンプレビュー</p>
            <p style={{ fontSize: 11, marginTop: 2 }}>URL を入力するとリアルタイム更新</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="name">キャラクター名 <span style={{ color: "#ef4444" }}>*</span></label>
            <input id="name" type="text" value={name}
              onChange={(e) => { setName(e.target.value); clearError("name"); }}
              placeholder="例: 探偵 田中" maxLength={50} autoFocus />
            {errors.name?.map((m) => <p key={m} className="field-error">{m}</p>)}
          </div>

          <div className="form-group">
            <label htmlFor="icon_image_url">
              アイコン画像 URL <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input id="icon_image_url" type="url" value={iconImageUrl}
              onChange={(e) => { setIconImageUrl(e.target.value); clearError("icon_image_url"); }}
              placeholder="https://example.com/avatar.png" />
            {errors.icon_image_url?.map((m) => <p key={m} className="field-error">{m}</p>)}
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
              HTTPS URL・正方形推奨（200×200px 以上）。LINE の sender.iconUrl として使用します。
            </p>
          </div>

          <hr className="section-divider" />

          <div className="form-group">
            <label htmlFor="sort_order">表示順</label>
            <input id="sort_order" type="number" value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))} min={0} style={{ width: 120 }} />
          </div>

          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, cursor: "pointer" }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ width: "auto" }} />
              このキャラクターを有効にする
            </label>
          </div>

          <div className="form-actions">
            <Link href={`/oas/${oaId}/characters`} className="btn btn-ghost">キャンセル</Link>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting && <span className="spinner" />}
              {submitting ? "追加中..." : "キャラクターを追加"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
