"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { oaApi, workApi, getDevToken, type WorkListItem } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";

const STATUS_LABEL: Record<string, string> = {
  draft:  "下書き",
  active: "公開中",
  paused: "停止中",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function WorkListPage() {
  const params  = useParams<{ id: string }>();
  const oaId    = params.id;
  const router  = useRouter();
  const { showToast } = useToast();
  const { role } = useWorkspaceRole(oaId);

  const [oaTitle, setOaTitle] = useState("");
  const [works, setWorks]     = useState<WorkListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = getDevToken();
      const [oa, list] = await Promise.all([
        oaApi.get(token, oaId),
        workApi.list(token, oaId),
      ]);
      setOaTitle(oa.title);
      setWorks(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [oaId]);

  async function handleDelete(id: string, title: string) {
    if (!confirm(`「${title}」を削除しますか？\nキャラクター・フェーズ・メッセージもすべて削除されます。`)) return;
    try {
      await workApi.delete(getDevToken(), id);
      showToast(`「${title}」を削除しました`, "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "削除に失敗しました", "error");
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            ...(oaTitle ? [{ label: oaTitle }] : []),
          ]} />
          <h2>作品リスト</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            謎解きシナリオ（Bot）を管理します。
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/oas/${oaId}/settings`} className="btn btn-ghost">設定</Link>
          {role !== 'viewer' && (
            <Link href={`/oas/${oaId}/works/new`} className="btn btn-primary">+ 作品を追加</Link>
          )}
        </div>
      </div>

      <ViewerBanner role={role} />

      {error && (
        <div className="alert alert-error">
          {error}
          <button onClick={load} style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
            再読み込み
          </button>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                {["作品名", "状態", "プレイヤー数", "最終更新日時", ""].map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((i) => (
                <tr key={i}>
                  {[220, 70, 80, 120, 120].map((w, j) => (
                    <td key={j}><div className="skeleton" style={{ width: w, height: 14 }} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : works.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🎭</div>
            <p className="empty-state-title">作品がまだありません</p>
            <p className="empty-state-desc">
              「作品を追加」から謎解きシナリオを作成しましょう。<br />
              1つのアカウントに複数の作品を管理できます。
            </p>
            {role !== 'viewer' && (
              <Link href={`/oas/${oaId}/works/new`} className="btn btn-primary" style={{ marginTop: 8 }}>
                + 最初の作品を追加
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
                  <th>作品名</th>
                  <th>状態</th>
                  <th style={{ textAlign: "center" }}>プレイヤー数</th>
                  <th>最終更新</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {works
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((w) => (
                  <tr
                    key={w.id}
                    onClick={() => router.push(`/oas/${oaId}/works/${w.id}`)}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    <td style={{ fontWeight: 600, color: "#1a2030", fontSize: 14 }}>
                      {w.title}
                    </td>
                    <td>
                      <span className={`badge badge-${w.publish_status}`}>
                        {STATUS_LABEL[w.publish_status] ?? w.publish_status}
                      </span>
                    </td>
                    <td style={{ textAlign: "center", fontWeight: 600, color: "#374151" }}>
                      {w._count.userProgress}
                    </td>
                    <td style={{ fontSize: 12, color: "#a0aec0", whiteSpace: "nowrap" }}>
                      {formatDateTime(w.updated_at)}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link
                          href={`/oas/${oaId}/works/${w.id}`}
                          className="btn btn-ghost"
                          style={{ padding: "5px 14px", fontSize: 12 }}
                        >
                          編集
                        </Link>
                        <Link
                          href={`/playground?work_id=${w.id}&oa_id=${oaId}`}
                          className="btn btn-ghost"
                          style={{ padding: "5px 12px", fontSize: 12 }}
                        >
                          ▶ テスト
                        </Link>
                        {role === 'owner' && (
                          <button
                            className="btn btn-danger"
                            style={{ padding: "5px 12px", fontSize: 12 }}
                            onClick={() => handleDelete(w.id, w.title)}
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
          <div style={{ padding: "10px 16px", fontSize: 12, color: "#a0aec0", borderTop: "1px solid #f0f4f8", textAlign: "right" }}>
            {works.length} 件
          </div>
        </div>
      )}
    </>
  );
}
