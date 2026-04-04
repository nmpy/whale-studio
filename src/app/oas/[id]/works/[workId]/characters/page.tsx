"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { TLink as Link } from "@/components/TLink";
import { workApi, characterApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { HelpAccordion } from "@/components/HelpAccordion";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { Character } from "@/types";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";

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
    <div style={{
      width: 36, height: 36, borderRadius: "50%",
      background: character.icon_color ?? "#6366f1",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0,
    }}>
      {character.icon_text ?? character.name.charAt(0)}
    </div>
  );
}

export default function WorkCharacterListPage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const { role, canEdit, isOwner, isAdmin } = useWorkspaceRole(oaId);
  const { showToast } = useToast();

  const [workTitle, setWorkTitle]           = useState("");
  const [systemCharId, setSystemCharId]     = useState<string | null>(null);
  const [savingSystemChar, setSavingSystemChar] = useState(false);
  const [characters, setCharacters]         = useState<Character[]>([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = getDevToken();
      const [work, chars] = await Promise.all([
        workApi.get(token, workId),
        characterApi.list(token, workId),
      ]);
      setWorkTitle(work.title);
      setSystemCharId(work.system_character_id ?? null);
      setCharacters(chars.sort((a, b) => a.sort_order - b.sort_order));
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [workId]);

  async function handleSaveSystemChar() {
    setSavingSystemChar(true);
    try {
      await workApi.update(getDevToken(), workId, { system_character_id: systemCharId });
      showToast("システムキャラクターを保存しました", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSavingSystemChar(false);
    }
  }

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
    try {
      await characterApi.update(getDevToken(), character.id, { is_active: !character.is_active });
      showToast(`「${character.name}」を${!character.is_active ? "有効" : "無効"}にしました`, "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "更新に失敗しました", "error");
    }
  }

  const selectedSystemChar = characters.find((c) => c.id === systemCharId) ?? null;

  return (
    <>
      <ViewerBanner role={role} />
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "作品リスト", href: `/oas/${oaId}/works` },
            ...(workTitle ? [{ label: workTitle, href: `/oas/${oaId}/works/${workId}` }] : []),
            { label: "キャラクター管理" },
          ]} />
          <h2>キャラクター管理</h2>
        </div>
        {canEdit && (
          <Link href={`/oas/${oaId}/works/${workId}/characters/new`} className="btn btn-primary">
            + キャラクターを追加
          </Link>
        )}
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
          <button onClick={load} style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit" }}>再読み込み</button>
        </div>
      )}

      {/* ── 使い方ガイド ── */}
      <HelpAccordion items={[
        { icon: "✅", title: "この画面でできること", points: [
          "LINE のメッセージ送信者として表示されるキャラクターを管理します",
          "アイコン画像と名前がトーク画面に表示されます",
        ]},
        { icon: "👆", title: "操作手順", points: [
          "「+ キャラクターを追加」でキャラクターを作成",
          "アイコン画像URL（HTTPS必須）と名前を設定します",
          "作成後、メッセージ管理でキャラクターをメッセージに紐づけます",
        ]},
        { icon: "⚠️", title: "注意点", points: [
          "アイコン画像は HTTPS の URL のみ有効（HTTP は LINE API に拒否されます）",
          "名前は最大20文字（LINE API の制限）",
          "キャラクターを削除するとメッセージの送信者が空欄になります",
        ]},
      ]} />

      {/* ══ システムキャラクター（必須） ══ */}
      <div className="card" style={{ maxWidth: 640, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <p style={{ fontWeight: 600, color: "#374151", margin: 0 }}>システムキャラクター</p>
          <span style={{
            fontSize: 11, fontWeight: 700, color: "#dc2626",
            background: "#fef2f2", padding: "1px 7px", borderRadius: 10,
            border: "1px solid #fecaca",
          }}>
            必須
          </span>
        </div>
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
          開始・エラー等のシステムメッセージに使う送信者を設定します。未設定の場合は OA デフォルト名義で送信されます。
        </p>

        {loading ? (
          <div className="skeleton" style={{ height: 38, borderRadius: 6 }} />
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <select
                value={systemCharId ?? ""}
                onChange={(e) => setSystemCharId(e.target.value || null)}
                disabled={!canEdit}
                style={{
                  flex: 1, padding: "8px 12px", border: "1px solid #d1d5db",
                  borderRadius: 6, fontSize: 14, background: "#fff",
                }}
              >
                <option value="">（OA デフォルト — 設定しない）</option>
                {characters.filter((c) => c.is_active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveSystemChar}
                disabled={!canEdit || savingSystemChar}
                style={{ flexShrink: 0 }}
              >
                {savingSystemChar && <span className="spinner" />}
                {savingSystemChar ? "保存中..." : "保存"}
              </button>
            </div>

            {selectedSystemChar && (
              <div style={{
                marginTop: 10, display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", background: "#f0fdf4", borderRadius: 6,
                border: "1px solid #bbf7d0",
              }}>
                <IconPreview character={selectedSystemChar} />
                <div style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{selectedSystemChar.name}</span>
                  {selectedSystemChar.icon_image_url
                    ? <span style={{ color: "#16a34a", marginLeft: 8, fontSize: 11 }}>アイコン画像あり</span>
                    : <span style={{ color: "#ef4444", marginLeft: 8, fontSize: 11 }}>画像URL未設定（name のみ）</span>
                  }
                </div>
              </div>
            )}

            {characters.length === 0 && (
              <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
                先にキャラクターを追加すると、ここで選択できます。
              </p>
            )}
          </>
        )}
      </div>

      {/* ══ キャラクター一覧 ══ */}
      {loading ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>{["アイコン", "名前", "種別", "順序", "状態", ""].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((i) => (
                <tr key={i}>
                  <td><div className="skeleton" style={{ width: 36, height: 36, borderRadius: "50%" }} /></td>
                  {[120, 80, 40, 60, 180].map((w, j) => (
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
            <div className="empty-state-icon">👤</div>
            <p className="empty-state-title">キャラクターがまだいません</p>
            <p className="empty-state-desc">
              謎解きに登場するキャラクターを追加しましょう。<br />
              キャラクターはメッセージの送信者として使用できます。
            </p>
            {canEdit && (
              <Link href={`/oas/${oaId}/works/${workId}/characters/new`} className="btn btn-primary" style={{ marginTop: 8 }}>
                + 最初のキャラクターを追加
              </Link>
            )}
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
                    <td style={{ fontWeight: 600 }}>
                      {c.name}
                      {c.id === systemCharId && (
                        <span style={{
                          marginLeft: 6, fontSize: 10, fontWeight: 700,
                          color: "#7c3aed", background: "#f5f3ff",
                          padding: "1px 6px", borderRadius: 8,
                          border: "1px solid #ddd6fe",
                        }}>
                          システム
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: "#6b7280" }}>
                      {c.icon_type === "text" ? `テキスト「${c.icon_text ?? ""}」` : "画像URL"}
                    </td>
                    <td style={{ textAlign: "center", color: "#6b7280" }}>{c.sort_order}</td>
                    <td>
                      <span className={`badge ${c.is_active ? "badge-active" : "badge-paused"}`}>
                        {c.is_active ? "有効" : "無効"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        {canEdit && (
                          <Link
                            href={`/oas/${oaId}/works/${workId}/characters/${c.id}/edit`}
                            className="btn btn-ghost"
                            style={{ padding: "4px 10px", fontSize: 12 }}
                          >
                            編集
                          </Link>
                        )}
                        {canEdit && (
                          <button
                            className="btn btn-ghost"
                            style={{ padding: "4px 10px", fontSize: 12 }}
                            onClick={() => toggleActive(c)}
                          >
                            {c.is_active ? "無効化" : "有効化"}
                          </button>
                        )}
                        {(isOwner || isAdmin) && c.id !== systemCharId && (
                          <button
                            className="btn btn-danger"
                            style={{ padding: "4px 10px", fontSize: 12 }}
                            onClick={() => handleDelete(c.id, c.name)}
                          >
                            削除
                          </button>
                        )}
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
