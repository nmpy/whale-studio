"use client";

// src/app/oas/[id]/richmenu-editor/page.tsx
// リッチメニュー管理画面 — 一覧 + 新規作成 + LINE 適用 + 編集導線 + 削除。
//
// Phase 4.4: UI を Phase 0 トークン + shared/Button + buttonClass に揃える。
// richMenuEditorApi / oaApi / API route / Prisma / 認可ロジック / types /
// ViewerBanner / Breadcrumb / Toast / useWorkspaceRole には触らない。
// load / handleCreate / handleApply / handleDelete / 全 confirm 文言 /
// create payload (= name / chat_bar_text / size / image_url / is_active /
// areas 3 つ + W=2500/H=843/sw=Math.floor(W/3) 計算) / 成功後の
// window.location.href 遷移 / await load() / state filter / toast 文言 /
// canEdit / isOwner / isAdmin 判定 / ViewerBanner 表示は完全維持。
// MiniPreview のサイズ・色 cycling 6 色・配置計算も完全維持。

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { InlineWhaleLoader } from "@/components/ui/InlineWhaleLoader";
import { richMenuEditorApi, oaApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import type { RichMenuWithAreas } from "@/types";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";
import { Button, buttonClass } from "@/components/shared";

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

  useEffect(() => { load(); }, [oaId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!confirm(
      "このリッチメニューを LINE に適用しますか？\n\n" +
      "・このチャンネルのデフォルトメニューと置き換わります\n" +
      "・LINE公式アカウントマネージャー側で設定したメニューがある場合、そちらより優先して表示されます\n" +
      "・トーク画面に再入室したときに反映されます（最大1分程度）"
    )) return;
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
    // LINE 適用済みかどうかで結果が大きく違うので、削除前に何が起きるかを明示する。
    const applied = menus.find((m) => m.id === menuId)?.line_rich_menu_id;
    const appliedNote = applied
      ? "\n\nこのメニューは LINE に適用済みです。LINE 側のリッチメニューとデフォルト設定も削除されます。" +
        "\n削除後は、LINE公式アカウントマネージャー側で設定したメニューがあればそちらが表示され、" +
        "なければリッチメニューは表示されなくなります。"
      : "";
    if (!confirm(`「${menuName}」を削除しますか？${appliedNote}`)) return;
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

      {/* ── ヘッダー ── */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: oaTitle || "作品リスト", href: `/oas/${oaId}/works` },
            { label: "リッチメニューエディター" },
          ]} />
          <h2 className="font-round mt-1 text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
            <span aria-hidden="true">🎨 </span>リッチメニューエディター
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">
            カスタムリッチメニューを自由に作成・編集できます。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/oas/${oaId}/richmenu-sync`}
            className={buttonClass({ variant: "ghost", size: "md" })}
          >
            Sheets 同期
          </Link>
          {canEdit && (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleCreate}
              disabled={creating}
              aria-busy={creating || undefined}
            >
              {creating ? <><span className="spinner" aria-hidden="true" /> 作成中…</> : "+ 新規作成"}
            </Button>
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-field border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] leading-[1.6] text-danger"
        >
          {error}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading ? (
        <InlineWhaleLoader minHeight={220} />
      ) : menus.length === 0 ? (
        /* ── Empty state ── */
        <div className="rounded-card border-2 border-dashed border-line-2 bg-bg-tint px-6 py-12 text-center">
          <div className="mb-3 text-[40px]" aria-hidden="true">🎨</div>
          <p className="mb-2 text-[16px] font-bold text-ink">
            リッチメニューがありません
          </p>
          <p className="mb-5 text-[13px] text-ink-2">
            「新規作成」からカスタムリッチメニューを作成してください。
          </p>
          {canEdit && (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleCreate}
              disabled={creating}
              aria-busy={creating || undefined}
            >
              {creating ? <><span className="spinner" aria-hidden="true" /> 作成中…</> : "+ 新規作成"}
            </Button>
          )}
        </div>
      ) : (
        /* ── 一覧 ── */
        <div className="flex flex-col gap-3">
          {menus.map((menu) => (
            <div
              key={menu.id}
              className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-sm transition-colors hover:border-brand/30 sm:flex-row sm:items-center sm:gap-4"
            >
              {/* ミニプレビュー (= 内部は触らない) */}
              <MiniPreview areas={menu.areas} size={menu.size as "full" | "compact"} />

              {/* メニュー情報 */}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2.5">
                  <span className="text-[15px] font-bold text-ink">{menu.name}</span>
                  {menu.line_rich_menu_id ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{
                        background:   "#f0fdf4",
                        color:        "#15803d",
                        border:       "1px solid #86efac",
                      }}
                    >
                      LINE 適用済み
                    </span>
                  ) : (
                    /* 「作っただけで LINE には反映されていない」状態を明示する。
                       これが分からず「登録したのに反映されない」と誤認する事故があった。 */
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{
                        background:   "#fffbeb",
                        color:        "#b45309",
                        border:       "1px solid #fcd34d",
                      }}
                    >
                      未適用 — LINE には反映されていません
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 text-[12px] text-ink-3">
                  <span>バーテキスト: 「{menu.chat_bar_text}」</span>
                  <span>サイズ: {menu.size === "full" ? "フル (2500×1686)" : "コンパクト (2500×843)"}</span>
                  <span>エリア数: {menu.areas.length}</span>
                </div>
                {menu.line_rich_menu_id && (
                  <p className="mt-1 font-mono text-[11px] text-ink-3">
                    LINE ID: {menu.line_rich_menu_id}
                  </p>
                )}
              </div>

              {/* アクション (= SP では flex-wrap で折り返し) */}
              <div className="flex flex-shrink-0 flex-wrap gap-2">
                {canEdit && (
                  <Link
                    href={`/oas/${oaId}/richmenu-editor/${menu.id}`}
                    className={buttonClass({ variant: "ghost", size: "sm" })}
                  >
                    <span aria-hidden="true">✏️ </span>編集
                  </Link>
                )}
                {canEdit && (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={applying === menu.id}
                    aria-busy={applying === menu.id || undefined}
                    onClick={() => handleApply(menu.id)}
                  >
                    {applying === menu.id ? (
                      <><span className="spinner" aria-hidden="true" /> 適用中…</>
                    ) : (
                      <><span aria-hidden="true">📲 </span>LINE 適用</>
                    )}
                  </Button>
                )}
                {(isOwner || isAdmin) && (
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={deleting === menu.id}
                    aria-busy={deleting === menu.id || undefined}
                    onClick={() => handleDelete(menu.id, menu.name)}
                  >
                    {deleting === menu.id ? <span className="spinner" aria-hidden="true" /> : "削除"}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── ミニプレビューコンポーネント (= Phase 4.4 では中身を触らない) ──
function MiniPreview({ areas, size }: {
  areas: RichMenuWithAreas["areas"];
  size: "full" | "compact";
}) {
  const W = 2500;
  const H = size === "full" ? 1686 : 843;
  const previewW = 140;
  const previewH = Math.round((H / W) * previewW);
  const scale = previewW / W;

  return (
    <div style={{
      width: previewW, height: previewH,
      background: "#e5e7eb", borderRadius: 6,
      position: "relative", overflow: "hidden",
      flexShrink: 0, border: "1px solid #d1d5db",
    }}>
      {/* タップエリアは色分けせずニュートラル表示。識別は番号で行う。 */}
      {areas.map((area, i) => (
        <div key={area.id} style={{
          position:  "absolute",
          left:      area.x * scale,
          top:       area.y * scale,
          width:     area.width * scale,
          height:    area.height * scale,
          background: "rgba(15,23,42,0.05)",
          border:    "1px solid #cbd5e1",
          display:   "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
          color:    "#475569",
          fontWeight: 700,
          overflow: "hidden",
          textAlign: "center",
          padding: "0 2px",
          boxSizing: "border-box",
        }}>
          {i + 1}
        </div>
      ))}
    </div>
  );
}
