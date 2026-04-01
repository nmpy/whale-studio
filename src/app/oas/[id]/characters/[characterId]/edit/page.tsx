"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { characterApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { Breadcrumb } from "@/components/Breadcrumb";

// ── 既存 FormState（変更なし） ──────────────────────────────────────────────
interface FormState {
  name:           string;
  icon_image_url: string;
  sort_order:     number;
  is_active:      boolean;
}

// ── フォームヘッダー用：大アバタープレビュー ────────────────────────────────
function FormAvatar({ name, iconImageUrl, size = 52 }: { name: string; iconImageUrl: string; size?: number }) {
  const [err, setErr] = useState(false);
  const fs = Math.round(size * 0.36);
  const hasImg = !!iconImageUrl && !err;

  // URLが変わったらエラーをリセット
  useEffect(() => { setErr(false); }, [iconImageUrl]);

  if (hasImg) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconImageUrl}
        alt={name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover",
          border: "2px solid var(--border-light)", flexShrink: 0 }}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "var(--gray-200)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: fs, color: "var(--text-muted)", fontWeight: 700,
      border: "2px solid var(--border-light)", flexShrink: 0,
    }}>
      {name ? name.charAt(0) : "?"}
    </div>
  );
}

// ── LINE プレビュー（フォームの値でリアルタイム更新） ──────────────────────
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
export default function CharacterEditPage() {
  const params  = useParams<{ id: string; characterId: string }>();
  const oaId    = params.id;
  const charId  = params.characterId;
  const router  = useRouter();
  const { showToast } = useToast();

  // ── 既存 state（変更なし） ──
  const [form, setForm]             = useState<FormState | null>(null);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [errors, setErrors]         = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  // ── 既存 初期データ取得（変更なし） ──
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

  // ── 既存 setField（変更なし） ──
  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => f ? { ...f, [key]: value } : null);
    setErrors((e) => { const next = { ...e }; delete next[key]; return next; });
  }

  // ── 既存 handleSubmit（変更なし） ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSubmitting(true);
    setErrors({});

    const clientErrors: Record<string, string[]> = {};
    if (!form.name.trim())           clientErrors.name          = ["キャラクター名を入力してください"];
    if (!form.icon_image_url.trim()) clientErrors.icon_image_url = ["アイコン画像 URL を入力してください"];
    if (Object.keys(clientErrors).length) { setErrors(clientErrors); setSubmitting(false); return; }

    try {
      await characterApi.update(getDevToken(), charId, {
        name:           form.name.trim(),
        icon_type:      "image",
        icon_text:      null,
        icon_image_url: form.icon_image_url.trim(),
        sort_order:     form.sort_order,
        is_active:      form.is_active,
      });
      showToast(`「${form.name}」を保存しました`, "success");
      router.push(`/oas/${oaId}/characters`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const breadcrumb = (
    <Breadcrumb items={[
      { label: "アカウントリスト",   href: "/oas" },
      { label: "キャラクター一覧", href: `/oas/${oaId}/characters` },
      { label: "編集" },
    ]} />
  );

  // ── ロード中スケルトン ──
  if (!form && !loadError) {
    return (
      <>
        <div className="page-header">
          <div>{breadcrumb}<h2>キャラクター編集</h2></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 14, alignItems: "start" }}>
          {/* 中央スケルトン */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border-light)", display: "flex", alignItems: "center", gap: 14 }}>
              <div className="skeleton" style={{ width: 52, height: 52, borderRadius: "50%", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: 140, height: 15, marginBottom: 8 }} />
                <div className="skeleton" style={{ width: 100, height: 11 }} />
              </div>
            </div>
            <div style={{ padding: 20 }}>
              {[1, 2].map((i) => (
                <div key={i} className="form-group">
                  <div className="skeleton" style={{ width: 100, height: 12, marginBottom: 6 }} />
                  <div className="skeleton" style={{ height: 38 }} />
                </div>
              ))}
            </div>
          </div>
          {/* 右スケルトン */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--border-light)" }}>
              <div className="skeleton" style={{ width: 80, height: 12 }} />
            </div>
            <div style={{ padding: 12 }}>
              <div className="skeleton" style={{ height: 160, borderRadius: 12 }} />
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── エラー ──
  if (loadError) {
    return (
      <>
        <div className="page-header">
          <div>{breadcrumb}<h2>キャラクター編集</h2></div>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  // ── メイン UI ──
  return (
    <>
      {/* ページヘッダー */}
      <div className="page-header">
        <div>
          {breadcrumb}
          <h2>{form!.name || "キャラクター編集"}</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            プロフィール情報を編集します
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

        {/* ── 左：編集フォーム ── */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>

          {/* カードヘッダー（プロフィールプレビュー） */}
          <div style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-light)",
            background: "var(--gray-50)",
            display: "flex", alignItems: "center", gap: 14,
          }}>
            <FormAvatar name={form!.name} iconImageUrl={form!.icon_image_url} size={52} />
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 15, fontWeight: 700,
                color: form!.name ? "var(--text-primary)" : "var(--text-muted)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {form!.name || "（名前を入力してください）"}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                {form!.icon_image_url ? "画像 URL 設定済み" : "画像 URL 未設定"}
                　·　URL変更でリアルタイム更新
              </div>
            </div>
            {!form!.is_active && (
              <span style={{
                marginLeft: "auto", flexShrink: 0,
                padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                background: "var(--gray-100)", color: "var(--text-muted)",
              }}>
                無効
              </span>
            )}
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
                value={form!.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="例: 探偵 田中"
                maxLength={50}
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
                value={form!.icon_image_url}
                onChange={(e) => setField("icon_image_url", e.target.value)}
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
                  value={form!.sort_order}
                  onChange={(e) => setField("sort_order", Number(e.target.value))}
                  min={0}
                  style={{ width: 90 }}
                />
              </div>
              <div className="form-group" style={{ display: "flex", alignItems: "flex-end", paddingBottom: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form!.is_active}
                    onChange={(e) => setField("is_active", e.target.checked)}
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
                {submitting ? "保存中..." : "変更を保存"}
              </button>
            </div>
          </form>
        </div>

        {/* ── 右：LINE プレビュー ＋ 情報サマリー ── */}
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
              <LineMsgPreview
                name={form!.name}
                iconImageUrl={form!.icon_image_url}
              />
            </div>
            <div style={{
              padding: "8px 14px",
              borderTop: "1px solid var(--border-light)",
              fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6,
            }}>
              入力内容がリアルタイムで反映されます
            </div>
          </div>

          {/* 入力内容サマリー */}
          <div className="card" style={{ padding: "14px 16px" }}>
            <p style={{
              fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12,
            }}>
              入力内容
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {[
                { label: "表示名", value: form!.name || "（未入力）" },
                { label: "画像",   value: form!.icon_image_url ? "URL 設定済み" : "（未設定）" },
                { label: "状態",   value: form!.is_active ? "✅ 有効" : "⚫ 無効" },
                { label: "表示順", value: String(form!.sort_order) },
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
