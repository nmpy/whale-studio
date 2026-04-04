"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { richMenuEditorApi, oaApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import type { RichMenuWithAreas } from "@/types";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";

export default function RichMenuEditorListPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const { role, canEdit, isOwner, isAdmin } = useWorkspaceRole(oaId);
  const { showToast } = useToast();

  const [oaTitle, setOaTitle]   = useState("");
  const [menus, setMenus]       = useState<RichMenuWithAreas[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = getDevToken();
      const [oa, list] = await Promise.all([
        oaApi.get(token, oaId),
        richMenuEditorApi.list(token, oaId),
      ]);
      setOaTitle(oa.title);
      setMenus(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [oaId]);

  async function handleCreate() {
    setCreating(true);
    try {
      const token = getDevToken();
      const W = 2500, H = 843;
      const sw = Math.floor(W / 3);
      const menu = await richMenuEditorApi.create(token, {
        oa_id:         oaId,
        name:          "新しいリッチメニュー",
        chat_bar_text: "メニュー",
        size:          "compact",
        image_url:     null,
        is_active:     true,
        areas: [
          { x: 0,      y: 0, width: sw,           height: H, action_type: "message", action_label: "ボタン1", action_text: "ボタン1", sort_order: 0 },
          { x: sw,     y: 0, width: sw,           height: H, action_type: "message", action_label: "ボタン2", action_text: "ボタン2", sort_order: 1 },
          { x: sw * 2, y: 0, width: W - sw * 2,   height: H, action_type: "message", action_label: "ボタン3", action_text: "ボタン3", sort_order: 2 },
        ],
      });
      showToast("リッチメニューを作成しました", "success");
      // 編集画面に遷移
      window.location.href = `/oas/${oaId}/richmenu-editor/${menu.id}`;
    } catch (e) {
      showToast(e instanceof Error ? e.message : "作成に失敗しました", "error");
      setCreating(false);
    }
  }

  async function handleApply(menuId: string) {
    if (!confirm("このリッチメニューを LINE に適用しますか？\n現在のデフォルトメニューと置き換わります。")) return;
    setApplying(menuId);
    try {
      await richMenuEditorApi.apply(getDevToken(), menuId);
      showToast("LINE に適用しました", "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "適用に失敗しました", "error");
    } finally {
      setApplying(null);
    }
  }

  async function handleDelete(menuId: string, menuName: string) {
    if (!confirm(`「${menuName}」を削除しますか？`)) return;
    setDeleting(menuId);
    try {
      await richMenuEditorApi.delete(getDevToken(), menuId);
      showToast("削除しました", "success");
      setMenus((prev) => prev.filter((m) => m.id !== menuId));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "削除に失敗しました", "error");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <ViewerBanner role={role} />
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: oaTitle || "作品リスト", href: `/oas/${oaId}/works` },
            { label: "リッチメニューエディター" },
          ]} />
          <h2>🎨 リッチメニューエディター</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            カスタムリッチメニューを自由に作成・編集できます。
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href={`/oas/${oaId}/richmenu-sync`} className="btn btn-ghost" style={{ fontSize: 13 }}>
            📊 Sheets 同期
          </Link>
          {canEdit && (
            <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
              {creating ? <><span className="spinner" /> 作成中…</> : "+ 新規作成"}
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[...Array(2)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 100, borderRadius: 10 }} />
          ))}
        </div>
      ) : menus.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🎨</div>
          <p style={{ fontWeight: 700, fontSize: 16, color: "#374151", marginBottom: 8 }}>
            リッチメニューがありません
          </p>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
            「新規作成」からカスタムリッチメニューを作成してください。
          </p>
          {canEdit && (
            <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
              {creating ? <><span className="spinner" /> 作成中…</> : "+ 新規作成"}
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {menus.map((menu) => (
            <div key={menu.id} className="card" style={{ display: "flex", gap: 16, alignItems: "center" }}>
              {/* ミニプレビュー */}
              <MiniPreview areas={menu.areas} size={menu.size as "full" | "compact"} />

              {/* メニュー情報 */}
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>{menu.name}</span>
                  {menu.line_rich_menu_id && (
                    <span style={{
                      background: "#f0fdf4", color: "#15803d",
                      fontSize: 11, fontWeight: 600,
                      padding: "2px 8px", borderRadius: 20,
                      border: "1px solid #86efac",
                    }}>
                      ✅ LINE 適用済み
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", display: "flex", gap: 12 }}>
                  <span>バーテキスト: 「{menu.chat_bar_text}」</span>
                  <span>サイズ: {menu.size === "full" ? "フル (2500×1686)" : "コンパクト (2500×843)"}</span>
                  <span>エリア数: {menu.areas.length}</span>
                </div>
                {menu.line_rich_menu_id && (
                  <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 3, fontFamily: "monospace" }}>
                    LINE ID: {menu.line_rich_menu_id}
                  </p>
                )}
              </div>

              {/* アクション */}
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {canEdit && (
                  <Link href={`/oas/${oaId}/richmenu-editor/${menu.id}`} className="btn btn-ghost" style={{ fontSize: 13 }}>
                    ✏️ 編集
                  </Link>
                )}
                {canEdit && (
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 13 }}
                    disabled={applying === menu.id}
                    onClick={() => handleApply(menu.id)}
                  >
                    {applying === menu.id ? <><span className="spinner" /> 適用中…</> : "📲 LINE 適用"}
                  </button>
                )}
                {(isOwner || isAdmin) && (
                  <button
                    className="btn btn-danger"
                    style={{ fontSize: 13 }}
                    disabled={deleting === menu.id}
                    onClick={() => handleDelete(menu.id, menu.name)}
                  >
                    {deleting === menu.id ? <><span className="spinner" /></> : "削除"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── ミニプレビューコンポーネント ──
function MiniPreview({ areas, size }: {
  areas: RichMenuWithAreas["areas"];
  size: "full" | "compact";
}) {
  const W = 2500;
  const H = size === "full" ? 1686 : 843;
  const previewW = 140;
  const previewH = Math.round((H / W) * previewW);
  const scale = previewW / W;

  const colors = ["#6366f1","#22c55e","#f59e0b","#ef4444","#3b82f6","#ec4899"];

  return (
    <div style={{
      width: previewW, height: previewH,
      background: "#e5e7eb", borderRadius: 6,
      position: "relative", overflow: "hidden",
      flexShrink: 0, border: "1px solid #d1d5db",
    }}>
      {areas.map((area, i) => (
        <div key={area.id} style={{
          position:  "absolute",
          left:      area.x * scale,
          top:       area.y * scale,
          width:     area.width * scale,
          height:    area.height * scale,
          background: colors[i % colors.length] + "99",
          border:    "1px solid " + colors[i % colors.length],
          display:   "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
          color:    "#fff",
          fontWeight: 700,
          overflow: "hidden",
          textAlign: "center",
          padding: "0 2px",
          boxSizing: "border-box",
        }}>
          {area.action_label || "—"}
        </div>
      ))}
    </div>
  );
}
