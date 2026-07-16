"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { oaApi, workApi, getDevToken, type OaListItem, type OaListMeta, type WorkListItem } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { usePlatformRole } from "@/hooks/usePlatformRole";
import { RoleBadge } from "@/components/PermissionGuard";
import { Button, StatusBadge, buttonClass } from "@/components/shared";
import { OasViewPreviewBar } from "@/components/OasViewPreviewBar";
import { canCreateOaInView, isPreviewingOasView, viewingAsOwnerOrAbove, OAS_VIEW_ROLE_LABELS } from "@/lib/oas-preview";
import { usageTypeShortLabel } from "@/lib/usage-type";
import { compareByLatestActivity, compareByCreated, sortByLatestActivity } from "@/lib/list-sort";
import { formatDateTime } from "@/lib/format-datetime";
import { SingleOaDashboard } from "./_single-oa-dashboard";
import { isSingleAccountView } from "@/lib/oa-dashboard";
import type { Role } from "@/lib/types/permissions";

// ── 定数 ─────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  draft:  "未設定",
  active: "公開中",
  paused: "停止中",
};

/** publish_status を StatusBadge の tone にマップする。 */
function statusTone(s: string): "active" | "muted" | "warn" {
  if (s === "active") return "active";
  if (s === "paused") return "warn";
  return "muted"; // draft / unknown
}

// ── 情報グリッドの label / value 部品 ──
function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3 whitespace-nowrap">
        {label}
      </div>
      <div className="text-[13px] font-semibold leading-[1.4] text-ink">{children}</div>
    </div>
  );
}

/* ── アカウント一覧の並び替え ──────────────────────────────────────────────
 *  作品リスト（works/page.tsx）のソートUIに合わせる。アカウントが2件以上のときのみ表示。
 *  ※ Oa には sort_order が無いため「表示順」は作成日時昇順（登録順）を採用する。 */
type OaSortKey =
  | "updated_at_desc"
  | "title_asc"
  | "works_desc"
  | "players_desc"
  | "display_order";

const OA_SORT_OPTIONS: { value: OaSortKey; label: string }[] = [
  { value: "updated_at_desc", label: "最終更新が新しい順"    },
  { value: "title_asc",       label: "タイトル順"            },
  { value: "works_desc",      label: "作品数が多い順"        },
  { value: "players_desc",    label: "プレイヤー数が多い順"  },
  { value: "display_order",   label: "表示順"                },
];

/* ── 作品名セル ──────────────────────────────────────────────────────────── */
function WorksCell({
  oaId,
  hasAccess,
  worksMap,
  worksLoading,
}: {
  oaId: string;
  /** 現ユーザーが workspace へアクセス可能か（owner_key 一致 or active WorkspaceMember のみ true）。
   *  platform admin の showAll 表示時、非メンバー OA では false。my_role は showAll 時 'owner'
   *  が返るためここの判定には使わない。 */
  hasAccess: boolean;
  worksMap: Record<string, WorkListItem[]>;
  worksLoading: boolean;
}) {
  // メンバー外の OA は workApi.list をスキップしているため、件数が分からない。
  // 0 件と誤解されないよう「権限外」と表示する（platform admin の全OA表示時のみ発生）。
  if (!hasAccess) {
    return (
      <span
        className="inline-flex items-center rounded-full border border-line bg-bg-tint px-2.5 py-0.5 text-[12px] text-ink-3 whitespace-nowrap"
        title="このアカウントのメンバーではないため、作品一覧は取得していません"
      >
        — 権限外
      </span>
    );
  }
  if (worksLoading) {
    return <div className="skeleton" style={{ width: 100, height: 14, borderRadius: 4 }} />;
  }
  const ws = worksMap[oaId];
  if (!ws || ws.length === 0) {
    return (
      <Link
        href={`/oas/${oaId}/works`}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-sky/40 bg-sky-soft px-2.5 py-0.5 text-[12px] text-sky-ink whitespace-nowrap"
      >
        ＋ 作品を追加
      </Link>
    );
  }
  // 作品ごとの最終更新（latest_activity_at = 作品配下 Phase/Message/Character/LIFF 等の最新編集）が
  // 新しい順に並べる（= 最近触った作品が上）。同値は id で安定 tie-break。
  const sorted = sortByLatestActivity(ws);
  return (
    <div className="flex flex-col divide-y divide-line/60">
      {sorted.map((w) => (
        <div key={w.id} className="flex flex-col gap-0.5 py-1 first:pt-0 last:pb-0">
          <Link
            href={`/oas/${oaId}/works/${w.id}`}
            title={`${w.title} の作品管理へ`}
            className="inline-flex max-w-full items-center gap-1 text-[13px] font-semibold leading-[1.4] text-ink transition-colors hover:text-brand-ink hover:underline hover:underline-offset-2"
          >
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{w.title}</span>
            <span className="flex-shrink-0 text-[13px] leading-none text-ink-3">›</span>
          </Link>
          {/* 作品ごとの作成日時・最終更新（PC 横並び / モバイル 縦積み）。最終更新は latest_activity_at。 */}
          <div className="flex flex-col gap-x-3 gap-y-0.5 font-num text-[10px] leading-tight text-ink-3 sm:flex-row sm:flex-wrap">
            <span>作成 {formatDateTime(w.created_at)}</span>
            <span>最終更新 {formatDateTime(w.latest_activity_at ?? w.updated_at ?? w.created_at)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── スケルトン (OA カード) ──────────────────────────────────────────────── */
function SkeletonList() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="skeleton mb-2" style={{ width: 180 + i * 30, height: 18, borderRadius: 4 }} />
              <div className="skeleton mb-5" style={{ width: 100, height: 11, borderRadius: 4 }} />
              <div className="flex flex-wrap gap-x-7 gap-y-3">
                {[60, 72, 140, 66, 66].map((w, j) => (
                  <div key={j}>
                    <div className="skeleton mb-1.5" style={{ width: 40, height: 9, borderRadius: 3 }} />
                    <div className="skeleton" style={{ width: w, height: 13, borderRadius: 4 }} />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:min-w-[108px]">
              <div className="skeleton" style={{ height: 32, borderRadius: 999 }} />
              <div className="skeleton" style={{ height: 32, borderRadius: 999 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── アカウントリスト（クライアント本体） ──────────────────────────────────────
   ルートの page.tsx（Server Component）から呼ばれる。アクセス可能 OA が 1 件のみの
   ユーザーは page.tsx 側で作品一覧へ redirect 済みのため、ここには 0 件 or 複数件のみ到達する。 */
export function OaListClient() {
  const [items,        setItems]        = useState<OaListItem[]>([]);
  const [meta,         setMeta]         = useState<OaListMeta | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [worksLoading, setWorksLoading] = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [page,         setPage]         = useState(1);
  const [worksMap,     setWorksMap]     = useState<Record<string, WorkListItem[]>>({});
  const [sortKey,      setSortKey]      = useState<OaSortKey>("updated_at_desc");
  const { showToast }           = useToast();
  const { isPlatformOwner, previewViewRole, setPreviewViewRole } = usePlatformRole();

  // 表示確認モードの視点。実 platform owner のみ有効 (= 一般ユーザーは preview を無視)。
  // platform_owner 視点 (= 既定 / preview 未指定) のときだけ「運営者として」振る舞う表示にする。
  const previewArgs = { isPlatformOwner, previewViewRole };
  const previewingNonOwner = isPreviewingOasView(previewArgs);
  const actAsOwner = canCreateOaInView(previewArgs);
  // 利用区分（個人/法人）を表示してよい「オーナー視点」か。
  // - platform owner: 視点が platform_owner / owner のときのみ表示（admin/editor/viewer 確認中は隠す）。
  // - 一般ユーザー: 各 OA の my_role === "owner" のときのみ（下のループ内で OR 判定）。
  const ownerOrAboveView = viewingAsOwnerOrAbove(previewArgs);

  // 「+ アカウントを追加」を表示する条件:
  //   - platform owner 視点 (= 実 platform owner かつ表示確認で owner 以外を選んでいない) のみ
  //
  // 一般ユーザー (workspace owner / admin / editor / viewer / fresh user) は、
  // 自分で LINE 公式アカウント / OA を追加できない方針。表示確認モードで owner / admin /
  // editor / viewer を選ぶと、この CTA は (UI 上だけ) 非表示になり一般ユーザーの見え方を確認できる。
  //
  // ⚠ これは UI 表示専用。`POST /api/oas` は server 側で実 platform owner を別途検証するため、
  //   表示確認で視点を変えても本物の platform owner 以外は 403 のまま (= 権限は広がらない)。
  //
  // 通常 fresh user は onboarding-guard (`/oas/layout.tsx`) で `/onboarding/*` へ
  // redirect されるため `/oas` に到達しない。`/oas` に items=0 で到達する稀ケースに
  // 備えて、empty state も canCreateOa で「審査中案内 vs bootstrap CTA」を分岐する。
  //
  // OA の新規追加は admin 承認 (`/admin/oa-onboarding`) 経由でのみ可能。
  const canCreateOa = canCreateOaInView(previewArgs);

  async function load(p: number) {
    setLoading(true);
    setWorksLoading(true);
    setError(null);
    try {
      const result = await oaApi.list(getDevToken(), { page: p, limit: 20 });
      setItems(result.data);
      setMeta(result.meta);
      // OA一覧が揃った時点で loading を解除 → OAカードを先行表示
      setLoading(false);

      // 作品リストは OA 一覧とは独立してフェッチ。
      // ⚠ workApi.list (= GET /api/works) は requireRole 経由で非メンバーには 403
      //   WORKSPACE_ACCESS_DENIED を返す。parseResponse はこのコードで即時 /access-denied に
      //   redirect する（catch を素通り）ため、ユーザーがメンバーでない OA に対しては叩かない。
      //   has_workspace_access は API 側で owner_key 一致 or active WorkspaceMember のみ true。
      //   ※ my_role は platform admin の showAll 時 'owner' が返るためフィルタには使えない。
      const token = getDevToken();
      const pairs = await Promise.all(
        result.data.map((oa) =>
          oa.has_workspace_access
            ? workApi.list(token, oa.id)
                .then((ws) => [oa.id, ws] as [string, WorkListItem[]])
                .catch(() => [oa.id, [] as WorkListItem[]] as [string, WorkListItem[]])
            : Promise.resolve([oa.id, [] as WorkListItem[]] as [string, WorkListItem[]]),
        ),
      );
      const map: Record<string, WorkListItem[]> = {};
      for (const [id, ws] of pairs) map[id] = ws;
      setWorksMap(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      setLoading(false);
    } finally {
      setWorksLoading(false);
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

  function totalPlayers(oaId: string): number {
    return (worksMap[oaId] ?? []).reduce((sum, w) => sum + (w.progress_stats?.total ?? 0), 0);
  }

  // アカウント一覧の並び替え（既定: 最終更新が新しい順）。
  //   - 「最終更新」はカード表示と同じ値（latest_activity_at ?? updated_at ?? created_at）で比較（表示=ソート一致）。
  //     latest_activity_at はアカウント配下（Work/Phase/Message/LIFF/X投稿 等）の最新編集も含む。
  //   - 日時は Date(ms) 化して比較（文字列比較しない）。null/無効な日時は常に末尾。
  //   - 同値時は最新活動 降順 → 最後に id で安定 tie-break（表示のちらつき防止・sort は非破壊コピー）。
  function oaSortFn(a: OaListItem, b: OaListItem): number {
    const byUpdated = compareByLatestActivity(a, b, "desc");
    const tieId = () => a.id.localeCompare(b.id);
    const withTie = (cmp: number) => (cmp !== 0 ? cmp : byUpdated !== 0 ? byUpdated : tieId());
    switch (sortKey) {
      case "updated_at_desc":
        return byUpdated !== 0 ? byUpdated : tieId();
      case "title_asc":
        return withTie(a.title.localeCompare(b.title, "ja"));
      case "works_desc":
        return withTie((b._count?.works ?? 0) - (a._count?.works ?? 0));
      case "players_desc":
        return withTie(totalPlayers(b.id) - totalPlayers(a.id));
      case "display_order": {
        // Oa に sort_order が無いため、登録順（作成日時 昇順）を「表示順」とする。null は末尾。
        const cmp = compareByCreated(a, b, "asc");
        return cmp !== 0 ? cmp : tieId();
      }
      default:
        return byUpdated !== 0 ? byUpdated : tieId();
    }
  }
  const sortedItems = [...items].sort(oaSortFn);

  // アクセス可能アカウントがちょうど 1 件のときは専用ダッシュボードを表示（選択のための一覧ではなく概要画面）。
  // 0 件 / 2 件以上は従来どおり（空状態 / 一覧）。読み込み中・エラー時は一覧側の skeleton / error を使う。
  const single = !loading && !error && isSingleAccountView(items.length, meta?.total);
  const singleOa = single ? items[0] : null;

  return (
    <>
      {/* ── 表示確認モード (= platform owner 限定 / UI 表示専用) ── */}
      <OasViewPreviewBar
        isPlatformOwner={isPlatformOwner}
        previewViewRole={previewViewRole}
        onChange={setPreviewViewRole}
      />

      {singleOa ? (
        <>
          {/* お知らせは 0/1/複数件で同一条件（canPost=actAsOwner）で表示する。1件時も消さない。 */}
          <div className="mb-5">
            <AnnouncementBanner canPost={actAsOwner} />
          </div>
          <SingleOaDashboard
            oa={singleOa}
            canCreateOa={canCreateOa}
            isOwner={singleOa.my_role === "owner" && actAsOwner}
            showUsageType={ownerOrAboveView || (!isPlatformOwner && singleOa.my_role === "owner")}
            onDelete={handleDelete}
          />
        </>
      ) : (
      <>

      {/* ── ページヘッダー（「＋ アカウントを追加」のみ。旧 h2「アカウント管理」見出しは削除） ── */}
      {canCreateOa && (
        <div className="mb-4 flex justify-end">
          <Link
            href="/oas/new"
            className={buttonClass({ variant: "primary", size: "md" })}
          >
            ＋ アカウントを追加
          </Link>
        </div>
      )}

      {/* ── お知らせ (= ページ見出し直下 / アカウント一覧見出しの上) ── */}
      <div className="mb-5">
        <AnnouncementBanner canPost={actAsOwner} />
      </div>

      {/* ── アカウント一覧セクション見出し + 並び替え (= お知らせと同階層スタイル) ── */}
      <div className="mb-3 flex items-center justify-between gap-3" style={{ margin: "0 0 12px" }}>
        <h3 className="text-[13px] font-bold tracking-[0.02em] text-ink">
          アカウント一覧
        </h3>
        {/* 並び替えセレクト — アカウントが2件以上のときのみ（作品リストと同様） */}
        {!loading && items.length > 1 && (
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <label
              htmlFor="oas-sort-select"
              className="select-none whitespace-nowrap text-[11px] text-ink-3"
            >
              並び替え:
            </label>
            <select
              id="oas-sort-select"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as OaSortKey)}
              className="cursor-pointer rounded-field border border-line bg-surface px-2.5 py-1 text-[12px] text-ink sm:max-w-[200px]"
            >
              {OA_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ── エラー ── */}
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-3 rounded-field border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] leading-[1.6] text-danger"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => load(page)}
            className="underline hover:no-underline"
          >
            再読み込み
          </button>
        </div>
      )}

      {/* ── 一覧 / スケルトン / 空 ── */}
      {items.length === 0 && !loading ? (
        <div className="rounded-card border border-line bg-surface p-8 text-center shadow-sm">
          {canCreateOa ? (
            // Platform owner で items=0 = まだ何も追加していない管理者
            <>
              <div className="text-[40px] leading-none">📡</div>
              <p className="mt-3 text-[16px] font-bold text-ink">アカウントが未登録です</p>
              <p className="mx-auto mt-2 max-w-[360px] text-[13px] leading-[1.75] text-ink-2">
                まずLINE公式アカウントを登録してください。
                <br />
                登録後、アカウントに紐づく作品を追加できます。
              </p>
              <Link
                href="/oas/new"
                className={buttonClass({ variant: "primary", size: "md", className: "mt-4" })}
              >
                ＋ 最初のアカウントを追加する
              </Link>
            </>
          ) : (
            // 一般ユーザーで items=0 = 通常は onboarding-guard で redirect されるが、
            // 稀に到達した場合の defensive 表示。管理者承認待ちを伝える。
            <>
              <div className="text-[40px] leading-none">⏳</div>
              <p className="mt-3 text-[16px] font-bold text-ink">アカウント審査中です</p>
              <p className="mx-auto mt-2 max-w-[420px] text-[13px] leading-[1.75] text-ink-2">
                Whale Studio の利用には、管理者によるLINE公式アカウント連携の承認が必要です。
                <br />
                承認されると、この画面にアカウント一覧が表示されます。
              </p>
              <p className="mx-auto mt-3 max-w-[420px] text-[12px] leading-[1.6] text-ink-3">
                お急ぎの場合は管理者にお問い合わせください。
              </p>
            </>
          )}
        </div>
      ) : loading ? (
        <SkeletonList />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {sortedItems.map((oa) => {
              const players  = totalPlayers(oa.id);
              const hasRole  = oa.my_role && oa.my_role !== "none";
              const isOwner  = oa.my_role === "owner" && actAsOwner;
              // 利用区分は「オーナー視点」のときのみ表示する（非オーナー権限の表示モードには出さない）。
              //   platform owner → preview 視点に従う / 一般ユーザー → 当該 OA の owner 本人のみ。
              const showUsageType = ownerOrAboveView || (!isPlatformOwner && oa.my_role === "owner");
              return (
                <article
                  key={oa.id}
                  className="group relative overflow-hidden rounded-card border border-line bg-surface p-5 shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-card sm:p-6"
                >
                  {/* 左端の brand アクセントバー (hover 時のみ可視) */}
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-0 h-full w-[3px] bg-brand opacity-0 transition-opacity group-hover:opacity-100"
                  />

                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                    {/* ─── 左: 情報エリア ─── */}
                    <div className="min-w-0 flex-1">
                      {/* アカウント名 + 状態バッジ */}
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <h3 className="font-round overflow-hidden text-ellipsis whitespace-nowrap text-[16px] font-extrabold leading-[1.3] text-ink">
                          {oa.title}
                        </h3>
                        <StatusBadge tone={statusTone(oa.publish_status)}>
                          {STATUS_LABEL[oa.publish_status] ?? oa.publish_status}
                        </StatusBadge>
                      </div>

                      {/* Ch ID / OA ID チップ */}
                      {(oa.channel_id || oa.line_oa_id) && (
                        <div className="mb-3.5 flex flex-wrap gap-1">
                          {oa.channel_id && (
                            <span
                              title={`Channel ID: ${oa.channel_id}`}
                              className="rounded border border-line bg-bg-tint px-1.5 py-0.5 font-mono text-[10px] text-ink-3 whitespace-nowrap"
                            >
                              {oa.channel_id.length > 10
                                ? `${oa.channel_id.slice(0, 4)}…${oa.channel_id.slice(-4)}`
                                : oa.channel_id}
                            </span>
                          )}
                          {oa.line_oa_id && (
                            <span
                              title={`アカウントID: @${oa.line_oa_id}`}
                              className="rounded border border-line bg-bg-tint px-1.5 py-0.5 text-[10px] text-ink-3 whitespace-nowrap"
                            >
                              @{oa.line_oa_id}
                            </span>
                          )}
                        </div>
                      )}

                      {/* 情報グリッド */}
                      <div className={
                        "flex flex-wrap gap-x-8 gap-y-3 " +
                        ((oa.channel_id || oa.line_oa_id) ? "" : "mt-3.5")
                      }>
                        {hasRole && (
                          <MetaItem label="権限">
                            <RoleBadge role={oa.my_role as Role} />
                          </MetaItem>
                        )}

                        {showUsageType && (
                          <MetaItem label="利用区分">
                            <span
                              className={
                                "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold " +
                                (oa.usage_type === "business"
                                  ? "border-brand/30 bg-brand-soft text-brand-ink"
                                  : "border-line bg-bg-tint text-ink-2")
                              }
                            >
                              {usageTypeShortLabel(oa.usage_type)}
                            </span>
                          </MetaItem>
                        )}

                        <MetaItem label="プレイヤー数">
                          <span
                            className={
                              "font-num text-[14px] font-extrabold " +
                              (players > 0 ? "text-sky-ink" : "text-ink-3")
                            }
                          >
                            {players.toLocaleString()}
                          </span>
                        </MetaItem>

                        <div className="min-w-[180px] max-w-[360px] flex-1">
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3 whitespace-nowrap">
                            作品（作成 / 最終更新）
                          </div>
                          <WorksCell oaId={oa.id} hasAccess={oa.has_workspace_access} worksMap={worksMap} worksLoading={worksLoading} />
                        </div>

                        <MetaItem label="アカウント作成日時">
                          <span className="font-num text-ink-2">{formatDateTime(oa.created_at)}</span>
                        </MetaItem>

                        {/* アカウント内の最新活動（配下作品・設定を含む）。並び替え「最終更新が新しい順」の基準と一致。 */}
                        <MetaItem label="アカウント内最終更新">
                          <span className="font-num text-ink-2">{formatDateTime(oa.latest_activity_at ?? oa.updated_at ?? oa.created_at)}</span>
                        </MetaItem>
                      </div>
                    </div>

                    {/* ─── 右: ボタンエリア ─── */}
                    <div className="flex flex-col gap-2 sm:min-w-[108px]">
                      <Link
                        href={`/oas/${oa.id}/works`}
                        className={buttonClass({ variant: "primary", size: "sm", fullWidth: true })}
                      >
                        作品管理
                      </Link>
                      <Link
                        href={`/oas/${oa.id}/settings`}
                        className={buttonClass({ variant: "ghost", size: "sm", fullWidth: true })}
                      >
                        設定
                      </Link>
                      {isOwner && (
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          fullWidth
                          onClick={() => handleDelete(oa.id, oa.title)}
                        >
                          削除
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* ── ページネーション ── */}
          {meta && meta.pages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ← 前へ
              </Button>
              <span className="px-1 text-[12px] text-ink-3">
                {page} / {meta.pages} ページ（計 {meta.total} 件）
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={page >= meta.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                次へ →
              </Button>
            </div>
          )}
        </>
      )}
      </>
      )}

      {/* ── 表示確認中バナー (= owner 以外の視点を確認中) ── */}
      {previewingNonOwner && (
        <div
          role="status"
          className="mt-4 flex items-center gap-3 rounded-field border border-warn/30 bg-warn-soft px-4 py-2.5 text-[13px] text-warn"
        >
          <span aria-hidden="true" className="flex-shrink-0 text-[16px]">👁</span>
          <span className="flex-1">
            <strong>{previewViewRole ? OAS_VIEW_ROLE_LABELS[previewViewRole] : "一般ユーザー"}の表示を確認中</strong>
            {" "}— この視点からの見え方を表示しています（表示のみ・権限は変わりません）。
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPreviewViewRole(null)}
            className="whitespace-nowrap"
          >
            オーナー表示に戻す
          </Button>
        </div>
      )}

    </>
  );
}
