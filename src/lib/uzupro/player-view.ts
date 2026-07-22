// src/lib/uzupro/player-view.ts
// for ウズプロ ＞ プレイヤー画面の集約サービス（サーバー専用・PII フリー）。
//
// 重要（spec §4/§11）: 氏名/メール/電話/住所/備考/LINE UID 生値は **一切 select しない / 返さない**。
//   - lineUserId は「連携済みか（boolean）」の導出にのみ使い、値そのものは View Model に載せない。
//   - View Model のキーにも個人情報を示す語（name/email/phone/purchaser 等）を使わない
//     （公演回の表示名は `sessionTitle` として保持する）。
//
// 構成:
//   - 予約(UzuProBooking) を oaId+workId でスコープ取得し、プレイヤー(+liffLinks) を含めて集約。
//   - プレイヤーごとに LIFF 状態（liffLinks から導出）と LINE 連携（lineUserId != null）を導出。
//   - サマリー（active プレイヤー基準）・予約グルーピング・一括発行の対象/除外件数を組み立てる。
//   - フィルタ（すべて任意）は取得後に純粋関数で適用（テスト可能・prisma 方言に依存しない）。

import { prisma } from "@/lib/prisma";
import { maskLineUserId } from "@/lib/mask";

/** LIFF 状態（liffLinks から導出した表示値）。 */
export type UzuProLiffState = "linked" | "issued" | "revoked" | "error" | "unissued";

/** 予約状態（UzuProBookingStatus と同じ値空間）。 */
export type UzuProBookingState = "confirmed" | "waitlist" | "cancelled" | "attended";

/** プレイヤー画面のフィルタ（すべて任意）。 */
export interface UzuProPlayerViewFilters {
  /** externalBookingId の部分一致（大文字小文字を無視）。 */
  bookingId?: string | null;
  /** liveSessionId 完全一致 または 公演回の表示名一致。 */
  session?: string | null;
  liffStatus?: UzuProLiffState | null;
  bookingStatus?: UzuProBookingState | null;
  /** true=連携済みのみ / false=未連携のみ / null=すべて。 */
  lineLinked?: boolean | null;
}

/** プレイヤー行（表描画用・生 DB モデルは含めない）。 */
export interface UzuProPlayerRow {
  id: string;
  playerIndex: number;
  playerStatus: "active" | "cancelled";
  liffStatus: UzuProLiffState;
  lineLinked: boolean;
  /** LINE UID のマスク表示（例 "U1234••••••••ABCD"）。未連携は null。生値は載せない。 */
  lineLinkedMaskedId: string | null;
  /** LINE 連携元（LIFF 自動 / 手動登録）。未連携は null。UI バッジ用。 */
  lineLinkSource: "LIFF" | "MANUAL" | null;
  /** LINE 連携日時（ISO / UTC）。未連携は null。表示は JST。 */
  linkedAt: Date | string | null;
  bookingStatus: string;
  /** 予約の同期日時（ISO / UTC）。表示は JST。 */
  lastSyncedAt: string | null;
}

/** 予約単位のグループ（アコーディオン見出し + プレイヤー行）。 */
export interface UzuProBookingGroup {
  externalBookingId: string;
  /** 公演回の表示名（個人情報ではない）。 */
  sessionTitle: string | null;
  /** 公演日時（ISO / UTC）。 */
  startsAt: string | null;
  participantCount: number;
  bookingStatus: string;
  players: UzuProPlayerRow[];
}

/** 上部サマリー（active プレイヤー基準）。 */
export interface UzuProPlayerSummary {
  total: number;
  liffIssued: number;
  liffUnissued: number;
  lineLinked: number;
  syncError: number;
}

/** 一括発行の対象/除外件数（作品全体・フィルタ非依存）。 */
export interface UzuProBulkTargets {
  target: number;
  excludedCancelled: number;
  excludedIssued: number;
}

/** プレイヤー画面の View Model（Client へはこの形のみ渡す）。 */
export interface UzuProPlayerView {
  summary: UzuProPlayerSummary;
  bookings: UzuProBookingGroup[];
  /** 公演回フィルタの選択肢（作品全体から・安定順）。 */
  sessions: { id: string; title: string | null }[];
  bulk: UzuProBulkTargets;
  /** 作品全体の最終同期日時（ISO / UTC）。 */
  lastSyncedAt: string | null;
  /** 粗い同期ステータス（同期エラーが 1 件でもあれば error）。 */
  syncStatus: "ok" | "error";
}

const LIFF_STATES: readonly UzuProLiffState[] = ["linked", "issued", "revoked", "error", "unissued"];
const BOOKING_STATES: readonly UzuProBookingState[] = ["confirmed", "waitlist", "cancelled", "attended"];

const EMPTY_SUMMARY: UzuProPlayerSummary = {
  total: 0, liffIssued: 0, liffUnissued: 0, lineLinked: 0, syncError: 0,
};

function ts(v: Date | string | null | undefined): number {
  if (!v) return 0;
  const t = (typeof v === "string" ? new Date(v) : v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * liffLinks から表示用 LIFF 状態を導出する（spec の優先順位）:
 *   linked が 1 つでも → "linked"（LINE 連携済み）
 *   else issued が 1 つでも → "issued"（発行済み）
 *   else 最新リンクが revoked → "revoked"（失効） / error → "error"
 *   else → "unissued"（未発行）
 */
export function deriveLiffState(
  links: { status: string; issuedAt: Date | string | null }[],
): UzuProLiffState {
  if (links.length === 0) return "unissued";
  if (links.some((l) => l.status === "linked")) return "linked";
  if (links.some((l) => l.status === "issued")) return "issued";
  const latest = [...links].sort((a, b) => ts(b.issuedAt) - ts(a.issuedAt))[0];
  if (latest.status === "revoked") return "revoked";
  if (latest.status === "error") return "error";
  return "unissued";
}

type RawLink = { status: string; issuedAt: Date | string | null };
type RawPlayer = {
  id: string;
  playerIndex: number;
  status: string;
  lineUserId: string | null;
  lineLinkSource: "LIFF" | "MANUAL" | null;
  linkedAt: Date | string | null;
  liffLinks: RawLink[];
};
type RawBooking = {
  externalBookingId: string;
  participantCount: number;
  status: string;
  syncedAt: Date | string | null;
  liveSessionId: string;
  liveSession: { name: string | null; startsAt: Date | string | null } | null;
  players: RawPlayer[];
};

function passesBookingFilters(b: RawBooking, f: UzuProPlayerViewFilters): boolean {
  if (f.bookingId) {
    if (!b.externalBookingId.toLowerCase().includes(f.bookingId.toLowerCase())) return false;
  }
  if (f.session) {
    const byId = b.liveSessionId === f.session;
    const byName = (b.liveSession?.name ?? "") === f.session;
    if (!byId && !byName) return false;
  }
  if (f.bookingStatus && b.status !== f.bookingStatus) return false;
  return true;
}

function passesPlayerFilters(r: UzuProPlayerRow, f: UzuProPlayerViewFilters): boolean {
  if (f.liffStatus && r.liffStatus !== f.liffStatus) return false;
  if (f.lineLinked != null && r.lineLinked !== f.lineLinked) return false;
  return true;
}

/**
 * searchParams → フィルタ。想定外の値は無視（null 扱い）。
 * query キー: booking / session / liff / bstatus / line。
 */
export function parsePlayerFilters(
  sp: Record<string, string | string[] | undefined>,
): UzuProPlayerViewFilters {
  const one = (k: string): string | undefined => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const liff = one("liff");
  const bstatus = one("bstatus");
  const line = one("line");
  return {
    bookingId: (one("booking") ?? "").trim() || null,
    session: (one("session") ?? "").trim() || null,
    liffStatus: LIFF_STATES.includes(liff as UzuProLiffState) ? (liff as UzuProLiffState) : null,
    bookingStatus: BOOKING_STATES.includes(bstatus as UzuProBookingState)
      ? (bstatus as UzuProBookingState)
      : null,
    lineLinked: line === "linked" ? true : line === "unlinked" ? false : null,
  };
}

/**
 * プレイヤー画面の View Model を組み立てる。oaId+workId でスコープし、PII を含めない。
 */
export async function getUzuProPlayerView({
  oaId,
  workId,
  filters = {},
}: {
  oaId: string;
  workId: string;
  filters?: UzuProPlayerViewFilters;
}): Promise<UzuProPlayerView> {
  const bookings = (await prisma.uzuProBooking.findMany({
    where: { oaId, workId },
    orderBy: [{ liveSession: { startsAt: "asc" } }, { externalBookingId: "asc" }],
    select: {
      externalBookingId: true,
      participantCount: true,
      status: true,
      syncedAt: true,
      liveSessionId: true,
      liveSession: { select: { name: true, startsAt: true } },
      players: {
        orderBy: { playerIndex: "asc" },
        select: {
          id: true,
          playerIndex: true,
          status: true,
          lineUserId: true,
          lineLinkSource: true,
          linkedAt: true,
          liffLinks: { select: { status: true, issuedAt: true } },
        },
      },
    },
  })) as RawBooking[];

  // 公演回フィルタの選択肢（作品全体・安定順）。
  const sessionsMap = new Map<string, string | null>();
  // 一括発行の対象/除外（作品全体・フィルタ非依存）。
  const bulk: UzuProBulkTargets = { target: 0, excludedCancelled: 0, excludedIssued: 0 };
  let lastSyncedAtMs = 0;

  for (const b of bookings) {
    if (b.liveSessionId) sessionsMap.set(b.liveSessionId, b.liveSession?.name ?? null);
    lastSyncedAtMs = Math.max(lastSyncedAtMs, ts(b.syncedAt));
    for (const p of b.players) {
      if (p.status === "cancelled") {
        bulk.excludedCancelled += 1;
        continue;
      }
      if (p.liffLinks.some((l) => l.status === "issued")) bulk.excludedIssued += 1;
      else bulk.target += 1;
    }
  }

  const bookingLevel = bookings.filter((b) => passesBookingFilters(b, filters));

  // サマリー（予約レベルフィルタを通過した active プレイヤー基準）。
  const summary: UzuProPlayerSummary = { ...EMPTY_SUMMARY };
  for (const b of bookingLevel) {
    for (const p of b.players) {
      if (p.status !== "active") continue;
      const st = deriveLiffState(p.liffLinks);
      summary.total += 1;
      if (st === "issued" || st === "linked") summary.liffIssued += 1;
      if (st === "unissued") summary.liffUnissued += 1;
      if (st === "error") summary.syncError += 1;
      if (p.lineUserId != null) summary.lineLinked += 1;
    }
  }

  // 予約グルーピング（プレイヤーレベルフィルタを適用・0 件グループは落とす）。
  const groups: UzuProBookingGroup[] = [];
  for (const b of bookingLevel) {
    const rows: UzuProPlayerRow[] = b.players
      .map((p) => ({
        id: p.id,
        playerIndex: p.playerIndex,
        playerStatus: p.status === "cancelled" ? ("cancelled" as const) : ("active" as const),
        liffStatus: deriveLiffState(p.liffLinks),
        lineLinked: p.lineUserId != null,
        lineLinkedMaskedId: p.lineUserId ? maskLineUserId(p.lineUserId) : null,
        lineLinkSource: p.lineUserId != null ? p.lineLinkSource ?? null : null,
        linkedAt: p.lineUserId != null ? toIso(p.linkedAt) : null,
        bookingStatus: b.status,
        lastSyncedAt: toIso(b.syncedAt),
      }))
      .filter((r) => passesPlayerFilters(r, filters));
    if (rows.length === 0) continue;
    groups.push({
      externalBookingId: b.externalBookingId,
      sessionTitle: b.liveSession?.name ?? null,
      startsAt: toIso(b.liveSession?.startsAt),
      participantCount: b.participantCount,
      bookingStatus: b.status,
      players: rows,
    });
  }

  return {
    summary,
    bookings: groups,
    sessions: [...sessionsMap.entries()].map(([id, title]) => ({ id, title })),
    bulk,
    lastSyncedAt: lastSyncedAtMs > 0 ? new Date(lastSyncedAtMs).toISOString() : null,
    syncStatus: summary.syncError > 0 ? "error" : "ok",
  };
}
