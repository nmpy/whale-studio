// src/app/api/oas/[id]/dashboard/route.ts
// GET /api/oas/[id]/dashboard — アカウント（Oa）ダッシュボードの集約データ（read 専用）。
//
// アカウントが 1 件のときの専用ダッシュボード（KPI / 直近7日 / 作品 / アクティビティ）を
// 1 リクエストで返す。クライアントからの複数 API 逐次呼び出しを避けるための集約エンドポイント。
//
// スコープ / 認可:
//   - requireRole(oaId, user.id, "viewer") で当該アカウントの閲覧権限を検証（URL の id を鵜呑みにしない）。
//   - プレイヤー / 作品 / イベントはすべて Work.oaId もしくは直接 oaId で絞り込み、他アカウントの値を混入させない。
//   - プレビュー/テスト（isPreview=true）と AnalyticsExcludedUser（運営/テスター）は集計から除外。
//
// KPI 定義（すべて「重複しない distinct プレイヤー」基準・単位=人 / %）:
//   - 総プレイヤー  = distinct lineUserId（isPreview=false・除外ユーザーを除く）
//   - クリア済み    = 上記のうち reachedEnding=true を 1 つでも持つ distinct lineUserId
//   - クリア率      = クリア済み / 総プレイヤー（総プレイヤー 0 なら 0%）
//   - 今日の新規参加 = 初回参加（min createdAt）が JST 本日 00:00 以降の distinct プレイヤー（＝新規のみ。
//                     「今日アクティブ」ではない。単一の信頼できるアクティブ日時カラムが無いため新規で定義）
//   - 直近7日       = 初回参加日（JST）別の新規プレイヤー数（当日含む 7 日）
//
// アクティビティは「実際に永続化されているログ」のみを新しい順にマージして最大10件返す。
// 会話（送受信）/ フェーズ開始 / 友だち追加 / 回答判定 / 選択 / 通話リクエスト等は現状ログ保存が
// 無いためフィードには出ない（ダミーは出さない）。0 件のときはクライアントが空状態を表示する。
//
// DB schema / migration / webhook / runtime / 送信ロジックには一切触れない（read のみ）。

import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { fetchWorkLatestActivityMap, latestOf } from "@/lib/latest-activity";
import { countDailyNewPlayers } from "@/lib/analytics-range";
import {
  type ActivityItem,
  playerTag,
  liffEventToActivity,
  beaconEventToActivity,
  mergeAndTake,
} from "@/lib/activity-feed";

export const dynamic = "force-dynamic";

/** JST の本日 00:00 を表す UTC インスタント。 */
function jstStartOfToday(now: Date): Date {
  const jstDate = now.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }); // "YYYY-MM-DD"（JST）
  return new Date(`${jstDate}T00:00:00+09:00`);
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

const ACTIVITY_LIMIT = 10;
// 各ログソースからの候補取得件数の上限。最終表示は10件なので、除外ユーザー差し引き後の
// 目減りに少し余裕を持たせて 20 に固定（全履歴取得はしない）。最大候補 = 7ソース × 20 = 140 行。
const PER_SOURCE_TAKE = 20;

export const GET = withAuth<{ id: string }>(async (_req, ctx, user) => {
  try {
    const { id: oaId } = await ctx.params;

    const check = await requireRole(oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    const now = new Date();
    const jstToday = jstStartOfToday(now);

    // 対象アカウントの作品・モード・除外ユーザーを先に取得（以降のスコープ絞り込みに使う）。
    const [oa, works, excluded] = await Promise.all([
      safe(prisma.oa.findUnique({ where: { id: oaId }, select: { mode: true } }), null),
      safe(prisma.work.findMany({ where: { oaId }, select: { id: true, title: true, createdAt: true, updatedAt: true } }), [] as { id: string; title: string; createdAt: Date; updatedAt: Date }[]),
      safe(prisma.analyticsExcludedUser.findMany({ where: { oaId }, select: { lineUserId: true } }), [] as { lineUserId: string }[]),
    ]);

    const workIds = works.map((w) => w.id);
    const hasWorks = workIds.length > 0;
    const excludedIds = excluded.map((e) => e.lineUserId);
    const excludedSet = new Set(excludedIds);
    const isLive = oa?.mode === "live";

    // 作品の「最終更新」（配下 Phase/Message/Character/LIFF の最新編集を含む）。一覧カードと同基準。
    const latestMap = hasWorks ? await safe(fetchWorkLatestActivityMap(workIds), new Map<string, Date>()) : new Map<string, Date>();
    const worksOut = works
      .map((w) => {
        const latest = latestOf(latestMap.get(w.id), w.updatedAt, w.createdAt) ?? w.createdAt;
        return {
          id: w.id,
          title: w.title,
          created_at: w.createdAt.toISOString(),
          updated_at: w.updatedAt.toISOString(),
          latest_activity_at: latest.toISOString(),
        };
      })
      .sort((a, b) => Date.parse(b.latest_activity_at) - Date.parse(a.latest_activity_at) || a.id.localeCompare(b.id));

    // ── KPI（distinct プレイヤー基準）──
    const baseWhere = {
      workId: { in: workIds },
      isPreview: false,
      ...(excludedIds.length ? { lineUserId: { notIn: excludedIds } } : {}),
    };

    // 1 クエリで distinct プレイヤー + 初回参加時刻（min createdAt）→ 総数 / 今日の新規参加 / 7日を賄う。
    const players = hasWorks
      ? await safe(prisma.userProgress.groupBy({ by: ["lineUserId"], where: baseWhere, _min: { createdAt: true } }), [] as { lineUserId: string; _min: { createdAt: Date | null } }[])
      : [];
    // クリア済み distinct プレイヤー（reachedEnding を 1 つでも持つ）。
    const clearedPlayers = hasWorks
      ? await safe(prisma.userProgress.groupBy({ by: ["lineUserId"], where: { ...baseWhere, reachedEnding: true } }), [] as { lineUserId: string }[])
      : [];

    const firstCreatedAts = players.map((p) => p._min.createdAt).filter((d): d is Date => !!d);
    const totalPlayers = players.length;
    const cleared = clearedPlayers.length;
    // 「今日 初めて参加した」distinct プレイヤー数（＝新規参加）。「今日アクティブ」ではない点に注意。
    const todayNewPlayers = firstCreatedAts.filter((d) => d.getTime() >= jstToday.getTime()).length;
    const clearRatePct = totalPlayers > 0 ? Math.round((cleared / totalPlayers) * 100) : 0;
    const daily = countDailyNewPlayers(firstCreatedAts, now); // 日別 新規プレイヤー数 [{ date, label, count }] × 7

    // ── アクティビティ（実ログのみ・新しい順マージ → 最大10件）──
    const [liffRows, visitRows, hintRows, beaconRows, puzzleRows, submissionRows, liveRows] = await Promise.all([
      hasWorks ? safe(prisma.liffEventLog.findMany({ where: { workId: { in: workIds } }, orderBy: { createdAt: "desc" }, take: PER_SOURCE_TAKE, select: { id: true, createdAt: true, lineUserId: true, eventType: true } }), []) : Promise.resolve([]),
      hasWorks ? safe(prisma.locationVisit.findMany({ where: { workId: { in: workIds } }, orderBy: { visitedAt: "desc" }, take: PER_SOURCE_TAKE, select: { id: true, visitedAt: true, lineUserId: true, location: { select: { name: true } } } }), []) : Promise.resolve([]),
      safe(prisma.hintLog.findMany({ where: { oaId }, orderBy: { createdAt: "desc" }, take: PER_SOURCE_TAKE, select: { id: true, createdAt: true, lineUserId: true } }), []),
      safe(prisma.beaconEventLog.findMany({ where: { oaId }, orderBy: { createdAt: "desc" }, take: PER_SOURCE_TAKE, select: { id: true, createdAt: true, lineUserId: true, isRedelivery: true, actionStatus: true } }), []),
      hasWorks ? safe(prisma.puzzleDelivery.findMany({ where: { workId: { in: workIds } }, orderBy: { deliveredAt: "desc" }, take: PER_SOURCE_TAKE, select: { id: true, deliveredAt: true, lineUserId: true } }), []) : Promise.resolve([]),
      safe(prisma.liffSubmission.findMany({ where: { oaId }, orderBy: { createdAt: "desc" }, take: PER_SOURCE_TAKE, select: { id: true, createdAt: true, lineUserId: true } }), []),
      isLive ? safe(prisma.liveEventLog.findMany({ where: { oaId }, orderBy: { createdAt: "desc" }, take: PER_SOURCE_TAKE, select: { id: true, createdAt: true, participantId: true, type: true, title: true } }), []) : Promise.resolve([]),
    ]);

    const notExcluded = (uid: string | null | undefined) => !(uid && excludedSet.has(uid));
    const raw: ActivityItem[] = [];

    for (const r of liffRows) {
      if (!notExcluded(r.lineUserId)) continue;
      const m = liffEventToActivity(r.eventType);
      if (!m) continue;
      raw.push({ id: `liff:${r.id}`, at: r.createdAt.toISOString(), kind: m.kind, playerTag: playerTag(r.lineUserId, oaId), detail: m.detail });
    }
    for (const r of visitRows) {
      if (!notExcluded(r.lineUserId)) continue;
      raw.push({ id: `visit:${r.id}`, at: r.visitedAt.toISOString(), kind: "location", playerTag: playerTag(r.lineUserId, oaId), detail: `ロケーション「${r.location?.name ?? "現地"}」にチェックイン` });
    }
    for (const r of hintRows) {
      if (!notExcluded(r.lineUserId)) continue;
      raw.push({ id: `hint:${r.id}`, at: r.createdAt.toISOString(), kind: "hint", playerTag: playerTag(r.lineUserId, oaId), detail: "ヒントを表示" });
    }
    for (const r of beaconRows) {
      if (!notExcluded(r.lineUserId)) continue;
      const m = beaconEventToActivity({ isRedelivery: r.isRedelivery, actionStatus: r.actionStatus });
      raw.push({ id: `beacon:${r.id}`, at: r.createdAt.toISOString(), kind: m.kind, playerTag: playerTag(r.lineUserId, oaId), detail: m.detail });
    }
    for (const r of puzzleRows) {
      if (!notExcluded(r.lineUserId)) continue;
      raw.push({ id: `puzzle:${r.id}`, at: r.deliveredAt.toISOString(), kind: "receive", playerTag: playerTag(r.lineUserId, oaId), detail: "問題メッセージを配信" });
    }
    for (const r of submissionRows) {
      if (!notExcluded(r.lineUserId)) continue;
      raw.push({ id: `submit:${r.id}`, at: r.createdAt.toISOString(), kind: "answer", playerTag: playerTag(r.lineUserId, oaId), detail: "フォームを送信" });
    }
    for (const r of liveRows) {
      const map: Record<string, { kind: ActivityItem["kind"]; detail: string }> = {
        qr_scanned:      { kind: "location", detail: "QR を読み取り" },
        checked_in:      { kind: "location", detail: "チェックイン" },
        puzzle_solved:   { kind: "clear",    detail: "謎を解いた" },
        message_sent:    { kind: "send",     detail: "メッセージを送信" },
        actor_contacted: { kind: "call",     detail: "通話をリクエスト" },
        alert:           { kind: "error",    detail: "アラート" },
        staff_phase_move:{ kind: "start",    detail: "フェーズを移動" },
      };
      const m = map[r.type as string];
      if (!m) continue; // note_added 等はフィードに出さない
      raw.push({ id: `live:${r.id}`, at: r.createdAt.toISOString(), kind: m.kind, playerTag: playerTag(r.participantId, oaId), detail: r.title || m.detail });
    }

    const activity = mergeAndTake(raw, ACTIVITY_LIMIT);

    return ok({
      mode: oa?.mode ?? "content",
      kpis: {
        total_players: totalPlayers,
        today_new_players: todayNewPlayers,
        cleared,
        clear_rate_pct: clearRatePct,
      },
      daily,          // [{ date, label, count }] × 7（古い順・JST）
      works: worksOut,
      works_total: worksOut.length,
      activity,       // ActivityItem[]（新しい順・最大10）
    });
  } catch (err) {
    return serverError(err);
  }
});
