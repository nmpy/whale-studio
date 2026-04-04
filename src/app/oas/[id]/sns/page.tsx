"use client";

// src/app/oas/[id]/sns/page.tsx
// GET    /api/oas/:id/sns         → 一覧表示
// POST   /api/oas/:id/sns         → 追加（platform は "x" 固定）
// PATCH  /api/oas/:id/sns/:snsId  → 更新（platform は "x" 固定）
// DELETE /api/oas/:id/sns/:snsId  → 削除

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { snsApi, oaApi, trackingApi, getDevToken } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";
import { HelpAccordion } from "@/components/HelpAccordion";
import type { SnsPost } from "@/types";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";

// ── UTM 付き URL 生成 ───────────────────────────────────
// URL API を使うため既存クエリを壊さず安全にパラメータを付与する。
// 無効な URL の場合は元の文字列をそのまま返す。
function buildUtmUrl(targetUrl: string, postId: string): string {
  try {
    const url = new URL(targetUrl);
    url.searchParams.set("utm_source",   "x");
    url.searchParams.set("utm_medium",   "social");
    url.searchParams.set("utm_campaign", `sns_post_${postId}`);
    return url.toString();
  } catch {
    return targetUrl;
  }
}

// ── X 投稿インテント URL 生成 ────────────────────────────
function buildXIntentUrl(text: string, utmUrl: string): string {
  const body = utmUrl ? `${text}\n\n${utmUrl}` : text;
  return `https://x.com/intent/post?text=${encodeURIComponent(body)}`;
}

// ── X ロゴ SVG ───────────────────────────────────────────
function XLogo({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1200 1227" fill="currentColor" aria-hidden>
      <path d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284zM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854z" />
    </svg>
  );
}

// ── フォーム型（platform は除外・保存時に "x" 固定） ────
interface PostForm {
  text:       string;
  image_url:  string;
  target_url: string;
  order:      string;
}

const EMPTY_FORM: PostForm = { text: "", image_url: "", target_url: "", order: "0" };

// ── メインコンポーネント ────────────────────────────────
export default function SnsPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const { role, canEdit, isOwner, isAdmin } = useWorkspaceRole(oaId);
  const { showToast } = useToast();

  const [oaTitle, setOaTitle]       = useState("");
  const [posts, setPosts]           = useState<SnsPost[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState<string | null>(null);

  // 追加フォーム
  const [showForm, setShowForm]     = useState(false);
  const [addForm, setAddForm]       = useState<PostForm>(EMPTY_FORM);
  const [addErrors, setAddErrors]   = useState<Record<string, string>>({});
  const [adding, setAdding]         = useState(false);

  // 編集フォーム
  const [editId, setEditId]         = useState<string | null>(null);
  const [editForm, setEditForm]     = useState<PostForm>(EMPTY_FORM);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [saving, setSaving]         = useState(false);

  // URLコピー済みフィードバック
  const [copiedId, setCopiedId]     = useState<string | null>(null);

  // ── データ読み込み ──────────────────────────────────
  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const token = getDevToken();
      const [oa, list] = await Promise.all([
        oaApi.get(token, oaId),
        snsApi.list(token, oaId),
      ]);
      setOaTitle(oa.title);
      setPosts(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [oaId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── バリデーション ────────────────────────────────
  function validateForm(f: PostForm): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!f.text.trim())    errs.text = "テキストは必須です";
    if (f.image_url.trim()  && !/^https?:\/\//.test(f.image_url.trim()))  errs.image_url  = "有効な URL を入力してください";
    if (f.target_url.trim() && !/^https?:\/\//.test(f.target_url.trim())) errs.target_url = "有効な URL を入力してください";
    if (isNaN(Number(f.order)) || Number(f.order) < 0) errs.order = "0 以上の整数を入力してください";
    return errs;
  }

  // ── 追加 ────────────────────────────────────────
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateForm(addForm);
    if (Object.keys(errs).length) { setAddErrors(errs); return; }

    setAdding(true);
    try {
      const newPost = await snsApi.create(getDevToken(), oaId, {
        platform:   "x",
        text:       addForm.text.trim(),
        image_url:  addForm.image_url.trim()  || null,
        target_url: addForm.target_url.trim() || null,
        order:      Number(addForm.order),
      });

      // target_url があればトラッキングを自動作成
      if (addForm.target_url.trim()) {
        try {
          await trackingApi.create(getDevToken(), {
            oa_id:       oaId,
            name:        `X投稿: ${addForm.text.trim().slice(0, 30)}${addForm.text.trim().length > 30 ? "…" : ""}`,
            tracking_id: `x_${newPost.id.slice(0, 8)}`,
            target_url:  addForm.target_url.trim(),
            utm_enabled: true,
          });
          showToast("X 投稿を追加し、トラッキングを自動作成しました", "success");
        } catch {
          showToast("X 投稿を追加しました（トラッキング作成に失敗）", "success");
        }
      } else {
        showToast("X 投稿を追加しました", "success");
      }

      setAddForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "追加に失敗しました", "error");
    } finally {
      setAdding(false);
    }
  }

  // ── 編集開始 ──────────────────────────────────
  function startEdit(post: SnsPost) {
    setEditId(post.id);
    setEditForm({
      text:       post.text,
      image_url:  post.image_url  ?? "",
      target_url: post.target_url ?? "",
      order:      String(post.order),
    });
    setEditErrors({});
  }

  // ── 更新 ──────────────────────────────────────
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    const errs = validateForm(editForm);
    if (Object.keys(errs).length) { setEditErrors(errs); return; }

    setSaving(true);
    try {
      await snsApi.update(getDevToken(), oaId, editId, {
        platform:   "x",                              // X 固定
        text:       editForm.text.trim(),
        image_url:  editForm.image_url.trim()  || null,
        target_url: editForm.target_url.trim() || null,
        order:      Number(editForm.order),
      });
      showToast("X 投稿を更新しました", "success");
      setEditId(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "更新に失敗しました", "error");
    } finally {
      setSaving(false);
    }
  }

  // ── 削除 ──────────────────────────────────────
  async function handleDelete(post: SnsPost) {
    if (!confirm(`この投稿を削除しますか？\n「${post.text.slice(0, 30)}${post.text.length > 30 ? "…" : ""}」`)) return;
    try {
      await snsApi.delete(getDevToken(), oaId, post.id);
      showToast("X 投稿を削除しました", "success");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "削除に失敗しました", "error");
    }
  }

  // ── URL コピー ────────────────────────────────
  async function handleCopy(post: SnsPost) {
    const url = post.target_url ? buildUtmUrl(post.target_url, post.id) : "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(post.id);
      setTimeout(() => setCopiedId((id) => id === post.id ? null : id), 2000);
    } catch {
      showToast("コピーできませんでした", "error");
    }
  }

  // ── ローディング ──────────────────────────────
  if (loading) {
    return (
      <>
        <div className="page-header">
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "設定", href: `/oas/${oaId}/settings` },
            { label: "SNS連携" },
          ]} />
          <h2>X 投稿管理</h2>
        </div>
        <div className="card" style={{ padding: 0 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ padding: "16px 20px", borderBottom: "1px solid #e5e5e5" }}>
              <div className="skeleton" style={{ width: 60, height: 20, marginBottom: 8, borderRadius: 4 }} />
              <div className="skeleton" style={{ height: 14, marginBottom: 4 }} />
              <div className="skeleton" style={{ width: "60%", height: 14 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="page-header">
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "設定", href: `/oas/${oaId}/settings` },
            { label: "SNS連携" },
          ]} />
          <h2>X 投稿管理</h2>
        </div>
        <div className="alert alert-error">
          {loadError}
          <button
            onClick={load}
            style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit" }}
          >
            再読み込み
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <ViewerBanner role={role} />
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "設定", href: `/oas/${oaId}/settings` },
            { label: "SNS連携" },
          ]} />
          <h2>X 投稿管理</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            X（旧 Twitter）への告知投稿を管理します。UTM 付き URL を自動生成します。
          </p>
        </div>
        {canEdit && (
          <button
            className="btn btn-primary"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            onClick={() => { setShowForm(true); setAddErrors({}); setAddForm(EMPTY_FORM); }}
          >
            <XLogo size={12} /> 投稿を追加
          </button>
        )}
      </div>

      <HelpAccordion items={[
        { icon: "✅", title: "この画面でできること", points: [
          "X（旧 Twitter）への告知投稿文とリンクを管理します",
          "UTM パラメータ付き URL を自動生成して流入を計測できます",
        ]},
        { icon: "👆", title: "操作手順", points: [
          "「投稿を追加」で投稿テキスト・画像・リンク先 URL を設定します",
          "「X で投稿」ボタンでそのまま X の投稿画面が開きます",
          "トラッキングリンクを設定すると友達追加ユーザーの計測も可能です",
        ]},
        { icon: "⚠️", title: "注意点", points: [
          "投稿テキストは X の文字数制限（280 文字）に注意してください",
          "画像 URL は公開アクセス可能な HTTPS URL のみ有効です",
        ]},
      ]} />

      {/* ── 追加フォーム ── */}
      {showForm && (
        <div className="card" style={{ marginBottom: 24, border: "2px solid #000" }}>
          <p style={{ fontWeight: 600, marginBottom: 16, color: "#374151", display: "flex", alignItems: "center", gap: 6 }}>
            <XLogo size={13} /> 新しい投稿
          </p>
          <form onSubmit={handleAdd}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(0, 340px)", gap: 24, alignItems: "start" }}>
              <div>
                <PostFormFields
                  form={addForm}
                  errors={addErrors}
                  onChange={(key, val) => {
                    setAddForm((f) => ({ ...f, [key]: val }));
                    setAddErrors((e) => { const n = { ...e }; delete n[key]; return n; });
                  }}
                />
                <div className="form-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                    キャンセル
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={!canEdit || adding}>
                    {adding && <span className="spinner" />}
                    {adding ? "追加中..." : "追加"}
                  </button>
                </div>
              </div>
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  プレビュー
                </p>
                <XPostPreview
                  text={addForm.text}
                  imageUrl={addForm.image_url}
                  targetUrl={addForm.target_url}
                  utmUrl={addForm.target_url.trim() ? buildUtmUrl(addForm.target_url.trim(), "preview") : ""}
                />
                {addForm.target_url.trim() && (
                  <p style={{ fontSize: 11, color: "#06C755", marginTop: 6 }}>✓ 保存時にトラッキングが自動作成されます</p>
                )}
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ── 一覧 ── */}
      {posts.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <XLogo size={32} />
            </div>
            <p className="empty-state-title">X 投稿がまだありません</p>
            <p className="empty-state-desc">
              X へのイベント告知投稿をここで管理・共有できます。
            </p>
            {canEdit && (
              <button
                className="btn btn-primary"
                style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6 }}
                onClick={() => { setShowForm(true); setAddErrors({}); setAddForm(EMPTY_FORM); }}
              >
                <XLogo size={12} /> 最初の投稿を追加
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {posts.map((post) => {
            const utmUrl    = post.target_url ? buildUtmUrl(post.target_url, post.id) : "";
            const xPostUrl  = buildXIntentUrl(post.text, utmUrl);
            const isCopied  = copiedId === post.id;
            const isEditing = editId   === post.id;

            return (
              <div key={post.id} className="card" style={{ padding: 0 }}>
                {isEditing ? (
                  /* ── 編集フォーム ── */
                  <div style={{ padding: "20px 24px" }}>
                    <p style={{ fontWeight: 600, marginBottom: 16, color: "#374151", display: "flex", alignItems: "center", gap: 6 }}>
                      <XLogo size={13} /> 投稿を編集
                    </p>
                    <form onSubmit={handleSave}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(0, 340px)", gap: 24, alignItems: "start" }}>
                        <div>
                          <PostFormFields
                            form={editForm}
                            errors={editErrors}
                            onChange={(key, val) => {
                              setEditForm((f) => ({ ...f, [key]: val }));
                              setEditErrors((e) => { const n = { ...e }; delete n[key]; return n; });
                            }}
                          />
                          <div className="form-actions">
                            <button type="button" className="btn btn-ghost" onClick={() => setEditId(null)}>
                              キャンセル
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={!canEdit || saving}>
                              {saving && <span className="spinner" />}
                              {saving ? "保存中..." : "保存"}
                            </button>
                          </div>
                        </div>
                        <div>
                          <p style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                            プレビュー
                          </p>
                          <XPostPreview
                            text={editForm.text}
                            imageUrl={editForm.image_url}
                            targetUrl={editForm.target_url}
                            utmUrl={editForm.target_url.trim() ? buildUtmUrl(editForm.target_url.trim(), "preview") : ""}
                          />
                        </div>
                      </div>
                    </form>
                  </div>
                ) : (
                  /* ── 表示モード ── */
                  <div style={{ padding: "16px 20px" }}>

                    {/* ヘッダー行: X バッジ + 順序 + 編集/削除 */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "2px 10px", borderRadius: 12,
                        fontSize: 11, fontWeight: 600, color: "#fff", background: "#000",
                      }}>
                        <XLogo size={9} />
                      </span>
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>
                        順序: {post.order}
                      </span>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexShrink: 0 }}>
                        {canEdit && (
                          <button
                            className="btn btn-ghost"
                            style={{ padding: "4px 10px", fontSize: 12 }}
                            onClick={() => startEdit(post)}
                          >
                            編集
                          </button>
                        )}
                        {(isOwner || isAdmin) && (
                          <button
                            className="btn btn-danger"
                            style={{ padding: "4px 10px", fontSize: 12 }}
                            onClick={() => handleDelete(post)}
                          >
                            削除
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 本文 */}
                    <p style={{
                      fontSize: 14, color: "#111827",
                      marginBottom: utmUrl ? 2 : (post.image_url ? 10 : 0),
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>
                      {post.text}
                    </p>

                    {/* UTM 付き URL（本文直下・X と同じ見え方） */}
                    {utmUrl && (
                      <p style={{ marginBottom: post.image_url ? 10 : 12 }}>
                        <a
                          href={utmUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 14, color: "#06C755", textDecoration: "none", wordBreak: "break-all" }}
                        >
                          {utmUrl}
                        </a>
                      </p>
                    )}

                    {/* 画像サムネイル */}
                    {post.image_url && (
                      <a href={post.image_url} target="_blank" rel="noopener noreferrer" style={{ display: "block", marginBottom: 12 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={post.image_url}
                          alt="投稿画像"
                          style={{
                            width: "100%", maxWidth: 400, borderRadius: 8,
                            border: "1px solid #e5e5e5", display: "block",
                          }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      </a>
                    )}

                    {/* アクションボタン行 */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {/* URLをコピー */}
                      {utmUrl && (
                        <button
                          className="btn btn-ghost"
                          style={{
                            fontSize: 12, padding: "5px 12px",
                            display: "inline-flex", alignItems: "center", gap: 5,
                            color: isCopied ? "#059669" : undefined,
                            borderColor: isCopied ? "#6ee7b7" : undefined,
                          }}
                          onClick={() => handleCopy(post)}
                        >
                          {isCopied ? (
                            <>✓ コピー済み</>
                          ) : (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                              URL をコピー
                            </>
                          )}
                        </button>
                      )}

                      {/* X に投稿する */}
                      <a
                        href={xPostUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost"
                        style={{
                          fontSize: 12, padding: "5px 12px",
                          display: "inline-flex", alignItems: "center", gap: 5,
                          textDecoration: "none",
                          color: "#111827",
                          background: "#fff",
                          border: "1px solid #e5e5e5",
                          borderRadius: 6,
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLAnchorElement).style.background = "#f9fafb";
                          (e.currentTarget as HTMLAnchorElement).style.borderColor = "#111827";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLAnchorElement).style.background = "#fff";
                          (e.currentTarget as HTMLAnchorElement).style.borderColor = "#e5e5e5";
                        }}
                      >
                        <XLogo size={11} /> に投稿する
                      </a>
                    </div>

                  </div>
                )}
              </div>
            );
          })}
          <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "right" }}>
            {posts.length} 件
          </div>
        </div>
      )}
    </>
  );
}

// ── X 投稿プレビュー ────────────────────────────────────
function XPostPreview({ text, imageUrl, targetUrl, utmUrl }: {
  text:      string;
  imageUrl:  string;
  targetUrl: string;
  utmUrl:    string;
}) {
  const hasText  = !!text.trim();
  const hasImage = !!imageUrl.trim();
  const hasUrl   = !!utmUrl || !!targetUrl.trim();
  const displayUrl = utmUrl || targetUrl.trim();

  return (
    <div style={{
      border: "1px solid #e5e7eb", borderRadius: 14,
      overflow: "hidden", background: "#fff",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{ padding: "14px 14px 0", display: "flex", gap: 10 }}>
        {/* アバター */}
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          background: "#1a1a1a", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff",
        }}>
          <XLogo size={16} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 名前・ハンドル */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#0f1419" }}>アカウント名</span>
            <span style={{ fontSize: 13, color: "#536471" }}>@account</span>
          </div>

          {/* 投稿テキスト */}
          {hasText ? (
            <p style={{
              fontSize: 15, color: "#0f1419", whiteSpace: "pre-wrap",
              wordBreak: "break-word", lineHeight: 1.55, margin: "0 0 10px",
            }}>
              {text}
              {hasUrl && (
                <span style={{ color: "#1d9bf0" }}>
                  {"\n\n"}
                  {displayUrl.length > 40 ? displayUrl.slice(0, 40) + "…" : displayUrl}
                </span>
              )}
            </p>
          ) : (
            <p style={{ fontSize: 13, color: "#9ca3af", fontStyle: "italic", margin: "0 0 10px" }}>
              テキストを入力するとプレビューが表示されます
            </p>
          )}

          {/* 画像 */}
          {hasImage && (
            <div style={{ marginBottom: 10, borderRadius: 12, overflow: "hidden", border: "1px solid #e5e7eb" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="投稿画像"
                style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}

          {/* URLカード（画像がないとき） */}
          {hasUrl && !hasImage && (
            <div style={{
              border: "1px solid #e5e7eb", borderRadius: 12,
              overflow: "hidden", marginBottom: 10,
            }}>
              <div style={{
                height: 56, background: "#f7f9f9",
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8,
              }}>
                <span style={{ fontSize: 18 }}>🔗</span>
                <span style={{ fontSize: 11, color: "#536471" }}>リンクカード</span>
              </div>
              <div style={{ padding: "7px 12px", borderTop: "1px solid #e5e7eb", background: "#fff" }}>
                <p style={{
                  fontSize: 12, color: "#536471", margin: 0,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {targetUrl || displayUrl}
                </p>
              </div>
            </div>
          )}

          {/* エンゲージメント行（装飾のみ） */}
          <div style={{
            display: "flex", gap: 20, padding: "8px 0 12px",
            borderTop: "1px solid #e5e7eb",
            color: "#536471", fontSize: 12,
          }}>
            {[{ icon: "💬", n: 0 }, { icon: "🔁", n: 0 }, { icon: "❤️", n: 0 }].map(({ icon, n }) => (
              <span key={icon} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {icon} {n}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 共通フォームフィールド（追加 / 編集で共用） ────────
interface PostFormFieldsProps {
  form:     PostForm;
  errors:   Record<string, string>;
  onChange: (key: keyof PostForm, value: string) => void;
}

function PostFormFields({ form, errors, onChange }: PostFormFieldsProps) {
  return (
    <>
      <div className="form-group">
        <label htmlFor="text">
          投稿テキスト <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <textarea
          id="text"
          value={form.text}
          onChange={(e) => onChange("text", e.target.value)}
          placeholder="X に投稿するテキストを入力してください"
          rows={4}
          maxLength={280}
        />
        <span style={{
          fontSize: 11,
          color: form.text.length > 250 ? "#ef4444" : "#9ca3af",
          display: "block", marginTop: 2,
        }}>
          {form.text.length} / 280
        </span>
        {errors.text && <p className="field-error">{errors.text}</p>}
      </div>

      <div className="form-group">
        <label htmlFor="target_url">リンク URL（任意）</label>
        <input
          id="target_url"
          type="url"
          value={form.target_url}
          onChange={(e) => onChange("target_url", e.target.value)}
          placeholder="https://example.com/"
          style={{ fontFamily: "monospace", fontSize: 13 }}
        />
        <span style={{ fontSize: 11, color: "#9ca3af", display: "block", marginTop: 4 }}>
          保存後に utm_source=x&utm_medium=social&utm_campaign=sns_post_… が自動付与されます
        </span>
        {errors.target_url && <p className="field-error">{errors.target_url}</p>}
      </div>

      <div className="form-group">
        <label htmlFor="image_url">画像 URL（任意）</label>
        <input
          id="image_url"
          type="url"
          value={form.image_url}
          onChange={(e) => onChange("image_url", e.target.value)}
          placeholder="https://example.com/image.png"
          style={{ fontFamily: "monospace", fontSize: 13 }}
        />
        {errors.image_url && <p className="field-error">{errors.image_url}</p>}
      </div>

      <div className="form-group" style={{ maxWidth: 120 }}>
        <label htmlFor="order">表示順序</label>
        <input
          id="order"
          type="number"
          value={form.order}
          onChange={(e) => onChange("order", e.target.value)}
          min={0}
        />
        {errors.order && <p className="field-error">{errors.order}</p>}
      </div>
    </>
  );
}
