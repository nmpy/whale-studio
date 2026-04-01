"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { oaApi, workApi, getDevToken, type OaListItem, type OaListMeta, type WorkListItem } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { RoleBadge } from "@/components/PermissionGuard";
import type { Role } from "@/lib/types/permissions";

const STATUS_LABEL: Record<string, string> = {
  draft:  "未設定",
  active: "公開中",
  paused: "停止中",
};

function formatDatetime(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${mo}/${day} ${h}:${min}`;
}

export default function OaListPage() {
  const [items, setItems]         = useState<OaListItem[]>([]);
  const [meta, setMeta]           = useState<OaListMeta | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [page, setPage]           = useState(1);
  const [worksMap, setWorksMap]   = useState<Record<string, WorkListItem[]>>({});
  const { showToast }             = useToast();

  async function load(p: number) {
    setLoading(true);
    setError(null);
    try {
      const result = await oaApi.list(getDevToken(), { page: p, limit: 20 });
      setItems(result.data);
      setMeta(result.meta);
      // 各 OA の作品一覧を並列取得（作品名・プレイヤー数用）
      const token = getDevToken();
      const pairs = await Promise.all(
        result.data.map((oa) =>
          workApi.list(token, oa.id).then((ws) => [oa.id, ws] as [string, WorkListItem[]]).catch(() => [oa.id, [] as WorkListItem[]] as [string, WorkListItem[]])
        )
      );
      const map: Record<string, WorkListItem[]> = {};
      for (const [id, ws] of pairs) map[id] = ws;
      setWorksMap(map);
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

  function WorksCell({ oaId }: { oaId: string }) {
    const ws = worksMap[oaId];
    if (!ws) return <span style={{ color: "#9ca3af", fontSize: 12 }}>—</span>;
    if (ws.length === 0) return (
      <span style={{ fontSize: 12, color: "#9ca3af" }}>作品なし</span>
    );
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {ws.map((w) => (
          <Link
            key={w.id}
            href={`/oas/${oaId}/works/${w.id}`}
            style={{ fontSize: 12, color: "#374151", lineHeight: 1.4 }}
          >
            {w.title}
          </Link>
        ))}
      </div>
    );
  }

  function totalPlayers(oaId: string): number {
    return (worksMap[oaId] ?? []).reduce((sum, w) => sum + (w._count.userProgress ?? 0), 0);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>アカウントリスト</h2>
          <p style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            1つのアカウントに複数の謎解き作品を管理できます。
          </p>
        </div>
        <Link href="/oas/new" className="btn btn-primary">+ アカウントを追加</Link>
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
                {["アカウント名", "状態", "作品", "総プレイヤー数", "作成日時", "最終更新日", ""].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((i) => (
                <tr key={i}>
                  {[200, 60, 140, 60, 100, 100, 160].map((w, j) => (
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
            <p className="empty-state-title">アカウントが未登録です</p>
            <p className="empty-state-desc">
              まずLINE公式アカウントを登録してください。<br />
              登録後、アカウントに紐づく謎解き作品を追加できます。
            </p>
            <Link href="/oas/new" className="btn btn-primary" style={{ marginTop: 8 }}>
              + 最初のアカウントを追加する
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
                  <th>作品</th>
                  <th style={{ textAlign: "center" }}>総プレイヤー数</th>
                  <th>作成日時</th>
                  <th>最終更新日</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((oa) => (
                  <tr key={oa.id}>
                    {/* アカウント名 + 権限バッジ + 説明 */}
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Link href={`/oas/${oa.id}/works`} style={{ fontWeight: 600, fontSize: 13 }}>
                          {oa.title}
                        </Link>
                        {(oa.my_role === "owner" || oa.my_role === "editor" || oa.my_role === "viewer") && (
                          <RoleBadge role={oa.my_role as Role} />
                        )}
                      </div>
                      {oa.description && (
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {oa.description}
                        </div>
                      )}
                    </td>

                    {/* 状態 */}
                    <td>
                      <span className={`badge badge-${oa.publish_status}`}>
                        {STATUS_LABEL[oa.publish_status] ?? oa.publish_status}
                      </span>
                    </td>

                    {/* 作品名 + 件数 */}
                    <td>
                      <WorksCell oaId={oa.id} />
                    </td>

                    {/* 総プレイヤー数 */}
                    <td style={{ textAlign: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>
                        {totalPlayers(oa.id).toLocaleString()}
                      </span>
                    </td>

                    {/* 作成日時 */}
                    <td style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
                      {formatDatetime(oa.created_at)}
                    </td>

                    {/* 最終更新日 */}
                    <td style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
                      {oa.updated_at ? formatDatetime(oa.updated_at) : "—"}
                    </td>

                    {/* アクション */}
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link
                          href={`/oas/${oa.id}/works`}
                          className="btn btn-primary"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                        >
                          作品管理
                        </Link>
                        <Link
                          href={`/oas/${oa.id}/settings`}
                          className="btn btn-ghost"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                        >
                          設定
                        </Link>
                        {oa.my_role === "owner" && (
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
