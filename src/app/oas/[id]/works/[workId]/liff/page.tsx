"use client";

// src/app/oas/[id]/works/[workId]/liff/page.tsx
// LIFF設定タブ — 作品配下の LIFF ページ一覧
//
// 旧 single-config 編集 UI は /oas/[id]/works/[workId]/liff/[liffPageId] に移動した。
// この画面はリスト + 新規作成のみを行う。

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";
import { liffConfigApi, workApi, getDevToken, type LiffPageSummary } from "@/lib/api-client";

const PUBLISH_LABELS: Record<string, string> = {
  draft:     "下書き",
  published: "公開中",
  archived:  "アーカイブ",
};

const PAGE_TYPE_LABELS: Record<string, string> = {
  default:   "プレイヤー向け",
  hint:      "ヒント",
  hint_site: "ヒント",
  faq:       "FAQ",
  survey:    "アンケート",
  location:  "履歴",
};

function buildPublicUrl(args: {
  workId: string; workPublicId?: string; pageId: string; pagePublicId?: string;
}): string {
  const env = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  const base = env
    ? env.replace(/\/$/, "")
    : (typeof window !== "undefined" ? window.location.origin : "");
  if (!base) return "";
  // publicId が両方揃っているときは短縮 URL、無ければ UUID 形式の旧 URL
  if (args.workPublicId && args.pagePublicId) {
    return `${base}/liff/w/${args.workPublicId}/p/${args.pagePublicId}`;
  }
  return `${base}/liff/work/${args.workId}/pages/${args.pageId}`;
}

function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "-";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

export default function LiffPagesIndex() {
  const params = useParams();
  const router = useRouter();
  const oaId = params.id as string;
  const workId = params.workId as string;
  const { showToast } = useToast();
  const { role, loading: roleLoading } = useWorkspaceRole(oaId);
  const isReadOnly = role === "viewer" || role === "tester";

  const [pages, setPages] = useState<LiffPageSummary[] | null>(null);
  const [workTitle, setWorkTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const token = getDevToken();
      const [list, work] = await Promise.all([
        liffConfigApi.listPages(token, workId),
        workApi.get(token, workId),
      ]);
      setPages(list.pages);
      setWorkTitle(work.title);
    } catch {
      showToast("LIFFページ一覧の読み込みに失敗しました", "error");
    } finally {
      setLoading(false);
    }
  }, [workId, showToast]);

  useEffect(() => { void reload(); }, [reload]);

  const handleCreate = async () => {
    if (isReadOnly || creating) return;
    setCreating(true);
    try {
      const page = await liffConfigApi.createPage(getDevToken(), workId, {});
      showToast("新しい LIFF ページを作成しました", "success");
      router.push(`/oas/${oaId}/works/${workId}/liff/${page.id}`);
    } catch {
      showToast("LIFF ページの作成に失敗しました", "error");
      setCreating(false);
    }
  };

  const handleCopyUrl = async (pageId: string) => {
    const page = pages?.find((p) => p.id === pageId);
    const url = buildPublicUrl({
      workId,
      workPublicId: page?.work_public_id,
      pageId,
      pagePublicId: page?.public_id,
    });
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(pageId);
      window.setTimeout(() => setCopied((prev) => (prev === pageId ? null : prev)), 1500);
    } catch {
      showToast("URL のコピーに失敗しました", "error");
    }
  };

  if (loading || roleLoading) {
    return (
      <div className="p-6">
        <div className="h-6 w-48 bg-gray-200 rounded-md mb-4 animate-pulse" />
        <div className="h-48 bg-gray-100 rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div className="px-6 pb-6">
      <Breadcrumb
        items={[
          { label: "作品一覧", href: `/oas/${oaId}/works` },
          { label: workTitle || "作品", href: `/oas/${oaId}/works/${workId}` },
          { label: "LIFF表示設定" },
        ]}
      />

      {isReadOnly && <ViewerBanner role={role} />}

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">LIFF ページ一覧</h1>
        {!isReadOnly && (
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 bg-violet-500 text-white rounded-lg text-sm font-semibold hover:bg-violet-600 disabled:opacity-50 transition-colors"
          >
            {creating ? "作成中..." : "＋ LIFFページを作成"}
          </button>
        )}
      </div>

      {pages && pages.length === 0 ? (
        <div className="bg-gray-50 rounded-xl p-10 text-center border-2 border-dashed border-gray-200">
          <p className="text-sm text-gray-500 mb-2">LIFF ページがまだありません</p>
          <p className="text-xs text-gray-400">「LIFFページを作成」ボタンから最初の 1 ページを作成してください</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* スマホ幅は縦並びカード、デスクトップ幅はテーブル形式 */}
          <ul className="divide-y divide-gray-100">
            {pages?.map((p) => {
              const url = buildPublicUrl({
                workId,
                workPublicId: p.work_public_id,
                pageId: p.id,
                pagePublicId: p.public_id,
              });
              return (
                <li key={p.id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[15px] font-bold text-gray-900 truncate">
                        {p.title?.trim() || "（無題）"}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-600">
                        {PAGE_TYPE_LABELS[p.page_type] ?? p.page_type}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          p.publish_status === "published"
                            ? "bg-green-50 text-green-700 border border-green-200"
                            : p.publish_status === "archived"
                              ? "bg-gray-100 text-gray-500 border border-gray-200"
                              : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}
                      >
                        {PUBLISH_LABELS[p.publish_status] ?? p.publish_status}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>作成: {formatDateTime(p.created_at)}</span>
                      <span>更新: {formatDateTime(p.updated_at)}</span>
                    </div>
                    {url && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-violet-600 underline truncate max-w-full"
                          title={url}
                        >
                          {url}
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {url && (
                      <button
                        type="button"
                        onClick={() => handleCopyUrl(p.id)}
                        className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-md text-xs hover:bg-gray-50"
                        title="URL をコピー"
                      >
                        {copied === p.id ? "コピーしました!" : "URLコピー"}
                      </button>
                    )}
                    <a
                      href={`/oas/${oaId}/works/${workId}/liff/${p.id}`}
                      className="px-3 py-1.5 bg-violet-500 text-white rounded-md text-xs font-semibold hover:bg-violet-600"
                    >
                      編集
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
