// src/lib/uzupro/ticket-link-status.ts
//
// チケット連携（管理画面）の status 定数とラベル。**純粋・DB 非依存**。
//
// Client Component（フィルタ UI）からも値として import するため、
// prisma を読み込む ticket-link-view.ts とは分離している
// （分離しないと Prisma が client bundle に入り `node:async_hooks` で build が落ちる）。
//
// 既存 enum をそのまま使う。新しい status は追加しない。

import type { TicketLinkStatus } from "@prisma/client";

export const TICKET_LINK_STATUSES = [
  "PENDING_UZU_BOOKING",
  "LINKED",
  "CONFLICT",
  "REVOKED",
] as const satisfies readonly TicketLinkStatus[];

/**
 * 管理画面の日本語ラベル。
 * プレイヤー向けの playerFacingStatusLabel（「運営確認待ち」等）とは文言を分ける
 * （運営には CMS 照合が主語であることが分かる表現にする）。
 */
export const TICKET_LINK_STATUS_LABEL: Record<TicketLinkStatus, string> = {
  PENDING_UZU_BOOKING: "UZU Pro 照合待ち",
  LINKED: "連携済み",
  CONFLICT: "要確認",
  REVOKED: "無効",
};

/** 一覧の 1 ページ件数。既存管理一覧（/oas）の 20 件に合わせる。 */
export const TICKET_LINK_PAGE_SIZE = 20;

export interface TicketLinkAdminFilters {
  /** null = すべて。 */
  status: TicketLinkStatus | null;
  /** 予約番号での検索語（生入力）。 */
  reservationNumber: string | null;
  /** コードネームでの検索語。 */
  codeName: string | null;
  /** チケット種別（表示名スナップショット）での検索語。 */
  ticketType: string | null;
  /** 1 始まり。 */
  page: number;
}

/** URL search params → フィルタ。未知の値は無視して既定へ倒す。 */
export function parseTicketLinkFilters(
  sp: Record<string, string | string[] | undefined>,
): TicketLinkAdminFilters {
  const one = (k: string): string | undefined => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const status = one("status");
  const pageRaw = Number.parseInt(one("page") ?? "1", 10);
  return {
    status: (TICKET_LINK_STATUSES as readonly string[]).includes(status ?? "")
      ? (status as TicketLinkStatus)
      : null,
    reservationNumber: (one("rn") ?? "").trim() || null,
    codeName: (one("cn") ?? "").trim() || null,
    ticketType: (one("tt") ?? "").trim() || null,
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
  };
}
