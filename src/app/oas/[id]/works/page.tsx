"use client";

// src/app/oas/[id]/works/page.tsx
// 作品一覧ページ。
// Phase 3.2a: ページ外枠 (= ヘッダー / アクション / バナー / 統計サマリー / ツールバー /
// skeleton / filtered empty / error) のみ Phase 0 トークンに揃える。
// WorkCard / WorksEmptyState / WorkLimitCard / FriendAddSection / ViewerBanner には触らない。
// 検索 / filter / sort / delete / API / 権限判定 は完全維持。

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { WorkCard } from "@/components/WorkCard";
import { FriendAddSection } from "@/components/FriendAddSection";
import { oaApi, workApi, friendAddApi, getDevToken, type WorkListItem } from "@/lib/api-client";
import { trackBillingEvent } from "@/lib/billing-tracker";
import { buildPricingUrl } from "@/lib/pricing-url";
import type { FriendAddSettings, PublishStatus } from "@/types";
import { useToast } from "@/components/Toast";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { useWorkLimit } from "@/hooks/useWorkLimit";
import { ViewerBanner } from "@/components/PermissionGuard";
import { trackEvent } from "@/lib/event-tracker";
import { useTesterMode } from "@/hooks/useTesterMode";
import { WorksEmptyState } from "@/components/onboarding/WorksEmptyState";
import { WorkLimitCard } from "@/components/upgrade/WorkLimitCard";
import { Button, buttonClass } from "@/components/shared";

// 行内 input / select 用の共通 className (= Phase 3.1 の compactInputClass パターン流用)
const compactInputClass =
  "rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink " +
  "placeholder:text-ink-3 transition-shadow focus:border-brand focus:outline-none " +
  "focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-bg-tint " +
  "disabled:text-ink-3";

/* ── スケルトンカード ─────────────────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-sm">
      <div className="mb-3.5 flex items-center gap-3">
        <div className="skeleton" style={{ width: 56, height: 24, borderRadius: 12 }} />
        <div className="skeleton flex-1" style={{ width: 180, height: 18 }} />
        <div className="skeleton" style={{ width: 72, height: 30, borderRadius: 6 }} />
      </div>
      <div className="flex flex-wrap gap-2">
        {[80, 70, 90, 90].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 24, borderRadius: 12 }} />
        ))}
      </div>
    </div>
  );
}

/* ── メインページ ─────────────────────────────────────────────────────── */
export default function WorkListPage() {
  const params  = useParams<{ id: string }>();
  const oaId    = params.id;
  const { showToast } = useToast();
  const { role, isTester: isRoleTester } = useWorkspaceRole(oaId);
  const { isTester } = useTesterMode();
  const { maxWorks, planDisplayName, planName, loading: limitLoading } = useWorkLimit(oaId);

  const [oaTitle, setOaTitle]     = useState("");
  const [works, setWorks]         = useState<WorkListItem[]>([]);
  const [friendAdd, setFriendAdd] = useState<FriendAddSettings | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  // ── 検索 / 絞り込み ────────────────────────────────────────────────────
  const [query,     setQuery]     = useState("");
  const [onlyUnset, setOnlyUnset] = useState(false);

  // プランの作品数上限に達しているか（subscription ベース）
  // maxWorks === null（未設定）または -1（無制限）の場合は上限なし
  // loading / limitLoading 中は false（ちらつき防止）
  const atLimit = maxWorks !== null && maxWorks !== -1 && !loading && !limitLoading && works.length >= maxWorks;
  // "プランを見る" リンクの表示判定:
  //   - subscription ベース（maxWorks に制限がある）→ 常時表示
  //   - Subscription 未設定の旧 OA で tester ロールの場合も表示（フォールバック）
  const showPricingLink = (maxWorks !== null && maxWorks !== -1) || isRoleTester;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = getDevToken();
      const [oa, list, fa] = await Promise.all([
        oaApi.get(token, oaId),
        workApi.list(token, oaId),
        friendAddApi.get(token, oaId).catch(() => null),  // 未設定でも 404 → null
      ]);
      setOaTitle(oa.title);
      setWorks(list);
      setFriendAdd(fa);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const token = getDevToken();
    trackEvent("screen_view", { page: "/oas/[id]/works" }, { token, oa_id: oaId });
    trackEvent("flow_step",   { step: "works", source: "direct" }, { token, oa_id: oaId });
  // oaId 変化時のみ再実行
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oaId]);

  // ステータス変更コールバック — WorkCard の楽観的更新が成功した後に呼ばれる。
  // 全件 refetch なしでリスト state を同期する。
  function handleStatusChange(id: string, newStatus: PublishStatus) {
    setWorks((prev) =>
      prev.map((w) => w.id === id ? { ...w, publish_status: newStatus } : w)
    );
  }

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

  // ── 検索 / フィルタ / ソートの state ─────────────────────────────────────
  // 現在はローカル state のみ。将来 URL クエリと同期する場合は以下の方針で拡張する:
  //   - useSearchParams() で初期値を読み込み
  //   - 各 setter の中で router.replace() によりクエリを更新
  //   - SortKey / query / onlyUnset を URLSearchParams のキーにマッピング
  //   例: ?sort=completed_desc&q=脱出&unset=1
  //
  // SortKey の追加手順: ① 型ユニオンに追加 → ② SORT_OPTIONS に追加 → ③ sortFn の switch に追加
  type SortKey =
    | "updated_at_desc"
    | "title_asc"
    | "in_progress_desc"
    | "completed_desc"
    | "sort_order_asc";

  const SORT_OPTIONS: { value: SortKey; label: string }[] = [
    { value: "updated_at_desc",  label: "最終更新が新しい順"    },
    { value: "title_asc",        label: "タイトル順"            },
    { value: "completed_desc",   label: "完了数が多い順"        },
    { value: "in_progress_desc", label: "進行中ユーザーが多い順" },
    { value: "sort_order_asc",   label: "表示順"                },
  ];

  const [sortKey, setSortKey] = useState<SortKey>("updated_at_desc");

  function sortFn(a: WorkListItem, b: WorkListItem): number {
    // 第2キー: 同値時は updated_at desc で安定させる
    const byUpdatedAt = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();

    switch (sortKey) {
      case "updated_at_desc":
        return byUpdatedAt;

      case "title_asc": {
        const cmp = a.title.localeCompare(b.title, "ja");
        return cmp !== 0 ? cmp : byUpdatedAt;
      }

      case "completed_desc": {
        const ac = a.progress_stats?.completed ?? 0;
        const bc = b.progress_stats?.completed ?? 0;
        return bc !== ac ? bc - ac : byUpdatedAt;
      }

      case "in_progress_desc": {
        const aip = a.progress_stats?.in_progress ?? 0;
        const bip = b.progress_stats?.in_progress ?? 0;
        return bip !== aip ? bip - aip : byUpdatedAt;
      }

      case "sort_order_asc": {
        const cmp = (a.sort_order ?? 0) - (b.sort_order ?? 0);
        return cmp !== 0 ? cmp : byUpdatedAt;
      }

      default:
        return byUpdatedAt;
    }
  }

  const sorted = [...works].sort(sortFn);

  // ── フィルタリング ──────────────────────────────────────────────────────
  // query: タイトル / 開始トリガーの部分一致（大文字小文字を無視）
  // onlyUnset: 開始トリガー未設定のみ表示
  const q = query.trim().toLowerCase();
  const filtered = sorted.filter((w) => {
    if (onlyUnset && w.start_trigger != null) return false;
    if (q) {
      const inTitle   = w.title.toLowerCase().includes(q);
      const inTrigger = (w.start_trigger ?? "").toLowerCase().includes(q);
      if (!inTitle && !inTrigger) return false;
    }
    return true;
  });
  // フィルタ適用中かどうか（件数表示の出し分けに使う）
  const isFiltering = q !== "" || onlyUnset;

  const activeCount = works.filter((w) => w.publish_status === "active").length;

  // ── 「プランを見る」リンク用 className (= brand-soft 系の専用トーン、primary より控えめ) ──
  const pricingLinkClass =
    "inline-flex items-center justify-center whitespace-nowrap rounded-md " +
    "border border-brand/30 bg-brand-soft px-3 py-1.5 text-[12px] font-semibold " +
    "text-brand-ink no-underline transition-shadow hover:shadow-sm";

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            ...(oaTitle ? [{ label: oaTitle }] : []),
          ]} />
          <h2 className="font-round mt-1 text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
            作品リスト
          </h2>
          <p className="mt-1 text-[12px] text-ink-3">
            {oaTitle ? `${oaTitle} の作品を管理します` : "作品を管理します"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 作品数制限があるプランには「プランを見る」リンクを常時表示 */}
          {showPricingLink && (
            <Link
              href={buildPricingUrl({ source: "header", from: planName ?? undefined, to: "editor", oaId })}
              onClick={() => trackBillingEvent(
                "pricing_click_from_header",
                getDevToken(),
                "header",
                { from: planName ?? undefined, to: "editor" },
              )}
              className={pricingLinkClass}
            >
              プランを見る
            </Link>
          )}
          {!isTester && !isRoleTester && (
            <Link
              href={`/oas/${oaId}/settings`}
              className={buttonClass({ variant: "ghost", size: "md" })}
            >
              ⚙ 設定
            </Link>
          )}
          {/* 「＋ 作品を追加」:
              - isTester は表示しない (= 上限状態に関係なく非表示。既存挙動)
              - atLimit (= 上限到達) は disabled な primary button (Link は無効化不可のため Button で表現)
              - 通常時は primary Link で /works/new に遷移 */}
          {!isTester && (
            atLimit ? (
              <Button
                type="button"
                variant="primary"
                size="md"
                disabled
                aria-disabled="true"
                title="作品数の上限に達しています"
              >
                ＋ 作品を追加
              </Button>
            ) : (
              <Link
                href={`/oas/${oaId}/works/new`}
                className={buttonClass({ variant: "primary", size: "md" })}
              >
                ＋ 作品を追加
              </Link>
            )
          )}
        </div>
      </div>

      <ViewerBanner role={role} />

      {/* 作品上限到達 → アップグレード誘導バナー */}
      {atLimit && (
        <WorkLimitCard
          variant="banner"
          maxWorks={maxWorks ?? undefined}
          planDisplayName={planDisplayName ?? undefined}
          planName={planName ?? undefined}
        />
      )}

      {/* テスターモード時の注意文 */}
      {isTester && (
        <div
          role="status"
          className="mb-4 rounded-field border border-warn/30 bg-warn-soft px-4 py-2.5 text-[12px] leading-[1.6] text-warn"
        >
          ※ テスター環境のため、一部機能は制限されています。
        </div>
      )}

      {/* ── エラー ── */}
      {error && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-field border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] leading-[1.6] text-danger"
        >
          <span>{error}</span>
          <Button type="button" variant="ghost" size="sm" onClick={load}>
            再読み込み
          </Button>
        </div>
      )}

      {/* ── 統計サマリー ── */}
      {!loading && works.length > 0 && (
        <div className="mb-5 grid grid-cols-3 gap-3 rounded-card border border-line bg-surface p-4 shadow-sm sm:flex sm:flex-wrap sm:items-center sm:gap-0 sm:px-5 sm:py-3.5">
          {[
            { label: "総作品数", value: works.length.toLocaleString(), tone: "ink" },
            { label: "公開中", value: activeCount.toLocaleString(),    tone: "brand" },
            {
              label: "総プレイヤー数",
              value: works.reduce((s, w) => s + (w._count.userProgress ?? 0), 0).toLocaleString(),
              tone:  "sky",
            },
          ].map((s, i, arr) => (
            <div
              key={s.label}
              className={
                "flex flex-col items-start gap-0.5 " +
                "sm:flex-row sm:items-center sm:gap-1.5 sm:pr-5 " +
                (i < arr.length - 1 ? "sm:border-r sm:border-line-2" : "")
              }
            >
              <span
                className={
                  "font-num text-[18px] font-extrabold leading-none " +
                  (s.tone === "brand" ? "text-brand-ink"
                   : s.tone === "sky"  ? "text-sky-ink"
                   : "text-ink")
                }
              >
                {s.value}
              </span>
              <span className="text-[11px] text-ink-3">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── ツールバー（検索 / 絞り込み / 並び替え） ── */}
      {!loading && works.length > 0 && (
        <div className="mb-2 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {/* 検索ボックス */}
          <div className="relative min-w-0 sm:max-w-[320px] sm:flex-1 sm:basis-[160px]">
            {/* 虫眼鏡アイコン */}
            <svg
              width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
            >
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="タイトル / 開始トリガーで検索"
              aria-label="作品を検索"
              className={compactInputClass + " w-full !pl-8"}
            />
          </div>

          {/* 「未設定のみ」チェックボックス */}
          <label
            className={
              "inline-flex flex-shrink-0 cursor-pointer select-none items-center gap-1.5 " +
              "whitespace-nowrap text-[12px] " +
              (onlyUnset ? "text-ink" : "text-ink-2")
            }
          >
            <input
              type="checkbox"
              checked={onlyUnset}
              onChange={(e) => setOnlyUnset(e.target.checked)}
              className="cursor-pointer accent-warn"
            />
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-warn" />
              トリガー未設定のみ
            </span>
          </label>

          {/* 件数表示 */}
          <span className="flex-shrink-0 whitespace-nowrap text-[11px] text-ink-3">
            {isFiltering ? (
              <>
                <span className="text-ink-2">{filtered.length}</span>
                <span> / {works.length} 件</span>
              </>
            ) : (
              <>{works.length} 件</>
            )}
          </span>

          {/* 並び替えセレクト — 2件以上のときのみ */}
          {works.length > 1 && (
            <div className="flex flex-shrink-0 items-center gap-1.5 sm:ml-auto">
              <label
                htmlFor="works-sort-select"
                className="select-none whitespace-nowrap text-[11px] text-ink-3"
              >
                並び替え:
              </label>
              <select
                id="works-sort-select"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className={compactInputClass + " cursor-pointer pr-6 sm:max-w-[200px]"}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* ── コンテンツ ──
          表示分岐の優先順:
            1. loading 中 → スケルトン
            2. error あり → エラーバナーのみ (= 上部の banner)。空状態は出さない。
            3. works.length === 0 → 初回 empty state (WorksEmptyState)
            4. それ以外 → 検索結果 / 一覧表示 */}
      {loading ? (
        <div className="flex flex-col gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        /* エラー時はコンテンツ領域を空にする (エラーバナーは上部で既に表示済み) */
        null
      ) : works.length === 0 ? (
        /* 作品ゼロ → 初回 empty state (= 別管理) */
        <WorksEmptyState oaId={oaId} isTester={isTester} />
      ) : filtered.length === 0 ? (
        /* 作品はあるがフィルタ結果がゼロ */
        <div className="rounded-card border border-line bg-surface px-5 py-10 text-center shadow-sm">
          {/* 検索アイコン */}
          <div className="mx-auto mb-3.5 inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-bg-tint">
            <svg
              width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
              className="text-ink-3"
            >
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <p className="mb-1.5 text-[14px] font-semibold text-ink-2">
            該当する作品が見つかりませんでした
          </p>
          <p className="text-[12px] leading-[1.7] text-ink-3">
            {onlyUnset && q
              ? `「${q}」かつ開始トリガー未設定の作品はありません`
              : onlyUnset
              ? "開始トリガーが未設定の作品はありません"
              : `「${q}」に一致する作品はありません`}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-4"
            onClick={() => { setQuery(""); setOnlyUnset(false); }}
          >
            絞り込みをリセット
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((w) => (
            <WorkCard
              key={w.id}
              work={w}
              oaId={oaId}
              basePath={`/oas/${oaId}/works`}
              role={role}
              onDelete={!isTester ? handleDelete : undefined}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}

      {/* ── 友だち追加 (= 別管理コンポーネント、本 PR では触らない) ── */}
      {!loading && friendAdd?.add_url && (
        <FriendAddSection
          addUrl={friendAdd.add_url}
          changeHref={!isTester ? `/oas/${oaId}/friend-add` : undefined}
        />
      )}
    </>
  );
}
