"use client";

// src/app/oas/_list-client.tsx
// アカウント一覧（リニューアルデザイン × #581 機能）。
//   - 見た目はリニューアルデザイン。機能・データ・遷移・権限・テナント境界・件数分岐は現行/#581 を踏襲。
//   - 1件（ダッシュボード）は #581 の SingleOaDashboard（KPI/直近7日/作品/アクティビティ・集約API）をそのまま利用。
//   - 0件 / 複数件 はリニューアルデザインを適用。共通のタイトル行・お知らせは全状態で表示。
//   - 表示データは既存 API（oaApi.list / workApi.list / #581 の dashboard API）のみ。ダミーは追加しない。

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

/* ── アカウント頭文字アバタータイル（アカウント別に安定した淡色・決定論的） ── */
const AVATAR_PALETTE: { bg: string; color: string }[] = [
  { bg: "#e1f0f4", color: "#2b7f9b" },
  { bg: "#f3e9df", color: "#b06a2c" },
  { bg: "#f7e3ec", color: "#c04f80" },
  { bg: "#e6f6ec", color: "#178a48" },
  { bg: "#efeafa", color: "#7a4fd0" },
];
function avatarColor(id: string): { bg: string; color: string } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function Avatar({ id, title, size }: { id: string; title: string; size: number }) {
  const c = avatarColor(id);
  const initial = (title?.trim()?.charAt(0) || "?").toUpperCase();
  return (
    <div
      aria-hidden="true"
      className="flex flex-shrink-0 items-center justify-center font-round font-extrabold"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26), background: c.bg, color: c.color, fontSize: Math.round(size * 0.42) }}
    >
      {initial}
    </div>
  );
}

/* ── 利用区分ピル（区分表示可否は呼び出し側で判定） ── */
function UsageTypePill({ usageType }: { usageType: OaListItem["usage_type"] }) {
  return (
    <span className={
      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold " +
      (usageType === "business" ? "border-brand/30 bg-brand-soft text-brand-ink" : "border-line bg-bg-tint text-ink-2")
    }>
      {usageTypeShortLabel(usageType)}
    </span>
  );
}

/* ── アカウント一覧の並び替え（複数件のみ表示） ── */
type OaSortKey = "updated_at_desc" | "title_asc" | "works_desc" | "players_desc" | "display_order";
const OA_SORT_OPTIONS: { value: OaSortKey; label: string }[] = [
  { value: "updated_at_desc", label: "最終更新が新しい順"    },
  { value: "title_asc",       label: "タイトル順"            },
  { value: "works_desc",      label: "作品数が多い順"        },
  { value: "players_desc",    label: "プレイヤー数が多い順"  },
  { value: "display_order",   label: "表示順"                },
];

/* ── 作品リスト（作成/最終更新つき・既存の作品管理へのリンク） ── */
function WorksList({
  oaId, hasAccess, worksMap, worksLoading,
}: {
  oaId: string; hasAccess: boolean; worksMap: Record<string, WorkListItem[]>; worksLoading: boolean;
}) {
  if (!hasAccess) {
    return (
      <span className="inline-flex items-center rounded-full border border-line bg-bg-tint px-2.5 py-0.5 text-[12px] text-ink-3" title="このアカウントのメンバーではないため、作品一覧は取得していません">
        — 権限外
      </span>
    );
  }
  if (worksLoading) return <div className="skeleton" style={{ width: 160, height: 14, borderRadius: 4 }} />;
  const ws = worksMap[oaId];
  if (!ws || ws.length === 0) {
    return (
      <Link href={`/oas/${oaId}/works`} className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand/40 bg-brand-mist px-2.5 py-0.5 text-[12px] text-brand-ink whitespace-nowrap">
        ＋ 作品を追加
      </Link>
    );
  }
  const sorted = sortByLatestActivity(ws);
  return (
    <div className="flex flex-col gap-1.5">
      {sorted.map((w) => (
        <div key={w.id} className="rounded-[10px] bg-bg-tint px-3 py-2">
          <Link href={`/oas/${oaId}/works/${w.id}`} title={`${w.title} の作品管理へ`} className="inline-flex max-w-full items-center gap-1 text-[13px] font-semibold leading-[1.4] text-brand-ink transition-colors hover:underline hover:underline-offset-2">
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{w.title}</span>
            <span className="flex-shrink-0 text-[13px] leading-none text-ink-3">›</span>
          </Link>
          <div className="mt-0.5 flex flex-col gap-x-3 gap-y-0.5 font-num text-[10px] leading-tight text-ink-3 sm:flex-row sm:flex-wrap">
            <span>作成 {formatDateTime(w.created_at)}</span>
            <span>最終更新 {formatDateTime(w.latest_activity_at ?? w.updated_at ?? w.created_at)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── スケルトン ── */
function SkeletonList() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-card border border-line bg-surface p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="skeleton" style={{ width: 44, height: 44, borderRadius: 12 }} />
            <div className="min-w-0 flex-1">
              <div className="skeleton mb-2" style={{ width: 180 + i * 30, height: 16, borderRadius: 4 }} />
              <div className="skeleton" style={{ width: 120, height: 11, borderRadius: 4 }} />
            </div>
            <div className="skeleton" style={{ width: 96, height: 32, borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── 定義リストの 1 行（詳細アコーディオン用） ── */
function DefRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-2 py-1">
      <div className="text-[11px] font-semibold text-ink-3">{label}</div>
      <div className="text-[12px] text-ink-2">{children}</div>
    </div>
  );
}

/* ── 複数件: アコーディオン式アカウント行 ─────────────────────────────────── */
function AccountListItem({
  oa, players, isOwner, showUsageType, worksMap, worksLoading, onDelete,
}: {
  oa: OaListItem;
  players: number;
  isOwner: boolean;
  showUsageType: boolean;
  worksMap: Record<string, WorkListItem[]>;
  worksLoading: boolean;
  onDelete: (id: string, title: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasRole = oa.my_role && oa.my_role !== "none";
  const ws = worksMap[oa.id] ?? [];
  const latestWork = oa.has_workspace_access ? sortByLatestActivity(ws)[0] : null;
  const panelId = `oa-detail-${oa.id}`;

  return (
    <article className="overflow-hidden rounded-card border border-line bg-surface shadow-sm transition-shadow hover:shadow-card">
      {/* 行ヘッダー（クリックで詳細トグル） */}
      <div className="flex items-center gap-4 px-5 py-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-4 text-left"
        >
          <Avatar id={oa.id} title={oa.title} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-round overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-bold leading-[1.3] text-ink">{oa.title}</h3>
              <StatusBadge tone={statusTone(oa.publish_status)}>{STATUS_LABEL[oa.publish_status] ?? oa.publish_status}</StatusBadge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-3">
              {hasRole && <RoleBadge role={oa.my_role as Role} />}
              {showUsageType && <UsageTypePill usageType={oa.usage_type} />}
              {oa.line_oa_id && <span className="font-mono text-ink-3">@{oa.line_oa_id}</span>}
            </div>
          </div>
        </button>

        {/* プレイヤー数（既存データ） */}
        <div className="hidden w-[84px] flex-shrink-0 text-right md:block">
          <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-3">プレイヤー</div>
          <div className={"font-num text-[15px] font-extrabold " + (players > 0 ? "text-sky-ink" : "text-ink-3")}>{players.toLocaleString()}</div>
        </div>
        {/* 最新の作品 */}
        <div className="hidden w-[220px] flex-shrink-0 lg:block">
          <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-3">最新の作品</div>
          {latestWork ? (
            <div className="flex items-center gap-1.5">
              <Link href={`/oas/${oa.id}/works/${latestWork.id}`} onClick={(e) => e.stopPropagation()} className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-brand-ink hover:underline">{latestWork.title}</Link>
              {ws.length > 1 && <span className="flex-shrink-0 rounded-full bg-line-2 px-1.5 py-0.5 text-[10px] text-ink-2">他{ws.length - 1}件</span>}
            </div>
          ) : (
            <div className="text-[12px] text-ink-3">—</div>
          )}
        </div>
        {/* 最終更新 */}
        <div className="hidden w-[92px] flex-shrink-0 text-right sm:block">
          <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-3">最終更新</div>
          <div className="font-num text-[12px] text-ink-2">{formatDateTime(oa.latest_activity_at ?? oa.updated_at ?? oa.created_at)}</div>
        </div>

        {/* アクション（行トグルを阻止） */}
        <div className="flex flex-shrink-0 items-center gap-2">
          <Link href={`/oas/${oa.id}/works`} onClick={(e) => e.stopPropagation()} className={buttonClass({ variant: "primary", size: "sm" })}>作品管理</Link>
          <Link href={`/oas/${oa.id}/settings`} onClick={(e) => e.stopPropagation()} className={buttonClass({ variant: "ghost", size: "sm" })}>設定</Link>
          <button
            type="button"
            aria-label={open ? "詳細を閉じる" : "詳細を開く"}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-white text-ink-2 transition-colors hover:border-brand hover:text-brand-ink"
          >
            <span aria-hidden="true" className="text-[11px]">{open ? "▲" : "▼"}</span>
          </button>
        </div>
      </div>

      {/* 詳細（展開時） */}
      {open && (
        <div id={panelId} className="flex flex-col gap-6 border-t border-line bg-bg-tint px-6 py-5 lg:flex-row">
          <div className="w-full lg:w-[340px] lg:flex-shrink-0">
            <DefRow label="アカウントID"><span className="break-all font-mono text-ink-2">{oa.id}</span></DefRow>
            {oa.channel_id && <DefRow label="Channel ID"><span className="font-mono">{oa.channel_id}</span></DefRow>}
            {oa.line_oa_id && <DefRow label="LINE ID"><span className="font-mono">@{oa.line_oa_id}</span></DefRow>}
            {showUsageType && <DefRow label="利用区分">{usageTypeShortLabel(oa.usage_type)}</DefRow>}
            <DefRow label="作成日時"><span className="font-num">{formatDateTime(oa.created_at)}</span></DefRow>
            <DefRow label="最終更新"><span className="font-num">{formatDateTime(oa.latest_activity_at ?? oa.updated_at ?? oa.created_at)}</span></DefRow>
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 text-[12px] font-bold text-ink">作品{oa.has_workspace_access ? `（${ws.length}件）` : ""}</div>
            <WorksList oaId={oa.id} hasAccess={oa.has_workspace_access} worksMap={worksMap} worksLoading={worksLoading} />
            {isOwner && (
              <div className="mt-4 text-right">
                <button type="button" onClick={() => onDelete(oa.id, oa.title)} className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-danger transition-colors hover:bg-danger-soft">
                  このアカウントを削除
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/* ── アカウントリスト本体 ────────────────────────────────────────────────── */
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

  const previewArgs = { isPlatformOwner, previewViewRole };
  const previewingNonOwner = isPreviewingOasView(previewArgs);
  const actAsOwner = canCreateOaInView(previewArgs);
  const ownerOrAboveView = viewingAsOwnerOrAbove(previewArgs);
  const canCreateOa = canCreateOaInView(previewArgs);

  async function load(p: number) {
    setLoading(true);
    setWorksLoading(true);
    setError(null);
    try {
      const result = await oaApi.list(getDevToken(), { page: p, limit: 20 });
      setItems(result.data);
      setMeta(result.meta);
      setLoading(false);

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

  function oaSortFn(a: OaListItem, b: OaListItem): number {
    const byUpdated = compareByLatestActivity(a, b, "desc");
    const tieId = () => a.id.localeCompare(b.id);
    const withTie = (cmp: number) => (cmp !== 0 ? cmp : byUpdated !== 0 ? byUpdated : tieId());
    switch (sortKey) {
      case "updated_at_desc": return byUpdated !== 0 ? byUpdated : tieId();
      case "title_asc":       return withTie(a.title.localeCompare(b.title, "ja"));
      case "works_desc":      return withTie((b._count?.works ?? 0) - (a._count?.works ?? 0));
      case "players_desc":    return withTie(totalPlayers(b.id) - totalPlayers(a.id));
      case "display_order": {
        const cmp = compareByCreated(a, b, "asc");
        return cmp !== 0 ? cmp : tieId();
      }
      default: return byUpdated !== 0 ? byUpdated : tieId();
    }
  }
  const sortedItems = [...items].sort(oaSortFn);

  // 件数分岐は取得したアカウント配列（＋ meta.total）から導出。1件判定は #581 の isSingleAccountView を使用。
  const count = meta?.total ?? items.length;
  const isSingle = !loading && !error && isSingleAccountView(items.length, meta?.total);

  // 権限に応じた表示（現行判定を踏襲）。
  const rolePerms = (oa: OaListItem) => ({
    isOwner: oa.my_role === "owner" && actAsOwner,
    showUsageType: ownerOrAboveView || (!isPlatformOwner && oa.my_role === "owner"),
  });

  return (
    <>
      {/* 表示確認モード (= platform owner 限定 / UI 表示専用) */}
      <OasViewPreviewBar isPlatformOwner={isPlatformOwner} previewViewRole={previewViewRole} onChange={setPreviewViewRole} />

      {/* ── タイトル行: アカウント + 件数バッジ + 追加ボタン ── */}
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-round text-[20px] font-bold tracking-[-0.01em] text-ink">アカウント</h2>
        {!loading && !error && (
          <span className="inline-flex min-w-[24px] items-center justify-center rounded-full border border-line bg-surface px-2.5 py-0.5 text-[12px] font-bold text-ink-2">{count}</span>
        )}
        <div className="ml-auto">
          {canCreateOa && (
            <Link href="/oas/new" className={buttonClass({ variant: "primary", size: "md" })}>＋ アカウントを追加</Link>
          )}
        </div>
      </div>

      {/* ── お知らせ（共有コンポーネント・機能/リンク不変） ── */}
      <div className="mb-4">
        <AnnouncementBanner canPost={actAsOwner} />
      </div>

      {/* ── エラー ── */}
      {error && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-card border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] leading-[1.6] text-danger">
          <span>{error}</span>
          <button type="button" onClick={() => load(page)} className="underline hover:no-underline">再読み込み</button>
        </div>
      )}

      {/* ── 本体: 0件 / 1件（#581 ダッシュボード） / 複数件 ── */}
      {items.length === 0 && !loading ? (
        // 0件（空状態）— 現行の canCreateOa 分岐・説明を維持
        <div className="rounded-card border border-line bg-surface px-6 py-14 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-[72px] w-[72px] items-center justify-center rounded-[20px] bg-brand-soft">
            <div className="h-6 w-6 rounded-md border-2 border-dashed border-brand/50" />
          </div>
          {canCreateOa ? (
            <>
              <p className="text-[18px] font-bold text-ink">まだアカウントがありません</p>
              <p className="mx-auto mt-2 max-w-[440px] text-[13px] leading-[1.8] text-ink-2">
                まずLINE公式アカウントを登録してください。登録後、アカウントに紐づく作品を追加できます。
              </p>
              <Link href="/oas/new" className={buttonClass({ variant: "primary", size: "md", className: "mt-4" })}>＋ アカウントを追加</Link>
            </>
          ) : (
            <>
              <p className="text-[18px] font-bold text-ink">アカウント審査中です</p>
              <p className="mx-auto mt-2 max-w-[440px] text-[13px] leading-[1.8] text-ink-2">
                Whale Studio の利用には、管理者によるLINE公式アカウント連携の承認が必要です。承認されると、この画面にアカウント一覧が表示されます。
              </p>
              <p className="mx-auto mt-3 max-w-[440px] text-[12px] leading-[1.6] text-ink-3">お急ぎの場合は管理者にお問い合わせください。</p>
            </>
          )}
        </div>
      ) : loading ? (
        <SkeletonList />
      ) : isSingle ? (
        // 1件（ダッシュボード）— #581 の機能（KPI/直近7日/作品/アクティビティ・集約API）をそのまま利用。
        (() => { const oa = items[0]; const p = rolePerms(oa); return (
          <SingleOaDashboard oa={oa} canCreateOa={canCreateOa} isOwner={p.isOwner} showUsageType={p.showUsageType} onDelete={handleDelete} />
        ); })()
      ) : (
        // 複数件（リスト型カード＋アコーディオン詳細）
        <>
          {/* 並び替え（2件以上） */}
          <div className="mb-3 flex items-center justify-end gap-1.5">
            <label htmlFor="oas-sort-select" className="select-none whitespace-nowrap text-[11px] text-ink-3">並び替え:</label>
            <select id="oas-sort-select" value={sortKey} onChange={(e) => setSortKey(e.target.value as OaSortKey)} className="cursor-pointer rounded-field border border-line bg-surface px-2.5 py-1 text-[12px] text-ink sm:max-w-[200px]">
              {OA_SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-2.5">
            {sortedItems.map((oa) => {
              const p = rolePerms(oa);
              return (
                <AccountListItem key={oa.id} oa={oa} players={totalPlayers(oa.id)} isOwner={p.isOwner} showUsageType={p.showUsageType} worksMap={worksMap} worksLoading={worksLoading} onDelete={handleDelete} />
              );
            })}
          </div>

          {/* アカウント追加プロンプト（作成可能なときのみ・href は現行 /oas/new） */}
          {canCreateOa && (
            <Link href="/oas/new" className="mt-3 flex flex-col items-center gap-1.5 rounded-card border-2 border-dashed border-line bg-surface px-6 py-6 text-center no-underline transition-colors hover:border-brand/50 hover:bg-brand-mist">
              <span className="text-[14px] font-bold text-ink">アカウントを追加</span>
              <span className="text-[12px] text-ink-3">新しいLINE公式アカウントを登録して作品を管理できます</span>
              <span className={buttonClass({ variant: "primary", size: "sm", className: "mt-1" })}>＋ アカウントを追加</span>
            </Link>
          )}

          {/* ページネーション */}
          {meta && meta.pages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← 前へ</Button>
              <span className="px-1 text-[12px] text-ink-3">{page} / {meta.pages} ページ（計 {meta.total} 件）</span>
              <Button type="button" variant="ghost" size="sm" disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)}>次へ →</Button>
            </div>
          )}
        </>
      )}

      {/* 表示確認中バナー (= owner 以外の視点を確認中) */}
      {previewingNonOwner && (
        <div role="status" className="mt-4 flex items-center gap-3 rounded-field border border-warn/30 bg-warn-soft px-4 py-2.5 text-[13px] text-warn">
          <span aria-hidden="true" className="flex-shrink-0 text-[16px]">👁</span>
          <span className="flex-1">
            <strong>{previewViewRole ? OAS_VIEW_ROLE_LABELS[previewViewRole] : "一般ユーザー"}の表示を確認中</strong>
            {" "}— この視点からの見え方を表示しています（表示のみ・権限は変わりません）。
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPreviewViewRole(null)} className="whitespace-nowrap">オーナー表示に戻す</Button>
        </div>
      )}
    </>
  );
}
