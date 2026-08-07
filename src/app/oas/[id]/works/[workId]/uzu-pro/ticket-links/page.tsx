// src/app/oas/[id]/works/[workId]/uzu-pro/ticket-links/page.tsx
// for ウズプロ ＞ チケット連携（Server Component / **read-only**）。
//
//   - LIFF からプレイヤーが登録した TicketLink の実データを運営が確認する画面。
//     LIFF 管理タブの「チケット連携」は設定編集であり別責務（そちらは触らない）。
//   - 認可は layout.tsx で強制済みだが、多層防御でここでも canAccessUzuPro を再確認。
//     さらに work が対象 OA に属することを findFirst で検証（URL の workId 差し替え対策）。
//   - 書き込みは「連携を解除」（PR-B）と「内容を修正」（PR-C）のみ。
//     承認 / LINKED への任意変更は持たない。「UZU Pro 照合待ち」の解除は
//     CMS の pull → sync-result が担う既存設計のまま。
//     修正は既存行を上書きせず replacement（旧 REVOKED + 新規 PENDING）で表現する。
//   - 予約番号はこの画面でのみフル表示する（ESCAPE.ID / UZU Pro CMS / Whale Studio の照合キー）。
//     プレイヤー向け API は従来どおりマスクのまま。LINE UID / 内部主キーは表示しない。

import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getServerUser } from "@/lib/supabase/server";
import { canAccessUzuPro } from "@/lib/uzupro";
import {
  getTicketLinkAdminView,
  parseTicketLinkFilters,
  TICKET_LINK_STATUS_LABEL,
} from "@/lib/uzupro/ticket-link-view";
import { enabledTicketTypes, readTicketLinkSettings } from "@/lib/ticket-link/settings";
import { Breadcrumb } from "@/components/Breadcrumb";
import { TicketLinkFilters } from "./_filters";
import { TicketLinkTable } from "./_table";

export const dynamic = "force-dynamic";

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface px-4 py-4 shadow-sm">
      <div className="text-[11px] font-bold text-ink-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={"font-num text-[22px] font-bold " + (accent ? "text-brand-ink" : "text-ink")}>{value}</span>
        <span className="text-[12px] text-ink-3">件</span>
      </div>
    </div>
  );
}

/** ページ送りリンク（フィルタ条件を保ったまま page だけ差し替える）。 */
function pageHref(base: string, sp: Record<string, string | string[] | undefined>, page: number): string {
  const p = new URLSearchParams();
  for (const k of ["status", "rn", "cn", "tt"]) {
    const v = sp[k];
    const one = Array.isArray(v) ? v[0] : v;
    if (one) p.set(k, one);
  }
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

export default async function UzuProTicketLinksPage({
  params,
  searchParams,
}: {
  params: { id: string; workId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const user = await getServerUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/oas/${params.id}/works/${params.workId}/uzu-pro/ticket-links`)}`);
  }
  // 多層防御: layout で強制済みだが Server 側でも再確認（存在露出しないため 404）。
  if (!(await canAccessUzuPro(params.id, user.id, params.workId))) notFound();

  // スコープ検証: work が対象 OA に属することを確認（URL の workId 差し替え対策）。
  const work = await prisma.work.findFirst({
    where: { id: params.workId, oaId: params.id },
    select: { title: true, liffHomeSettingsJson: true },
  });
  if (!work) notFound();

  // 「内容を修正」の参加人数は作品設定を唯一の正とする（クライアントに人数を決めさせない）。
  // 無効化済みの種別は選択肢に出さない（既存 resolveTicketTypeByKey と同じ fail closed）。
  const ticketTypes = enabledTicketTypes(readTicketLinkSettings(work.liffHomeSettingsJson));

  const sp = searchParams ?? {};
  const filters = parseTicketLinkFilters(sp);
  const view = await getTicketLinkAdminView({ oaId: params.id, workId: params.workId, filters });

  const base = `/oas/${params.id}/works/${params.workId}/uzu-pro/ticket-links`;
  const totalAll = Object.values(view.statusCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="min-w-0 flex-1" style={{ maxWidth: 1200 }}>
      <Breadcrumb
        items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "作品リスト", href: `/oas/${params.id}/works` },
          { label: work.title, href: `/oas/${params.id}/works/${params.workId}` },
          { label: "チケット連携" },
        ]}
      />

      <div className="mb-4 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-round text-[20px] font-bold text-ink">チケット連携</h1>
        <span className="inline-flex items-center rounded-full bg-brand-soft px-2.5 py-0.5 text-[12px] font-bold text-brand-ink">
          for ウズプロ
        </span>

      </div>

      <p className="mb-4 text-[12px] leading-[1.8] text-ink-3">
        LINE からプレイヤーが登録したチケット連携の一覧です。予約番号は照合のためフル表示しています
        （プレイヤー画面ではマスク表示のままです）。
        <br />
        状態の更新は UZU Pro CMS 側の予約照合（連携取得 → 照合 → 結果反映）で行われます。この画面では連携の解除と内容の修正のみ行えます。
        <br />
        内容を修正すると、現在の連携を無効にして修正内容で新しい連携を作成します（変更前の内容は履歴として残ります）。
      </p>

      {/* 状態別サマリ（フィルタ非適用の全件） */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard label="全件" value={String(totalAll)} accent />
        <SummaryCard label={TICKET_LINK_STATUS_LABEL.PENDING_UZU_BOOKING} value={String(view.statusCounts.PENDING_UZU_BOOKING)} />
        <SummaryCard label={TICKET_LINK_STATUS_LABEL.LINKED} value={String(view.statusCounts.LINKED)} />
        <SummaryCard label={TICKET_LINK_STATUS_LABEL.CONFLICT} value={String(view.statusCounts.CONFLICT)} />
        <SummaryCard label={TICKET_LINK_STATUS_LABEL.REVOKED} value={String(view.statusCounts.REVOKED)} />
      </div>

      <div className="mb-3">
        <TicketLinkFilters
          oaId={params.id}
          workId={params.workId}
          filters={filters}
          statusCounts={view.statusCounts}
        />
      </div>

      <TicketLinkTable rows={view.rows} oaId={params.id} workId={params.workId} ticketTypes={ticketTypes} />

      {/* ページネーション（既存 /oas 一覧と同じ表現） */}
      {view.pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <a
            href={pageHref(base, sp, view.page - 1)}
            aria-disabled={view.page <= 1}
            className={
              "rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold " +
              (view.page <= 1 ? "pointer-events-none text-ink-3 opacity-50" : "text-ink-2 hover:text-ink")
            }
          >
            ← 前へ
          </a>
          <span className="px-1 text-[12px] text-ink-3">
            {view.page} / {view.pages} ページ（計 {view.total} 件）
          </span>
          <a
            href={pageHref(base, sp, view.page + 1)}
            aria-disabled={view.page >= view.pages}
            className={
              "rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold " +
              (view.page >= view.pages ? "pointer-events-none text-ink-3 opacity-50" : "text-ink-2 hover:text-ink")
            }
          >
            次へ →
          </a>
        </div>
      )}
    </div>
  );
}
