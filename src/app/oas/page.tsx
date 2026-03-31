"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { oaApi, getDevToken, type OaListItem, type OaListMeta } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { RoleBadge } from "@/components/PermissionGuard";
import type { Role } from "@/lib/types/permissions";

const STATUS_LABEL: Record<string, string> = {
  draft:  "未設定",
  active: "稼働中",
  paused: "停止中",
};

export default function OaListPage() {
  const [items, setItems]     = useState<OaListItem[]>([]);
  const [meta, setMeta]       = useState<OaListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [page, setPage]       = useState(1);
  const { showToast }         = useToast();

  async function load(p: number) {
    setLoading(true);
    setError(null);
    try {
      const result = await oaApi.list(getDevToken(), { page: p, limit: 20 });
      setItems(result.data);
      setMeta(result.meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(page); }, [page]);

  async function handleDelete(id: string, title: string) {
    if (!confirm(`「${title}」を削除しますか？\n紐づくすべての作品・キャラクター・フェーズ・メッセージも削除されます。この操作は取り消せません。`)) return;
    try {
      await oaApi.delete(getDevToken(), id);
      showToast(`「${title}」を削除しました`, "success");
      await load(page);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "削除に失敗しました", "error");
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>LINE 公式アカウント一覧</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            1つのアカウントに複数の謎解き作品を管理できます
          </p>
        </div>
        <Link href="/oas/new" className="btn btn-primary">+ OA を追加</Link>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
          <button
            onClick={() => load(page)}
            style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit" }}
          >
            再読み込み
          </button>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                {["アカウント名", "状態", "Channel ID", "作品数", "作成日", ""].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((i) => (
                <tr key={i}>
                  {[200, 60, 120, 40, 80, 160].map((w, j) => (
                    <td key={j}><div className="skeleton" style={{ width: w, height: 14 }} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📡</div>
            <p className="empty-state-title">LINE 公式アカウントが未登録です</p>
            <p className="empty-state-desc">
              まず LINE 公式アカウントを登録してください。<br />
              登録後、アカウントに紐づく謎解き作品を追加できます。
            </p>
            <Link href="/oas/new" className="btn btn-primary" style={{ marginTop: 8 }}>
              + 最初の OA を追加する
            </Link>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>アカウント名</th>
                  <th>状態</th>
                  <th>Channel ID</th>
                  <th style={{ textAlign: "center" }}>作品数</th>
                  <th>作成日</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((oa) => (
                  <tr key={oa.id}>
                    <td>
                      {/* OA 名クリック → 作品一覧へ */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Link href={`/oas/${oa.id}/works`} style={{ fontWeight: 600 }}>
                          {oa.title}
                        </Link>
                        {(oa.my_role === 'owner' || oa.my_role === 'editor' || oa.my_role === 'viewer') && (
                          <RoleBadge role={oa.my_role as Role} />
                        )}
                      </div>
                      {oa.description && (
                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {oa.description}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge badge-${oa.publish_status}`}>
                        {STATUS_LABEL[oa.publish_status] ?? oa.publish_status}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: "#6b7280", fontFamily: "monospace" }}>
                      {oa.channel_id}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <Link href={`/oas/${oa.id}/works`} style={{ fontWeight: 600, color: oa._count.works === 0 ? "#9ca3af" : undefined }}>
                        {oa._count.works}
                      </Link>
                    </td>
                    <td style={{ fontSize: 12, color: "#6b7280" }}>
                      {new Date(oa.created_at).toLocaleDateString("ja-JP")}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        {/* 作品管理 → /works */}
                        <Link
                          href={`/oas/${oa.id}/works`}
                          className="btn btn-primary"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                        >
                          作品管理
                        </Link>
                        {/* OA設定（LINE 接続情報）→ /settings */}
                        <Link
                          href={`/oas/${oa.id}/settings`}
                          className="btn btn-ghost"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                        >
                          OA 設定
                        </Link>
                        {oa.my_role === 'owner' && (
                          <button
                            className="btn btn-danger"
                            style={{ padding: "4px 10px", fontSize: 12 }}
                            onClick={() => handleDelete(oa.id, oa.title)}
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

          {meta && meta.pages > 1 && (
            <div style={{ display: "flex", gap: 8, padding: "12px 16px", justifyContent: "flex-end", borderTop: "1px solid #e5e5e5" }}>
              <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>前へ</button>
              <span style={{ lineHeight: "36px", fontSize: 13, color: "#6b7280" }}>
                {page} / {meta.pages} ページ（計 {meta.total} 件）
              </span>
              <button className="btn btn-ghost" disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)}>次へ</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
