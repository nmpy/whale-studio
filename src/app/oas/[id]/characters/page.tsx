"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { characterApi, oaApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { Character } from "@/types";

function IconPreview({ character }: { character: Character }) {
  if (character.icon_type === "image" && character.icon_image_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={character.icon_image_url}
        alt={character.name}
        style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return (
    <div
      style={{
        width: 36, height: 36, borderRadius: "50%",
        background: character.icon_color ?? "#6366f1",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0,
      }}
    >
      {character.icon_text ?? character.name.charAt(0)}
    </div>
  );
}

export default function CharacterListPage() {
  const params  = useParams<{ id: string }>();
  const oaId    = params.id;
  const { showToast } = useToast();

  const [oaTitle, setOaTitle]         = useState<string>("");
  const [characters, setCharacters]   = useState<Character[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

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

  return (
    <>
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "キャラクター一覧" },
          ]} />
          <h2>キャラクター一覧</h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/oas/${oaId}/edit`} className="btn btn-ghost">設定</Link>
          <Link href={`/oas/${oaId}/characters/new`} className="btn btn-primary">+ キャラクター追加</Link>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
          <button
            onClick={load}
            style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit" }}
          >
            再読み込み
          </button>
        </div>
      )}

      {loading ? (
        // スケルトン
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                {["アイコン", "名前", "アイコン種別", "順序", "状態", ""].map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {[1,2,3].map((i) => (
                <tr key={i}>
                  <td><div className="skeleton" style={{ width: 36, height: 36, borderRadius: "50%" }} /></td>
                  {[120, 80, 40, 60, 160].map((w, j) => (
                    <td key={j}><div className="skeleton" style={{ width: w, height: 14 }} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : characters.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🎭</div>
            <p className="empty-state-title">キャラクターがまだいません</p>
            <p className="empty-state-desc">
              謎解きシナリオに登場するキャラクターを追加しましょう。
              キャラクターはメッセージ送信者として使用できます。
            </p>
            <Link href={`/oas/${oaId}/characters/new`} className="btn btn-primary" style={{ marginTop: 8 }}>
              + 最初のキャラクターを追加
            </Link>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>アイコン</th>
                  <th>名前</th>
                  <th>アイコン種別</th>
                  <th style={{ textAlign: "center" }}>順序</th>
                  <th>状態</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {characters.map((c) => (
                  <tr key={c.id}>
                    <td><IconPreview character={c} /></td>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td style={{ fontSize: 12, color: "#6b7280" }}>
                      {c.icon_type === "text"
                        ? `テキスト「${c.icon_text ?? ""}」`
                        : "画像URL"}
                    </td>
                    <td style={{ textAlign: "center", color: "#6b7280" }}>{c.sort_order}</td>
                    <td>
                      <span className={`badge ${c.is_active ? "badge-active" : "badge-paused"}`}>
                        {c.is_active ? "有効" : "無効"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link
                          href={`/oas/${oaId}/characters/${c.id}/edit`}
                          className="btn btn-ghost"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                        >
                          編集
                        </Link>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                          onClick={() => toggleActive(c)}
                        >
                          {c.is_active ? "無効化" : "有効化"}
                        </button>
                        <button
                          className="btn btn-danger"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                          onClick={() => handleDelete(c.id, c.name)}
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "10px 16px", fontSize: 12, color: "#9ca3af", borderTop: "1px solid #e5e5e5" }}>
            {characters.length} 件
          </div>
        </div>
      )}
    </>
  );
}
