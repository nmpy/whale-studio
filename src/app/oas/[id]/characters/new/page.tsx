"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { characterApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { Breadcrumb } from "@/components/Breadcrumb";

// ── LINE プレビュー（入力値でリアルタイム更新） ────────────────────────────
function LineMsgPreview({ name, iconImageUrl }: { name: string; iconImageUrl: string }) {
  const [imgErr, setImgErr] = useState(false);
  const displayName = name.trim() || "キャラクター名";
  const hasImg = !!iconImageUrl && !imgErr;

  useEffect(() => { setImgErr(false); }, [iconImageUrl]);

  return (
    <div style={{ background: "#e8f5db", borderRadius: 12, overflow: "hidden", border: "1px solid #c3e6a3" }}>
      {/* ヘッダー */}
      <div style={{
        background: "rgba(0,0,0,.06)", padding: "9px 13px",
        display: "flex", alignItems: "center", gap: 8,
        fontSize: 12, color: "#3a4a3a", fontWeight: 600,
      }}>
        <div style={{
          width: 17, height: 17, borderRadius: "50%", background: "#06C755",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "white", fontSize: 7, fontWeight: 700,
        }}>L</div>
        {displayName}
      </div>

      {/* メッセージ */}
      <div style={{ padding: "14px 12px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
          {/* アバター */}
          <div style={{
            width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
            overflow: "hidden", background: "#9ca3af",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {hasImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={iconImageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setImgErr(true)} />
            ) : (
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>
                {displayName.charAt(0)}
              </span>
            )}
          </div>

          <div>
            <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>{displayName}</div>
            <div style={{
              background: "white", borderRadius: "2px 11px 11px 11px",
              padding: "10px 13px", fontSize: 12, lineHeight: 1.65,
              maxWidth: 185, color: "#222",
              boxShadow: "0 1px 3px rgba(0,0,0,.08)",
            }}>
              こんにちは！謎解きへようこそ🎉
              <br />最初のヒントをお届けします。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// メインページコンポーネント
// ══════════════════════════════════════════════════════════════════════════════
export default function CharacterNewPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const router = useRouter();
  const { showToast } = useToast();

  // ── 既存 state（変更なし） ──
  const [name, setName]                 = useState("");
  const [iconImageUrl, setIconImageUrl] = useState("");
  const [sortOrder, setSortOrder]       = useState(0);
  const [isActive, setIsActive]         = useState(true);
  const [errors, setErrors]             = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting]     = useState(false);

  // ── 既存 clearError（変更なし） ──
  function clearError(key: string) {
    setErrors((e) => { const next = { ...e }; delete next[key]; return next; });
  }

  // ── 既存 handleSubmit（変更なし） ──
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
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト",   href: "/oas" },
            { label: "キャラクター一覧", href: `/oas/${oaId}/characters` },
            { label: "新規作成" },
          ]} />
          <h2>キャラクター追加</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            新しいキャラクターを作成します
          </p>
        </div>
      </div>

      {/* ══ 2カラムレイアウト ══ */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 260px",
        gap: 14,
        alignItems: "start",
      }}>

        {/* ── 左：入力フォーム ── */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>

          {/* カードヘッダー（入力内容のリアルタイムプレビュー） */}
          <div style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-light)",
            background: "var(--gray-50)",
            display: "flex", alignItems: "center", gap: 14,
          }}>
            {/* アバタープレビュー */}
            <div style={{
              width: 52, height: 52, borderRadius: "50%", flexShrink: 0,
              overflow: "hidden",
              border: "2px solid var(--border-light)",
              background: "var(--gray-200)",
              display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative",
            }}>
              <span style={{ fontSize: 19, color: "var(--text-muted)", fontWeight: 700, position: "absolute" }}>
                {name ? name.charAt(0) : "?"}
              </span>
              {iconImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={iconImageUrl}
                  src={iconImageUrl}
                  alt="プレビュー"
                  style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", top: 0, left: 0 }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 15, fontWeight: 700,
                color: name ? "var(--text-primary)" : "var(--text-muted)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {name || "（名前を入力してください）"}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                入力内容がリアルタイムで右のプレビューに反映されます
              </div>
            </div>
          </div>

          {/* フォーム本体 */}
          <form onSubmit={handleSubmit} style={{ padding: "20px 22px" }}>

            {/* ─ セクション: プロフィール ─ */}
            <p style={{
              fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 16,
            }}>
              プロフィール
            </p>

            <div className="form-group">
              <label htmlFor="name">
                表示名（キャラクター名）
                <span style={{ color: "#ef4444", marginLeft: 4 }}>*</span>
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); clearError("name"); }}
                placeholder="例: 探偵 田中"
                maxLength={50}
                autoFocus
              />
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                LINEのトーク画面に表示される送信者名です（最大 20 文字）
              </p>
              {errors.name?.map((m) => <p key={m} className="field-error">{m}</p>)}
            </div>

            <div className="form-group">
              <label htmlFor="icon_image_url">
                アイコン画像 URL
                <span style={{ color: "#ef4444", marginLeft: 4 }}>*</span>
              </label>
              <input
                id="icon_image_url"
                type="url"
                value={iconImageUrl}
                onChange={(e) => { setIconImageUrl(e.target.value); clearError("icon_image_url"); }}
                placeholder="https://example.com/avatar.png"
              />
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                HTTPS URL・正方形推奨（200×200px 以上）。LINE の sender.iconUrl として使用します。
              </p>
              {errors.icon_image_url?.map((m) => <p key={m} className="field-error">{m}</p>)}
            </div>

            {/* ─ セクション: 設定 ─ */}
            <hr className="section-divider" />
            <p style={{
              fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 16,
            }}>
              設定
            </p>

            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div className="form-group" style={{ flexShrink: 0 }}>
                <label htmlFor="sort_order">表示順</label>
                <input
                  id="sort_order"
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value))}
                  min={0}
                  style={{ width: 90 }}
                />
              </div>
              <div className="form-group" style={{ display: "flex", alignItems: "flex-end", paddingBottom: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    style={{ width: "auto" }}
                  />
                  このキャラクターを有効にする
                </label>
              </div>
            </div>

            {/* アクション */}
            <div style={{
              display: "flex", gap: 8, justifyContent: "flex-end",
              paddingTop: 16, marginTop: 4,
              borderTop: "1px solid var(--border-light)",
            }}>
              <Link href={`/oas/${oaId}/characters`} className="btn btn-ghost">
                キャンセル
              </Link>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting && <span className="spinner" />}
                {submitting ? "追加中..." : "キャラクターを追加"}
              </button>
            </div>
          </form>
        </div>

        {/* ── 右：LINE プレビュー ＋ 入力サマリー ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* LINE プレビューカード */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{
              padding: "11px 14px",
              borderBottom: "1px solid var(--border-light)",
              fontSize: 12, fontWeight: 600, color: "var(--text-secondary)",
              display: "flex", alignItems: "center", gap: 7,
            }}>
              <span style={{ fontSize: 14 }}>📱</span>
              LINE プレビュー
            </div>
            <div style={{ padding: 12 }}>
              <LineMsgPreview name={name} iconImageUrl={iconImageUrl} />
            </div>
            <div style={{
              padding: "8px 14px",
              borderTop: "1px solid var(--border-light)",
              fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6,
            }}>
              入力内容がリアルタイムで反映されます
            </div>
          </div>

          {/* 入力サマリー */}
          <div className="card" style={{ padding: "14px 16px" }}>
            <p style={{
              fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12,
            }}>
              入力内容
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {[
                { label: "表示名", value: name       || "（未入力）" },
                { label: "画像",   value: iconImageUrl ? "URL 入力済み" : "（未入力）" },
                { label: "状態",   value: isActive   ? "✅ 有効" : "⚫ 無効" },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: "var(--text-muted)",
                    width: 44, flexShrink: 0, paddingTop: 2,
                  }}>
                    {label}
                  </span>
                  <span style={{
                    fontSize: 12, color: "var(--text-primary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
