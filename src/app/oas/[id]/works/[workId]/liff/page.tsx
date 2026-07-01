"use client";

// src/app/oas/[id]/works/[workId]/liff/page.tsx
// LIFF設定 — 作品配下の LIFF 管理画面（4 タブ構成）。
//
// タブ: ホーム / 詳細ページ / 独立ページ / 計測 （?tab=home|detail|standalone|analytics で保持）
//   - ホーム      : 作品メニューホームの並び順・表示形式編集 + プレビュー
//   - 詳細ページ  : show_in_menu=true（ホームに並ぶ）ページの一覧
//   - 独立ページ  : show_in_menu=false（URL/QR から直接開く）ページの一覧
//   - 計測        : 既存 analytics サマリの表 / 未取得時は準備中の空状態
//
// 旧 single-config 編集 UI は /oas/[id]/works/[workId]/liff/[liffPageId] に移動済み。

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { InlineWhaleLoader } from "@/components/ui/InlineWhaleLoader";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useAccessPreview } from "@/hooks/useAccessPreview";
import { ViewerBanner } from "@/components/PermissionGuard";
import { PlanRequiredCard } from "@/components/PlanRequiredCard";
import { FEATURE, getPlanAccessState } from "@/lib/constants/plans";
import {
  liffConfigApi,
  workApi,
  getDevToken,
  type LiffPageSummary,
  type LiffAnalyticsSummary,
  type LiffPageAnalyticsSummaryRow,
} from "@/lib/api-client";
import { buildPublicUrl } from "./_shared";
import {
  LIFF_ADMIN_TABS,
  resolveLiffAdminTab,
  type LiffAdminTab,
} from "./_tabs-config";
import { HomeTab } from "./_HomeTab";
import { PageListTab } from "./_PageListTab";
import { AnalyticsTab } from "./_AnalyticsTab";
import { SurveyFaqTab } from "./_SurveyFaqTab";

// useSearchParams() を使うため Suspense 境界でラップする（next build の prerender 要件）。
export default function LiffPagesIndexPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <InlineWhaleLoader minHeight={200} />
        </div>
      }
    >
      <LiffPagesIndex />
    </Suspense>
  );
}

function LiffPagesIndex() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const oaId = params.id as string;
  const workId = params.workId as string;
  const { showToast } = useToast();
  const { role, loading: roleLoading } = useWorkspaceRole(oaId);
  const isReadOnly = role === "viewer" || role === "tester";

  const activeTab = resolveLiffAdminTab(searchParams.get("tab"));

  // プラン制限: LIFF設定は Plus 以上が必要。
  // owner の「表示確認モード」を反映するため effectivePlan を使う。
  const { effectivePlan: planTier, loading: planLoading } = useAccessPreview(oaId);
  const planAccess = getPlanAccessState({ plan: planTier, featureKey: FEATURE.liffDisplay });

  const [pages, setPages] = useState<LiffPageSummary[] | null>(null);
  const [workTitle, setWorkTitle] = useState("");
  /** 公開 LIFF URL 生成用の work publicId（未取得時は空）。 */
  const [workPublicId, setWorkPublicId] = useState<string | undefined>(undefined);
  /** 作品メニューホームの任意設定（title/description/image_url）。未設定は null。 */
  const [homeSettings, setHomeSettings] = useState<{
    title: string | null; description: string | null; image_url: string | null; header_title: string | null;
    font_family: import("@/types").LiffHomeFontFamily | null;
    home_menu_layout: "card" | "list";
  }>({ title: null, description: null, image_url: null, header_title: null, font_family: null, home_menu_layout: "card" });
  const [liffEnabled, setLiffEnabled] = useState(true);
  const [savingLiffEnabled, setSavingLiffEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** page_id -> 集計値。計測 API 失敗時は {} （UI 上は "-" / 空状態） */
  const [analytics, setAnalytics] = useState<Record<string, LiffPageAnalyticsSummaryRow> | null>(null);

  const reload = useCallback(async () => {
    try {
      const token = getDevToken();
      const [list, work] = await Promise.all([
        liffConfigApi.listPages(token, workId),
        workApi.get(token, workId),
      ]);
      setPages(list.pages);
      setWorkTitle(work.title);
      setWorkPublicId(work.public_id);
      setHomeSettings(work.liff_home_settings ?? { title: null, description: null, image_url: null, header_title: null, font_family: null, home_menu_layout: "card" });
      setLiffEnabled(work.liff_enabled !== false);
      // 計測サマリは並行取得し、失敗してもページ一覧自体は表示する
      liffConfigApi
        .getAnalyticsSummary(token, workId)
        .then((s: LiffAnalyticsSummary) => {
          const map: Record<string, LiffPageAnalyticsSummaryRow> = {};
          for (const row of s.pages) map[row.page_id] = row;
          setAnalytics(map);
        })
        .catch(() => {
          // 計測の取得失敗は致命的ではない。指標列は "-" / 空状態にする。
          setAnalytics({});
        });
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

  const handleToggleLiffEnabled = async (next: boolean) => {
    if (isReadOnly || savingLiffEnabled || next === liffEnabled) return;
    const prev = liffEnabled;
    setLiffEnabled(next); // optimistic
    setSavingLiffEnabled(true);
    try {
      await workApi.update(getDevToken(), workId, { liff_enabled: next });
      showToast(next ? "LIFFを有効にしました" : "LIFFを無効にしました", "success");
    } catch {
      setLiffEnabled(prev); // rollback
      showToast("LIFF状態の更新に失敗しました", "error");
    } finally {
      setSavingLiffEnabled(false);
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

  // PR-B: LIFFページの完全削除（アーカイブとは別の危険操作）。
  //   - 公開中は UI でも拒否（API でも 409）。確認ダイアログ必須・二重送信防止。
  //   - 失敗時は API のエラー文言（公開中 / 参照中など）を toast に表示する。
  const handleDelete = async (page: LiffPageSummary) => {
    if (isReadOnly || deletingId) return;
    if (page.publish_status === "published") {
      showToast("公開中のページは削除できません。先に非公開またはアーカイブしてください。", "error");
      return;
    }
    const label = page.title?.trim() || "タイトル未設定";
    const confirmed =
      typeof window === "undefined" ||
      window.confirm(`このLIFFページ「${label}」を完全に削除します。\n削除後は復元できません。よろしいですか？`);
    if (!confirmed) return;

    setDeletingId(page.id);
    try {
      await liffConfigApi.deletePage(getDevToken(), workId, page.id);
      showToast("LIFFページを削除しました。", "success");
      await reload();
    } catch (err) {
      // ConflictError(409) / UnprocessableError(422) は API のメッセージを保持している。
      const msg = err instanceof Error && err.message ? err.message : "LIFFページの削除に失敗しました。";
      showToast(msg, "error");
    } finally {
      setDeletingId(null);
    }
  };

  // ホームに並ぶ詳細ページ / 独立ページの振り分け（show_in_menu）。
  const detailPages = useMemo(
    () => (pages ?? []).filter((p) => p.show_in_menu !== false),
    [pages],
  );
  const standalonePages = useMemo(
    () => (pages ?? []).filter((p) => p.show_in_menu === false),
    [pages],
  );

  if (loading || roleLoading) {
    return (
      <div className="p-6">
        <InlineWhaleLoader minHeight={200} />
      </div>
    );
  }

  // プラン不足: 直 URL アクセス時にここで遮断する
  if (!planLoading && !planAccess.allowed) {
    return (
      <PlanRequiredCard
        oaId={oaId}
        workId={workId}
        featureKey={FEATURE.liffDisplay}
        currentPlan={planTier}
        featureLabel="LIFF設定"
      />
    );
  }

  const activeMeta = LIFF_ADMIN_TABS.find((t) => t.key === activeTab);

  return (
    <div className="px-6 pb-6">
      <Breadcrumb
        items={[
          { label: "作品一覧", href: `/oas/${oaId}/works` },
          { label: workTitle || "作品", href: `/oas/${oaId}/works/${workId}` },
          { label: "LIFF設定" },
        ]}
      />

      {isReadOnly && <ViewerBanner role={role} />}

      {/* 作品単位の LIFF 有効/無効 — 無効にすると実機 LIFF からアクセス不可。CMS では引き続き編集可。 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-900">LIFFページ</h2>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              name="liff-enabled"
              checked={liffEnabled}
              onChange={() => handleToggleLiffEnabled(true)}
              disabled={isReadOnly || savingLiffEnabled}
            />
            有効
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              name="liff-enabled"
              checked={!liffEnabled}
              onChange={() => handleToggleLiffEnabled(false)}
              disabled={isReadOnly || savingLiffEnabled}
            />
            無効
          </label>
          {savingLiffEnabled && <span className="text-xs text-gray-500">保存中...</span>}
        </div>
        {!liffEnabled && (
          <p className="text-[12px] text-amber-700 mt-2">
            ⚠ 現在 LIFF は無効です。実機からアクセスすると &quot;このLIFFは現在無効になっています&quot; と表示されます。Studio 内では引き続き編集・プレビューできます。
          </p>
        )}
      </div>

      {/* タブ ── ?tab= で状態保持。アクティブ下線は work detail 配下の他タブと揃える。 */}
      <div role="tablist" aria-label="LIFF 管理タブ" className="flex gap-1 border-b border-gray-200 mb-3 flex-wrap">
        {LIFF_ADMIN_TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={`${pathname}?tab=${tab.key}`}
              role="tab"
              aria-selected={isActive}
              scroll={false}
              className={`px-[18px] py-2 text-[13px] font-semibold whitespace-nowrap -mb-px border-b-2 transition-colors ${
                isActive
                  ? "border-[#06C755] text-[#06C755]"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      {activeMeta && (
        <p className="text-[12px] text-gray-500 leading-relaxed mb-4">{activeMeta.description}</p>
      )}

      {activeTab === "home" && (
        <HomeTab
          oaId={oaId}
          workId={workId}
          workPublicId={workPublicId}
          workTitle={workTitle}
          pages={pages ?? []}
          homeInit={homeSettings}
          isReadOnly={isReadOnly}
          onSaved={() => { void reload(); }}
        />
      )}

      {activeTab === "detail" && (
        <PageListTab
          oaId={oaId}
          workId={workId}
          pages={detailPages}
          isReadOnly={isReadOnly}
          creating={creating}
          copied={copied}
          analytics={analytics}
          onCreate={handleCreate}
          onCopyUrl={handleCopyUrl}
          onDelete={handleDelete}
          deletingId={deletingId}
          emptyTitle="ホームに表示する詳細ページがまだありません"
          emptyDescription="LIFFページ編集の「ホームに表示する」をオンにすると、ここに表示されます。"
        />
      )}

      {activeTab === "standalone" && (
        <PageListTab
          oaId={oaId}
          workId={workId}
          pages={standalonePages}
          isReadOnly={isReadOnly}
          creating={creating}
          copied={copied}
          analytics={analytics}
          onCreate={handleCreate}
          onCopyUrl={handleCopyUrl}
          onDelete={handleDelete}
          deletingId={deletingId}
          emptyTitle="独立ページがまだありません"
          emptyDescription="作品メニューには表示せず、QRやURLから直接開きたいページを作成できます。"
        />
      )}

      {activeTab === "survey" && (
        <SurveyFaqTab
          oaId={oaId}
          workId={workId}
          kind="survey"
          pages={pages ?? []}
          isReadOnly={isReadOnly}
          onSaved={() => { void reload(); }}
        />
      )}

      {activeTab === "faq" && (
        <SurveyFaqTab
          oaId={oaId}
          workId={workId}
          kind="faq"
          pages={pages ?? []}
          isReadOnly={isReadOnly}
          onSaved={() => { void reload(); }}
        />
      )}

      {activeTab === "analytics" && (
        <AnalyticsTab pages={pages ?? []} analytics={analytics} />
      )}
    </div>
  );
}
