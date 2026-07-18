// src/lib/live-sync.ts
//
// Runtime → Live 同期（PR2b-1）。LINE ランタイム（webhook / LIFF checkin）から、
// 現地公演運営の Live サブシステムへ「予約リンク」と「進行同期」を書き足す。
//
// 設計原則:
//   - **非破壊 / fire-and-forget**: 呼び出し側は `void syncFn(...).catch(() => {})` で使う。
//     ここでの失敗は絶対にメッセージ配信を壊さない（内部も try/catch で握りつぶす）。
//   - **非 Live OA では即 return**: isLiveEnabled(cached) で早期 return。大多数の OA はここで抜ける。
//   - **active な公演にだけ束ねる**: status="active" の LiveSession 配下のみ対象（PR2a lifecycle）。
//   - 予約番号/チケットID の照合は normalizeMatchKey で表記ゆれ吸収（PR2b）。
//
// 参照: [[project_mode-and-live-epic]]

import { prisma } from "@/lib/prisma";
import { activeCache, CACHE_KEY, TTL } from "@/lib/cache";
import { matchKeysEqual, normalizeMatchKey } from "@/lib/live-match-key";
import { upsertLiveTeamParticipant } from "@/lib/live-participant-link";

// OaEntitlement.featureKey（@/lib/live の LIVE_FEATURE_KEY と同値）。
// 注: @/lib/live は React の cache() をモジュールロード時に使うため webhook 経路（テスト環境）に
//     引き込めない。ここでは同等の enablement 判定を自己完結で行う（activeCache 経由で cache 互換）。
const LIVE_FEATURE_KEY = "whale_studio_live";

/**
 * OA で Whale Studio Live が有効か。@/lib/live.isLiveEnabled と同じ activeCache キー/TTL を使うため、
 * 管理画面側の判定・invalidation（invalidateLiveEnabledCache）とキャッシュ整合する。
 */
async function liveEnabled(oaId: string): Promise<boolean> {
  const key = CACHE_KEY.liveEnabled(oaId);
  const cached = await activeCache.get<boolean>(key);
  if (cached !== null) return cached;
  const ent = await prisma.oaEntitlement.findUnique({
    where:  { oaId_featureKey: { oaId, featureKey: LIVE_FEATURE_KEY } },
    select: { enabled: true },
  });
  const enabled = ent?.enabled === true;
  await activeCache.set(key, enabled, TTL.LIVE_ENABLED);
  return enabled;
}

/** (oaId, workId) の status="active" な LiveSession id 群。無ければ空配列。 */
async function activeSessionIdsForWork(oaId: string, workId: string): Promise<string[]> {
  const sessions = await prisma.liveSession.findMany({
    where:  { oaId, workId, status: "active" },
    select: { id: true },
  });
  return sessions.map((s) => s.id);
}

/**
 * (a) 予約リンク: プレイヤーが LINE の free_input で入力した値を、active 公演内の
 *     LiveTeam.reservationNumber（一致しなければ ticketId）と照合し、一致した Team に
 *     LINE userId を持つ LiveParticipant を紐づけ/作成 + LiveEventLog(checked_in) を記録する。
 *
 * どの free_input でも呼んでよい（予約番号でない入力は照合に失敗して no-op になる）。
 */
export async function linkReservationToLiveTeam(args: {
  oaId: string;
  lineUserId: string;
  workId: string;
  input: string;
}): Promise<void> {
  const { oaId, lineUserId, workId, input } = args;
  try {
    if (!lineUserId) return;
    if (normalizeMatchKey(input) === null) return;        // 実質空の入力は照合しない
    if (!(await liveEnabled(oaId))) return;             // 非 Live OA は即 return（cached）

    const sessionIds = await activeSessionIdsForWork(oaId, workId);
    if (sessionIds.length === 0) return;

    const teams = await prisma.liveTeam.findMany({
      where:  { liveSessionId: { in: sessionIds } },
      select: { id: true, liveSessionId: true, reservationNumber: true, ticketId: true },
    });
    if (teams.length === 0) return;

    // まず予約番号で照合 → 一致しなければ チケットID でフォールバック（ユーザー確定方針）。
    let via: "reservation" | "ticket" = "reservation";
    let team = teams.find((t) => matchKeysEqual(t.reservationNumber, input)) ?? null;
    if (!team) {
      team = teams.find((t) => matchKeysEqual(t.ticketId, input)) ?? null;
      via = "ticket";
    }
    if (!team) return; // どの予約/チケットにも一致しない（別の入力）= 何もしない

    const now = new Date();

    // find-or-create は共通コア（upsertLiveTeamParticipant）へ集約。
    // displayName を渡さない = 従来の webhook 自己申告照合と完全に同挙動（回帰なし）。
    // Phase 2 のチケットリンク連携（team 直指定・定員つき）も同じコアを使う。
    const { participantId } = await upsertLiveTeamParticipant(prisma, {
      oaId,
      liveSessionId: team.liveSessionId,
      teamId:        team.id,
      lineUserId,
      now,
    });

    await prisma.liveEventLog.create({
      data: {
        oaId,
        liveSessionId: team.liveSessionId,
        participantId,
        type:          "checked_in",
        title:         via === "reservation" ? "予約番号でチェックイン" : "チケットIDでチェックイン",
        detail:        input,
        payload:       { via, matched_team_id: team.id },
      },
    });
  } catch {
    // 同期失敗は握りつぶす（配信を壊さない）。
  }
}

/**
 * (b) 進行同期: フェーズ遷移後に、リンク済み（lineUserId 一致・active 公演）の
 *     LiveParticipant の currentPhaseId / lastSeenAt / status を更新する。
 *     現在フェーズ名は participant→currentPhase relation で解決されるため保存不要。
 *
 *   status ルール:
 *     - ending 到達 → completed
 *     - それ以外 → waiting/stuck だった participant を active に昇格（active/completed/dropped は据え置き）
 */
export async function syncLiveParticipantProgress(args: {
  oaId: string;
  lineUserId: string | null | undefined;
  workId: string;
  currentPhaseId: string | null | undefined;
  isEnding: boolean;
}): Promise<void> {
  const { oaId, lineUserId, workId, currentPhaseId, isEnding } = args;
  try {
    if (!lineUserId) return;
    if (!(await liveEnabled(oaId))) return;

    const sessionIds = await activeSessionIdsForWork(oaId, workId);
    if (sessionIds.length === 0) return;

    const now = new Date();

    // 基本更新: currentPhaseId + lastSeenAt（dropped は触らない）。
    const base = await prisma.liveParticipant.updateMany({
      where: { liveSessionId: { in: sessionIds }, lineUserId, status: { not: "dropped" } },
      data:  {
        lastSeenAt: now,
        ...(currentPhaseId ? { currentPhaseId } : {}),
      },
    });
    if (base.count === 0) return; // 未リンク（この player はまだ Live に紐づいていない）

    if (isEnding) {
      await prisma.liveParticipant.updateMany({
        where: { liveSessionId: { in: sessionIds }, lineUserId, status: { not: "dropped" } },
        data:  { status: "completed" },
      });
    } else {
      // 進行した = 止まっていない → waiting/stuck を active へ（active/completed は据え置き）。
      await prisma.liveParticipant.updateMany({
        where: { liveSessionId: { in: sessionIds }, lineUserId, status: { in: ["waiting", "stuck"] } },
        data:  { status: "active" },
      });
    }
  } catch {
    // 同期失敗は握りつぶす（配信を壊さない）。
  }
}
