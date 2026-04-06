"use client";

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
import { useIsMobile } from "@/hooks/useIsMobile";
import { trackEvent } from "@/lib/event-tracker";
import { useTesterMode } from "@/hooks/useTesterMode";
import { WorksEmptyState } from "@/components/onboarding/WorksEmptyState";
import { WorkLimitCard } from "@/components/upgrade/WorkLimitCard";

/* ── スケルトンカード ─────────────────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border-light)",
      borderRadius: "var(--radius-md)",
      padding: "20px 22px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div className="skeleton" style={{ width: 56, height: 24, borderRadius: 12 }} />
        <div className="skeleton" style={{ width: 180, height: 18, flex: 1 }} />
        <div className="skeleton" style={{ width: 72, height: 30, borderRadius: 6 }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
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
  const sp = useIsMobile();
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

  // ステータ��変更コールバック — WorkCard の楽観的更新が成功した後に呼ばれる。
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

  return (
    <>
      {/* ── ページヘッダー ── */}
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            ...(oaTitle ? [{ label: oaTitle }] : []),
          ]} />
          <h2>作品リスト</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
            {oaTitle ? `${oaTitle} の謎解きシナリオを管理します` : "謎解きシナリオを管理します"}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
              style={{
                fontSize:       12,
                fontWeight:     600,
                color:          "var(--color-primary, #2F6F5E)",
                textDecoration: "none",
                padding:        "6px 12px",
                borderRadius:   "var(--radius-sm)",
                border:         "1px solid #b9ddd6",
                background:     "var(--color-primary-soft, #EAF4F1)",
                whiteSpace:     "nowrap",
              }}
            >
              プランを見る
            </Link>
          )}
          {!isTester && !isRoleTester && (
            <Link href={`/oas/${oaId}/settings`} className="btn btn-ghost">
              ⚙ 設定
            </Link>
          )}
          {/* 作品上限到達 → グレーアウトボタン */}
          {atLimit ? (
            <button className="btn btn-primary" disabled style={{ opacity: 0.45, cursor: "not-allowed" }}>
              ＋ 作品を追加
            </button>
          ) : !isTester ? (
            /* 上限未到達（テスターモード以外） → 通常ボタン */
            <Link href={`/oas/${oaId}/works/new`} className="btn btn-primary">
              ＋ 作品を追加
            </Link>
          ) : null}
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
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 14px",
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: "var(--radius-md)",
          marginBottom: 16,
          fontSize: 12, color: "#b45309",
        }}>
          <span>※ テスター環境のため、一部機能は制限されています。</span>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {error}
          <button onClick={load} style={{ marginLeft: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
            再読み込み
          </button>
        </div>
      )}

      {/* ── 統計サマリー ── */}
      {!loading && works.length > 0 && (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: sp ? 12 : 10,
          marginBottom: 20,
          padding: sp ? "12px 14px" : "14px 18px",
          background: "var(--surface)",
          border: "1px solid var(--border-light)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-xs)",
        }}>
          {[
            { label: "総作品数", value: works.length, color: "var(--text-primary)" },
            { label: "公開中", value: activeCount, color: "var(--color-success)" },
            {
              label: "総プレイヤー数",
              value: works.reduce((s, w) => s + (w._count.userProgress ?? 0), 0).toLocaleString(),
              color: "var(--color-info)",
            },
          ].map((s, i, arr) => (
            <div key={s.label} style={{
              display: "flex", alignItems: "center", gap: 6,
              paddingRight: sp ? 0 : 18,
              // SP ではボーダーなし、PC では最後以外に右ボーダー
              borderRight: (!sp && i < arr.length - 1) ? "1px solid var(--border-light)" : "none",
            }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── ツールバー（検索 / 絞り込み / 並び替え） ── */}
      {!loading && works.length > 0 && (
        <div style={{
          display:      "flex",
          alignItems:   "center",
          flexWrap:     "wrap",
          gap:          8,
          marginBottom: 8,
        }}>
          {/* 検索ボックス */}
          <div style={{ position: "relative", flex: "1 1 160px", minWidth: 0, maxWidth: 320 }}>
            {/* 虫眼鏡アイコン */}
            <svg
              width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="var(--text-muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="タイトル / 開始トリガーで検索"
              aria-label="作品を検索"
              style={{
                width:        "100%",
                boxSizing:    "border-box",
                fontSize:     12,
                color:        "var(--text-primary)",
                background:   "var(--surface)",
                border:       "1px solid var(--border-light)",
                borderRadius: "var(--radius-sm, 6px)",
                padding:      "5px 10px 5px 30px",
                outline:      "none",
              }}
            />
          </div>

          {/* 「未設定のみ」チェックボックス */}
          <label style={{
            display:    "inline-flex",
            alignItems: "center",
            gap:        5,
            fontSize:   12,
            color:      onlyUnset ? "var(--text-primary)" : "var(--text-secondary)",
            cursor:     "pointer",
            userSelect: "none",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}>
            <input
              type="checkbox"
              checked={onlyUnset}
              onChange={(e) => setOnlyUnset(e.target.checked)}
              style={{ accentColor: "#fbbf24", cursor: "pointer" }}
            />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#fbbf24" }} aria-hidden="true" />
              トリガー未設定のみ
            </span>
          </label>

          {/* 件数表示 */}
          <span style={{
            fontSize:   11,
            color:      isFiltering ? "var(--text-secondary)" : "var(--text-muted)",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}>
            {isFiltering
              ? <>{filtered.length} <span style={{ color: "var(--text-muted)" }}>/ {works.length} 件</span></>
              : <>{works.length} 件</>
            }
          </span>

          {/* 並び替えセレクト — 2件以上のときのみ */}
          {works.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: "auto", flexShrink: 0 }}>
              <label
                htmlFor="works-sort-select"
                style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", userSelect: "none" }}
              >
                並び替え:
              </label>
              <select
                id="works-sort-select"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                style={{
                  fontSize:     12,
                  color:        "var(--text-secondary, #374151)",
                  background:   "var(--surface)",
                  border:       "1px solid var(--border-light)",
                  borderRadius: "var(--radius-sm, 6px)",
                  padding:      "4px 24px 4px 8px",
                  cursor:       "pointer",
                  outline:      "none",
                  appearance:   "auto",
                  maxWidth:     sp ? 148 : 190,
                }}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* ── コンテンツ ── */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : works.length === 0 ? (
        /* 作品ゼロ → 初回 empty state */
        <WorksEmptyState oaId={oaId} isTester={isTester} />
      ) : filtered.length === 0 ? (
        /* 作品はあるがフィルタ結果がゼロ */
        <div style={{
          textAlign:    "center",
          padding:      "40px 20px",
          color:        "var(--text-muted)",
          background:   "var(--surface)",
          border:       "1px solid var(--border-light)",
          borderRadius: "var(--radius-md)",
        }}>
          {/* 検索アイコン */}
          <div style={{
            display:        "inline-flex",
            alignItems:     "center",
            justifyContent: "center",
            width:          44,
            height:         44,
            borderRadius:   10,
            background:     "var(--gray-50)",
            border:         "1px solid var(--border-light)",
            marginBottom:   14,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
            該当する作品が見つかりませんでした
          </p>
          <p style={{ fontSize: 12, lineHeight: 1.7 }}>
            {onlyUnset && q
              ? `「${q}」かつ開始トリガー未設定の作品はありません`
              : onlyUnset
              ? "開始トリガーが未設定の作品はありません"
              : `「${q}」に一致する作品はありません`}
          </p>
          <button
            onClick={() => { setQuery(""); setOnlyUnset(false); }}
            style={{
              marginTop:    16,
              fontSize:     12,
              color:        "var(--color-primary, #2F6F5E)",
              background:   "none",
              border:       "none",
              cursor:       "pointer",
              textDecoration: "underline",
            }}
          >
            絞り込みをリセット
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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

      {/* ── 友だち追加 ── */}
      {!loading && friendAdd?.add_url && (
        <FriendAddSection
          addUrl={friendAdd.add_url}
          changeHref={!isTester ? `/oas/${oaId}/friend-add` : undefined}
        />
      )}
    </>
  );
}
