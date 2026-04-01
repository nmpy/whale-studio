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

// ── LINE プレビュー ─────────────────────────────────────────────────────────
function LinePreview({ character }: { character: Character | null }) {
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
        {character?.name ?? "キャラクター名"}
      </div>

      {/* メッセージ */}
      <div style={{ padding: "14px 12px" }}>
        {character ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
            <div style={{ flexShrink: 0 }}>
              <CharAvatar character={character} size={34} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>{character.name}</div>
              <div style={{
                background: "white", borderRadius: "2px 11px 11px 11px",
                padding: "10px 13px", fontSize: 12, lineHeight: 1.65,
                color: "#222", boxShadow: "0 1px 3px rgba(0,0,0,.08)",
                maxWidth: 195,
              }}>
                こんにちは！謎解きへようこそ🎉
                <br />最初のヒントをお届けします。
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: "16px 8px", textAlign: "center", fontSize: 11, color: "#888", lineHeight: 1.7 }}>
            キャラクターを選択すると<br />プレビューが表示されます
          </div>
        )}
      </div>
    </div>
  );
}

// ── キャラクターカード（左リスト用） ───────────────────────────────────────
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

// ── 選択中キャラクター詳細パネル ───────────────────────────────────────────
function CharDetailPanel({
  character,
  oaId,
  onToggle,
  onDelete,
}: {
  character: Character;
  oaId: string;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div>
      {/* プロフィールヘッダー */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "20px 20px 16px",
        borderBottom: "1px solid var(--border-light)",
      }}>
        <CharAvatar character={character} size={56} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
            {character.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
            {character.icon_type === "image" ? "画像アイコン" : "テキストアイコン"}
          </div>
          <div style={{ marginTop: 6 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "3px 9px", borderRadius: 20,
              fontSize: 11, fontWeight: 600,
              background: character.is_active ? "#dcfce7" : "var(--gray-100)",
              color:      character.is_active ? "#166534" : "var(--text-muted)",
            }}>
              {character.is_active
                ? <><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />有効</>
                : "無効"}
            </span>
          </div>
        </div>
      </div>

      {/* 詳細情報 */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-light)" }}>
        <p style={{
          fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
          textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 12,
        }}>
          詳細情報
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { label: "アイコン種別", value: character.icon_type === "image" ? "画像 URL" : "テキスト" },
            ...(character.icon_type === "image" && character.icon_image_url
              ? [{ label: "画像 URL", value: character.icon_image_url }]
              : []),
            { label: "表示順", value: String(character.sort_order) },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{
                fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
                width: 76, flexShrink: 0, paddingTop: 1,
              }}>
                {label}
              </span>
              <span style={{
                fontSize: 12, color: "var(--text-primary)",
                wordBreak: "break-all", lineHeight: 1.5,
              }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* アクションボタン */}
      <div style={{ padding: "14px 20px", display: "flex", gap: 8, alignItems: "center" }}>
        <Link
          href={`/oas/${oaId}/characters/${character.id}/edit`}
          className="btn btn-primary"
          style={{ padding: "6px 16px", fontSize: 12 }}
        >
          ✏️ 編集
        </Link>
        <button
          className="btn btn-ghost"
          style={{ padding: "6px 14px", fontSize: 12 }}
          onClick={onToggle}
        >
          {character.is_active ? "無効化" : "有効化"}
        </button>
        <div style={{ marginLeft: "auto" }}>
          <button
            style={{
              background: "none", border: "none",
              fontSize: 12, color: "var(--text-muted)",
              cursor: "pointer", padding: "6px 10px",
              borderRadius: 6,
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
            onClick={onDelete}
          >
            🗑 削除
          </button>
        </div>
      </div>
    </div>
  );
}

// ── メインページ ────────────────────────────────────────────────────────────
export default function CharacterListPage() {
  const params  = useParams<{ id: string }>();
  const oaId    = params.id;
  const { showToast } = useToast();

  const [oaTitle, setOaTitle]       = useState<string>("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        <Link href={`/oas/${oaId}/characters/new`} className="btn btn-primary">
          ＋ キャラクター追加
        </Link>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
          <button onClick={load} style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
            再読み込み
          </button>
        </div>
      )}

      {/* ── 3カラムレイアウト ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "216px 1fr 268px",
        gap: 14,
        alignItems: "start",
      }}>

        {/* ══ 左：キャラクターリスト ══ */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {/* カードヘッダー */}
          <div style={{
            padding: "11px 14px",
            borderBottom: "1px solid var(--border-light)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", letterSpacing: ".04em" }}>
              キャラクター
            </span>
            {!loading && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {characters.length} 件
              </span>
            )}
          </div>

          {/* リスト本体 */}
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
                <div style={{ fontSize: 24, marginBottom: 8 }}>🎭</div>
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

        {/* ══ 中央：詳細パネル ══ */}
        <div className="card" style={{ padding: 0, overflow: "hidden", minHeight: 300 }}>
          {loading ? (
            <div style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20,
                paddingBottom: 16, borderBottom: "1px solid var(--border-light)" }}>
                <div className="skeleton" style={{ width: 56, height: 56, borderRadius: "50%", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: 140, height: 16, marginBottom: 8 }} />
                  <div className="skeleton" style={{ width: 80, height: 12, marginBottom: 8 }} />
                  <div className="skeleton" style={{ width: 52, height: 20, borderRadius: 10 }} />
                </div>
              </div>
              {[100, 200, 60].map((w, i) => (
                <div key={i} className="skeleton" style={{ width: w, height: 13, marginBottom: 10 }} />
              ))}
            </div>
          ) : selectedChar ? (
            <CharDetailPanel
              character={selectedChar}
              oaId={oaId}
              onToggle={() => toggleActive(selectedChar)}
              onDelete={() => handleDelete(selectedChar.id, selectedChar.name)}
            />
          ) : (
            <div style={{
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              padding: "48px 24px", textAlign: "center",
            }}>
              <div style={{ fontSize: 36, marginBottom: 14 }}>🎭</div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                キャラクターを選択してください
              </p>
              <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 20 }}>
                左のリストからキャラクターをクリックすると<br />詳細が表示されます
              </p>
              <Link href={`/oas/${oaId}/characters/new`} className="btn btn-primary">
                ＋ 最初のキャラクターを追加
              </Link>
            </div>
          )}
        </div>

        {/* ══ 右：LINE プレビュー ＋ サマリー ══ */}
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
              <LinePreview character={selectedChar} />
            </div>
          </div>

          {/* キャラクター情報サマリー */}
          {selectedChar && (
            <div className="card" style={{ padding: "14px 16px" }}>
              <p style={{
                fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12,
              }}>
                キャラクター情報
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {[
                  { label: "表示名", value: selectedChar.name },
                  { label: "アイコン", value: selectedChar.icon_type === "image" ? "画像 URL" : `テキスト「${selectedChar.icon_text ?? "?"}」` },
                  { label: "状態",   value: selectedChar.is_active ? "有効" : "無効" },
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
