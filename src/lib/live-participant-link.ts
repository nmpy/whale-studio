// src/lib/live-participant-link.ts
//
// LiveParticipant への「連携（find-or-create）」共通コアと、チケットリンク（Phase 2）専用の
// **定員つき・行ロック付き** team 直指定連携。
//
// - `upsertLiveTeamParticipant(db, args)`:
//     既存 `linkReservationToLiveTeam()`（LINE Webhook 自己申告照合）と、Phase 2 のチケットリンク連携が
//     共有する find-or-create コア。`db` に `prisma` でも interactive `tx` でも渡せる。
//     Webhook 経路は displayName を渡さない → 従来と完全に同挙動（回帰なし）。
//
// - `linkLineUserToResolvedLiveTeam(args)`:
//     チケットリンク連携の中核。対象 LiveTeam 行を `SELECT ... FOR UPDATE` でロックしたトランザクション内で
//       (1) 同一 lineUserId の既連携確認（冪等） (2) 定員判定（新規のみ） (3) participant 作成
//       (4) トークン firstUsedAt/lastUsedAt 更新（新規作成時のみ） (5) checked_in event 記録（新規のみ）
//     を atomically に行う。「count してから create」だけの非原子な実装は禁止（最後の1枠の二重連携を防ぐ）。
//
// 参照: [[live-sync]]（webhook 経路の共有元）, live-ticket-link（照合ロジック）

import { Prisma, type LiveParticipantStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** find-or-create コアを prisma / tx どちらでも受けられるように最小の型で受ける。 */
type Db = Prisma.TransactionClient | typeof prisma;

/** groupType → 連携定員。"two"=2 / "four"=4 / それ以外・null は上限なし（null）。 */
export function teamCapacity(groupType: string | null | undefined): number | null {
  if (groupType === "two") return 2;
  if (groupType === "four") return 4;
  return null; // null / 未知値 = 上限なし
}

/**
 * (liveSessionId, lineUserId) の LiveParticipant を find-or-create する共通コア。
 *   - find: `findFirst({ liveSessionId, lineUserId })`
 *   - 既存: teamId / lastSeenAt を更新。dropped/completed は据え置き、それ以外は active に。
 *   - 新規: status="active" で作成。
 *   - displayName は指定時のみ書き込む（未指定なら従来挙動と完全一致 = webhook 回帰なし）。
 *
 * 呼び出し側で必要なら **事前に対象 team 行をロック**してから呼ぶこと（本関数自体はロックしない）。
 */
export async function upsertLiveTeamParticipant(
  db: Db,
  args: {
    oaId: string;
    liveSessionId: string;
    teamId: string;
    lineUserId: string;
    now: Date;
    displayName?: string | null;
    /** 呼び出し側で既に取得済みなら渡して二重 findFirst を避ける（同一 tx 内の最適化）。 */
    existing?: { id: string; status: LiveParticipantStatus } | null;
  },
): Promise<{ participantId: string; created: boolean; priorStatus: LiveParticipantStatus | null }> {
  const { oaId, liveSessionId, teamId, lineUserId, now, displayName } = args;

  const existing = args.existing !== undefined
    ? args.existing
    : await db.liveParticipant.findFirst({
        where:  { liveSessionId, lineUserId },
        select: { id: true, status: true },
      });

  if (existing) {
    await db.liveParticipant.update({
      where: { id: existing.id },
      data: {
        teamId,
        lastSeenAt: now,
        // dropped/completed は尊重。それ以外は active に。
        ...(existing.status === "dropped" || existing.status === "completed" ? {} : { status: "active" }),
        ...(displayName ? { displayName } : {}),
      },
    });
    return { participantId: existing.id, created: false, priorStatus: existing.status };
  }

  const created = await db.liveParticipant.create({
    data: {
      oaId,
      liveSessionId,
      teamId,
      lineUserId,
      status:     "active",
      lastSeenAt: now,
      ...(displayName ? { displayName } : {}),
    },
    select: { id: true },
  });
  return { participantId: created.id, created: true, priorStatus: null };
}

/**
 * 対象 team の「LINE 連携済み人数」= 同一 team・非 null lineUserId の **DISTINCT lineUserId** 数を数える。
 * active/completed/dropped をすべて含む。匿名(null)は数えない。別 team は数えない。
 * 重複 lineUserId は 1 人として数える。**ロック取得済みトランザクション内で呼ぶこと。**
 */
async function countDistinctLinkedUsers(db: Db, liveSessionId: string, teamId: string): Promise<number> {
  const rows = await db.liveParticipant.findMany({
    where:    { liveSessionId, teamId, lineUserId: { not: null } },
    select:   { lineUserId: true },
    distinct: ["lineUserId"],
  });
  return rows.length;
}

/** `linkLineUserToResolvedLiveTeam` の結果。 */
export type LinkResult =
  /** 連携済み（新規作成 or 既存冪等）。 */
  | { kind: "linked"; participantId: string; created: boolean }
  /** 定員到達で新規連携できず（token/participant/event は不変）。 */
  | { kind: "team_full" };

/**
 * 解決済みの (liveSessionId, teamId) に lineUserId を **定員つき・行ロック付き**で連携する。
 *
 * トランザクション内で:
 *   1. 対象 LiveTeam 行を `SELECT ... FOR UPDATE` でロック（同一 team への同時連携を直列化）
 *   2. 同一 lineUserId の既連携を確認（あれば定員判定をスキップして冪等連携）
 *   3. 新規 lineUserId のみ DISTINCT 人数で定員判定（到達なら team_full で中断・無変更）
 *   4. participant を find-or-create
 *   5. **新規作成時のみ** token.firstUsedAt(null時) / lastUsedAt を更新し、checked_in event を記録
 *
 * FOR UPDATE は PostgreSQL 前提（本番）。テストは prisma を mock するため raw SQL は実行されない。
 */
export async function linkLineUserToResolvedLiveTeam(args: {
  oaId: string;
  liveSessionId: string;
  teamId: string;
  groupType: string | null;
  lineUserId: string;
  displayName?: string | null;
  tokenId: string;
  /** eventLog / token 由来メタ用。"liff_ticket" 固定運用だが将来拡張のため引数化。 */
  via?: string;
  now?: Date;
}): Promise<LinkResult> {
  const {
    oaId, liveSessionId, teamId, groupType, lineUserId, displayName, tokenId,
    via = "liff_ticket",
  } = args;
  const now = args.now ?? new Date();
  const capacity = teamCapacity(groupType);

  return prisma.$transaction(async (tx) => {
    // (1) 対象 team 行をロック（存在しなければ 0 行 = 後続の find-or-create が実質 no-op ではなく作成に進むが、
    //     team は resolve 済みで存在が前提。ロックは同時実行の直列化が目的）。
    await tx.$queryRaw`SELECT id FROM live_teams WHERE id = ${teamId} FOR UPDATE`;

    // (2) 既連携確認（ロック内）。既存ユーザーは定員に関係なく冪等連携。
    const existing = await tx.liveParticipant.findFirst({
      where:  { liveSessionId, lineUserId },
      select: { id: true, status: true },
    });

    // (3) 新規ユーザーのみ定員判定。
    if (!existing && capacity !== null) {
      const linked = await countDistinctLinkedUsers(tx, liveSessionId, teamId);
      if (linked >= capacity) {
        return { kind: "team_full" as const };
      }
    }

    // (4) find-or-create（共通コア・既取得の existing を渡して二重 find を避ける）。
    const { participantId, created } = await upsertLiveTeamParticipant(tx, {
      oaId, liveSessionId, teamId, lineUserId, now, displayName, existing,
    });

    // (5) 実際に新規作成したときだけ token 日時更新 + checked_in event（冪等再実行では増やさない）。
    if (created) {
      // firstUsedAt は null のときだけ（初回のみ・競合安全）。
      await tx.liveTicketLinkToken.updateMany({
        where: { id: tokenId, firstUsedAt: null },
        data:  { firstUsedAt: now },
      });
      // lastUsedAt は新規連携ごとに更新。
      await tx.liveTicketLinkToken.updateMany({
        where: { id: tokenId },
        data:  { lastUsedAt: now },
      });
      await tx.liveEventLog.create({
        data: {
          oaId,
          liveSessionId,
          participantId,
          type:    "checked_in",
          title:   "LIFFチケットURLで連携",
          payload: { via, matched_team_id: teamId } as Prisma.InputJsonValue,
        },
      });
    }

    return { kind: "linked" as const, participantId, created };
  });
}
