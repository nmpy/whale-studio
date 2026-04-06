"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { characterApi, oaApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { Character } from "@/types";

// ── アバター（汎用） ────────────────────────────────────────────────────────
function CharAvatar({ character, size = 38 }: { character: Character; size?: number }) {
  const fs = Math.round(size * 0.38);
  if (character.icon_type === "image" && character.icon_image_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={character.icon_image_url}
        alt={character.name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", flexShrink: 0 }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: character.icon_color ?? "#6366f1",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: fs, fontWeight: 700, color: "#fff", flexShrink: 0,
    }}>
      {character.icon_text ?? character.name.charAt(0)}
    </div>
  );
}

// ── LINE プレビュー（フォーム入力値でリアルタイム更新） ────────────────────
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
              こんにちは！謎解きへようこそ
              <br />最初のヒントをお届けします。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── キャラクターカード（リスト用） ─────────────────────────────────────────
function CharCard({
  character,
  isSelected,
  onClick,
}: {
  character: Character;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "9px 11px",
        borderRadius: 9,
        cursor: "pointer",
        border: `1px solid ${isSelected ? "rgba(6,199,85,.28)" : "transparent"}`,
        background: isSelected ? "#f0fdf4" : "transparent",
        marginBottom: 2,
        transition: "background .1s, border-color .1s",
        outline: "none",
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--gray-50)"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
    >
      <CharAvatar character={character} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: isSelected ? 700 : 600,
          color: isSelected ? "#166534" : "var(--text-primary)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {character.name}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
          {character.icon_type === "text"
            ? `テキスト「${character.icon_text ?? ""}」`
            : "画像 URL"}
        </div>
      </div>
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        padding: "2px 7px", borderRadius: 20, flexShrink: 0,
        fontSize: 10, fontWeight: 600,
        background: character.is_active ? "#dcfce7" : "var(--gray-100)",
        color:      character.is_active ? "#166534" : "var(--text-muted)",
      }}>
        {character.is_active
          ? <><span style={{ width: 4, height: 4, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />有効</>
          : "無効"}
      </span>
    </div>
  );
}

// ── フォーム state 型 ──────────────────────────────────────────────────────
interface EditFormState {
  name:           string;
  icon_image_url: string;
  sort_order:     number;
  is_active:      boolean;
}

// ══════════════════════════════════════════════════════════════════════════════
// メインページコンポーネント
// ══════════════════════════════════════════════════════════════════════════════
export default function CharacterListPage() {
  const params  = useParams<{ id: string }>();
  const oaId    = params.id;
  const { showToast } = useToast();

  // ── 既存 state（変更なし） ──
  const [oaTitle,    setOaTitle]    = useState<string>("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── 編集フォーム用 state ──
  const [editForm,    setEditForm]    = useState<EditFormState | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [formErrors,  setFormErrors]  = useState<Record<string, string>>({});

  // ── 既存 load()（変更なし） ──
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = getDevToken();
      const [oa, chars] = await Promise.all([
        oaApi.get(token, oaId),
        characterApi.list(token, oaId),
      ]);
      setOaTitle(oa.title);
      setCharacters(chars);
      setSelectedId((prev) => prev ?? (chars.length > 0 ? chars[0].id : null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [oaId]);

  // ── 選択変更時：フォームデータをフェッチ ──
  useEffect(() => {
    if (!selectedId) { setEditForm(null); return; }
    setEditLoading(true);
    setFormErrors({});
    characterApi.get(getDevToken(), selectedId)
      .then((c) => setEditForm({
        name:           c.name,
        icon_image_url: c.icon_image_url ?? "",
        sort_order:     c.sort_order,
        is_active:      c.is_active,
      }))
      .catch((e) => showToast(e instanceof Error ? e.message : "読み込みに失敗しました", "error"))
      .finally(() => setEditLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function setField<K extends keyof EditFormState>(key: K, value: EditFormState[K]) {
    setEditForm((f) => f ? { ...f, [key]: value } : null);
    setFormErrors((e) => { const next = { ...e }; delete next[key]; return next; });
  }

  // ── 既存 handleDelete()（変更なし） ──
  async function handleDelete(id: string, name: string) {
    if (!confirm(`「${name}」を削除しますか？\nこのキャラクターが紐づいたメッセージからは参照が外れます。`)) return;
    try {
      await characterApi.delete(getDevToken(), id);
      showToast(`「${name}」を削除しました`, "success");
      if (selectedId === id) setSelectedId(null);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "削除に失敗しました", "error");
    }
  }

  // ── 既存 toggleActive()（変更なし） ──
  async function toggleActive(character: Character) {
    const next = !character.is_active;
    try {
      await characterApi.update(getDevToken(), character.id, { is_active: next });
      showToast(`「${character.name}」を${next ? "有効" : "無効"}にしました`, "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "更新に失敗しました", "error");
    }
  }

  // ── インライン保存ハンドラ ──
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editForm || !selectedId) return;

    const errs: Record<string, string> = {};
    if (!editForm.name.trim())           errs.name           = "キャラクター名を入力してください";
    if (!editForm.icon_image_url.trim()) errs.icon_image_url = "アイコン画像 URL を入力してください";
    if (Object.keys(errs).length) { setFormErrors(errs); return; }

    setSaving(true);
    try {
      await characterApi.update(getDevToken(), selectedId, {
        name:           editForm.name.trim(),
        icon_type:      "image",
        icon_text:      null,
        icon_image_url: editForm.icon_image_url.trim(),
        sort_order:     editForm.sort_order,
        is_active:      editForm.is_active,
      });
      showToast(`「${editForm.name}」を保存しました`, "success");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSaving(false);
    }
  }

  const selectedChar = characters.find((c) => c.id === selectedId) ?? null;

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "キャラクター一覧" },
          ]} />
          <h2>キャラクター</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            {oaTitle ? `${oaTitle} のキャラクターを管理します` : "メッセージ送信者のキャラクターを管理します"}
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
          <button onClick={load} style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
            再読み込み
          </button>
        </div>
      )}

      {/* ── 2カラムレイアウト ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 268px",
        gap: 14,
        alignItems: "start",
      }}>

        {/* ══ 左・中央：リスト ＋ 編集フォーム ══ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* ── カードA: キャラクターリスト ── */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{
              padding: "11px 14px",
              borderBottom: "1px solid var(--border-light)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", letterSpacing: ".04em" }}>
                キャラクター
                {!loading && (
                  <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 5 }}>
                    ({characters.length})
                  </span>
                )}
              </span>
              <Link
                href={`/oas/${oaId}/characters/new`}
                className="btn btn-primary"
                style={{ padding: "5px 12px", fontSize: 11 }}
              >
                ＋ 追加
              </Link>
            </div>

            <div style={{ padding: "7px" }}>
              {loading ? (
                [1, 2, 3].map((i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px" }}>
                    <div className="skeleton" style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div className="skeleton" style={{ width: "72%", height: 12, marginBottom: 5 }} />
                      <div className="skeleton" style={{ width: "48%", height: 10 }} />
                    </div>
                  </div>
                ))
              ) : characters.length === 0 ? (
                <div style={{ padding: "24px 12px", textAlign: "center" }}>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.6 }}>
                    まだキャラクターが<br />いません
                  </p>
                  <Link
                    href={`/oas/${oaId}/characters/new`}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: 11, fontWeight: 600,
                      color: "var(--brand-dark)", textDecoration: "none",
                      padding: "5px 11px",
                      background: "var(--brand-light)",
                      border: "1px solid var(--brand-mid)",
                      borderRadius: 7,
                    }}
                  >
                    ＋ 追加する
                  </Link>
                </div>
              ) : (
                characters.map((c) => (
                  <CharCard
                    key={c.id}
                    character={c}
                    isSelected={c.id === selectedId}
                    onClick={() => setSelectedId(c.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* ── カードB: プロフィール設定（インライン編集フォーム） ── */}
          {selectedId && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{
                padding: "11px 14px",
                borderBottom: "1px solid var(--border-light)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", letterSpacing: ".04em" }}>
                  プロフィール設定
                </span>
                <button
                  style={{
                    background: "none", border: "none",
                    fontSize: 11, color: "var(--text-muted)",
                    cursor: "pointer", padding: "4px 8px",
                    borderRadius: 5,
                    transition: "color .15s, background .15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#dc2626";
                    e.currentTarget.style.background = "#fef2f2";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--text-muted)";
                    e.currentTarget.style.background = "none";
                  }}
                  onClick={() => selectedChar && handleDelete(selectedChar.id, selectedChar.name)}
                >
                  🗑 削除
                </button>
              </div>

              {editLoading ? (
                <div style={{ padding: 20 }}>
                  {[1, 2].map((i) => (
                    <div key={i} className="form-group">
                      <div className="skeleton" style={{ width: 100, height: 12, marginBottom: 6 }} />
                      <div className="skeleton" style={{ height: 38 }} />
                    </div>
                  ))}
                </div>
              ) : editForm ? (
                <form onSubmit={handleSave} style={{ padding: "16px 20px" }}>
                  {/* アバタープレビュー */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 12,
                    marginBottom: 18, paddingBottom: 14,
                    borderBottom: "1px solid var(--border-light)",
                  }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
                      overflow: "hidden",
                      border: "2px solid var(--border-light)",
                      background: "var(--gray-200)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      position: "relative",
                    }}>
                      <span style={{ fontSize: 17, color: "var(--text-muted)", fontWeight: 700, position: "absolute" }}>
                        {editForm.name ? editForm.name.charAt(0) : "?"}
                      </span>
                      {editForm.icon_image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={editForm.icon_image_url}
                          src={editForm.icon_image_url}
                          alt="プレビュー"
                          style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", top: 0, left: 0 }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      )}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 14, fontWeight: 700,
                        color: editForm.name ? "var(--text-primary)" : "var(--text-muted)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {editForm.name || "（名前を入力してください）"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {editForm.icon_image_url ? "画像 URL 設定済み" : "画像 URL 未設定"}
                        {!editForm.is_active && (
                          <span style={{
                            marginLeft: 8,
                            padding: "1px 7px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                            background: "var(--gray-100)", color: "var(--text-muted)",
                          }}>無効</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="edit-name">
                      表示名（キャラクター名）
                      <span style={{ color: "#ef4444", marginLeft: 4 }}>*</span>
                    </label>
                    <input
                      id="edit-name"
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setField("name", e.target.value)}
                      placeholder="例: 探偵 田中"
                      maxLength={50}
                    />
                    {formErrors.name && <p className="field-error">{formErrors.name}</p>}
                  </div>

                  <div className="form-group">
                    <label htmlFor="edit-icon-url">
                      アイコン画像 URL
                      <span style={{ color: "#ef4444", marginLeft: 4 }}>*</span>
                    </label>
                    <input
                      id="edit-icon-url"
                      type="url"
                      value={editForm.icon_image_url}
                      onChange={(e) => setField("icon_image_url", e.target.value)}
                      placeholder="https://example.com/avatar.png"
                    />
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                      HTTPS URL・正方形推奨（200×200px 以上）
                    </p>
                    {formErrors.icon_image_url && <p className="field-error">{formErrors.icon_image_url}</p>}
                  </div>

                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <div className="form-group" style={{ flexShrink: 0 }}>
                      <label htmlFor="edit-sort-order">表示順</label>
                      <input
                        id="edit-sort-order"
                        type="number"
                        value={editForm.sort_order}
                        onChange={(e) => setField("sort_order", Number(e.target.value))}
                        min={0}
                        style={{ width: 90 }}
                      />
                    </div>
                    <div className="form-group" style={{ display: "flex", alignItems: "flex-end", paddingBottom: 6 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={editForm.is_active}
                          onChange={(e) => setField("is_active", e.target.checked)}
                          style={{ width: "auto" }}
                        />
                        このキャラクターを有効にする
                      </label>
                    </div>
                  </div>

                  <div style={{
                    display: "flex", gap: 8, justifyContent: "flex-end",
                    paddingTop: 12, marginTop: 4,
                    borderTop: "1px solid var(--border-light)",
                  }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: "6px 14px" }}
                      onClick={() => {
                        if (selectedChar) {
                          setEditForm({
                            name:           selectedChar.name,
                            icon_image_url: selectedChar.icon_image_url ?? "",
                            sort_order:     selectedChar.sort_order,
                            is_active:      selectedChar.is_active,
                          });
                          setFormErrors({});
                        }
                      }}
                    >
                      リセット
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: "6px 14px" }}
                      onClick={() => selectedChar && toggleActive(selectedChar)}
                    >
                      {selectedChar?.is_active ? "無効化" : "有効化"}
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={saving} style={{ fontSize: 12, padding: "6px 16px" }}>
                      {saving && <span className="spinner" />}
                      {saving ? "保存中..." : "変更を保存"}
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          )}

          {/* キャラクター未選択・リストあり時 */}
          {!selectedId && !loading && characters.length > 0 && (
            <div className="card" style={{ padding: "36px 24px", textAlign: "center" }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                キャラクターを選択してください
              </p>
              <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>
                上のリストからキャラクターをクリックすると<br />プロフィールを編集できます
              </p>
            </div>
          )}
        </div>

        {/* ══ 右：LINE プレビュー ＋ キャラクター情報 ══ */}
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
              {editForm ? (
                <LineMsgPreview
                  name={editForm.name}
                  iconImageUrl={editForm.icon_image_url}
                />
              ) : (
                <div style={{
                  background: "#e8f5db", borderRadius: 12,
                  border: "1px solid #c3e6a3",
                  padding: "28px 12px", textAlign: "center",
                }}>
                  <p style={{ fontSize: 11, color: "#888", lineHeight: 1.7 }}>
                    キャラクターを選択すると<br />プレビューが表示されます
                  </p>
                </div>
              )}
            </div>
            {editForm && (
              <div style={{
                padding: "8px 14px",
                borderTop: "1px solid var(--border-light)",
                fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6,
              }}>
                入力内容がリアルタイムで反映されます
              </div>
            )}
          </div>

          {/* キャラクター情報サマリー */}
          {editForm && (
            <div className="card" style={{ padding: "14px 16px" }}>
              <p style={{
                fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12,
              }}>
                キャラクター情報
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {[
                  { label: "表示名", value: editForm.name       || "（未入力）" },
                  { label: "画像",   value: editForm.icon_image_url ? "URL 設定済み" : "（未設定）" },
                  { label: "状態",   value: editForm.is_active  ? "有効" : "無効" },
                  { label: "表示順", value: String(editForm.sort_order) },
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
          )}
        </div>
      </div>
    </>
  );
}
