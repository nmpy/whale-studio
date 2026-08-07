// POST /api/external/v2/uzu-pro/ticket-links/sync-result
//   for ウズプロ: UZU Pro CMS の「Whale連携確認」の結果を Whale Studio へ書き戻す。
//
//   認証: write 用ガード requireExternalWriteApiKey（x-whale-api-key ↔ WHALE_EXTERNAL_WRITE_API_KEY）+
//         WHALE_EXTERNAL_OA_IDS allowlist。fail closed。
//
//   冪等性:
//     - 同一 Idempotency-Key の再送は再処理せず replay を返す（既存 bookings/sync と同じ reserve-first）。
//     - キー無しで再送された場合も、状態と uzuSyncedAt の設定は同じ値を書くだけなので二重反映にならない。
//     - ERROR は uzuSyncedAt を進めない（次回の差分取得で再試行できるようにする）。
//
//   並行更新:
//     - status の更新は compare-and-swap（読んだ status を where に入れる）。
//       運営の「チケット連携を解除」(REVOKED) と競合しても、解除済み連携を
//       LINKED / CONFLICT / PENDING_UZU_BOOKING へ復活させない。
//       REVOKED は terminal（canTransitionLink(REVOKED, *) === false）であり、
//       その既存規則を「読んだ後・update する前」に解除された場合にも成立させる。
//     - 競合を検知した場合の意味は「最初から REVOKED だった場合」と揃える
//       （status は no-op / uzuSyncedAt は進める / syncLog は残す / applied として数える）。
//       race 専用の新しいエラー仕様は作らない。
//
//   ESCAPE.ID 由来の個人情報（本名/購入者名/メール等）や OCR データは受け取らない。
//   strict schema で未知フィールドを 400 拒否する。

import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { Prisma } from "@prisma/client";
import type { TicketLinkStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { requireExternalWriteApiKey } from "@/lib/external-auth";
import { recordUzuProActivity } from "@/lib/uzupro/activity";
import { canTransitionLink } from "@/lib/ticket-link/rules";

export const dynamic = "force-dynamic";

const resultSchema = z
  .object({
    whaleTicketLinkId: z.string().min(1).max(100),
    result:            z.enum(["LINKED", "PENDING_BOOKING", "CONFLICT", "NO_CHANGE", "ERROR"]),
    /** 失敗理由コード（PII を含めない。自由記述は受け取らない）。 */
    errorCode:         z.string().min(1).max(100).optional(),
    /** CMS 側の作品/プロジェクト識別子（監査用）。 */
    uzuWorkId:         z.string().min(1).max(200).optional(),
  })
  .strict();

const bodySchema = z
  .object({
    workId:  z.string().min(1).max(100),
    results: z.array(resultSchema).min(1).max(500),
  })
  .strict();

/**
 * status CAS の試行上限。初回 + 最新 status での再判定 1 回のみ。
 * 並行更新が続く場合に無限ループしないよう明示的に有限にする（revoke 側と同方針）。
 */
const MAX_SYNC_CAS_ATTEMPTS = 2;

/** 同期結果 → 連携状態。NO_CHANGE / ERROR は状態を動かさない。 */
function targetStatusFor(result: string): TicketLinkStatus | null {
  switch (result) {
    case "LINKED":          return "LINKED";
    case "PENDING_BOOKING": return "PENDING_UZU_BOOKING";
    case "CONFLICT":        return "CONFLICT";
    default:                return null;
  }
}

export async function POST(req: NextRequest) {
  const auth = requireExternalWriteApiKey(req);
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  let idempotencyKey: string | null = null;

  try {
    const data = bodySchema.parse(await req.json());

    const work = await prisma.work.findUnique({
      where: { id: data.workId },
      select: { id: true, oaId: true },
    });
    if (!work) return notFound("作品");
    if (!scope.allowsOa(work.oaId)) return notFound("作品");

    // Idempotency-Key（任意）: reserve-first。同一キーの再送は再処理せず replay を返す。
    const rawIdemKey = req.headers.get("idempotency-key");
    idempotencyKey = rawIdemKey && rawIdemKey.trim().length > 0 ? rawIdemKey.trim() : null;
    const rawRequestId = req.headers.get("x-request-id");
    const requestId = rawRequestId && rawRequestId.trim().length > 0 ? rawRequestId.trim() : null;

    if (idempotencyKey) {
      try {
        await prisma.uzuProSyncRequest.create({
          data: {
            idempotencyKey,
            requestId,
            oaId:   work.oaId,
            workId: work.id,
            status: "received",
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return ok({ idempotent_replay: true });
        }
        throw err;
      }
    }

    const now = new Date();
    const counts = { applied: 0, skipped: 0, notFound: 0, errors: 0 };

    // 対象 work 配下の連携だけを触る（他テナントの id を渡されても反映しない）。
    for (const r of data.results) {
      const link = await prisma.ticketLink.findFirst({
        where: { id: r.whaleTicketLinkId, workId: work.id },
        select: { id: true, status: true },
      });
      if (!link) { counts.notFound += 1; continue; }

      const target = targetStatusFor(r.result);

      // ERROR は同期済みにしない（次回の差分取得で再試行させる）。
      const markSynced = r.result !== "ERROR";

      const statusApplied = await prisma.$transaction(async (tx) => {
        // status は **id だけで update しない**。読んだ status を where に含める CAS にする。
        // そうしないと「PENDING を読む → 運営が REVOKED へ解除 → id 指定で LINKED に更新」で
        // 解除済み連携が復活する。
        let observed: TicketLinkStatus = link.status;
        let applied = false;

        for (let attempt = 0; attempt < MAX_SYNC_CAS_ATTEMPTS; attempt += 1) {
          // 遷移可否は **常に最新の observed** に対して評価する（stale な初回読み取り値で判定しない）。
          // REVOKED は LINK_TRANSITIONS が空なので、ここで必ず nextStatus = null になる。
          const nextStatus =
            target && target !== observed && canTransitionLink(observed, target) ? target : null;
          // 遷移不可 / 既に同値 → status は触らない（既存の no-op と同じ）。
          if (!nextStatus) break;

          const updated = await tx.ticketLink.updateMany({
            where: { id: link.id, workId: work.id, status: observed },
            data:  { status: nextStatus },
          });
          if (updated.count > 0) { applied = true; break; }

          // count 0 = 「where に一致する行が無かった」だけ。
          // DB エラーは throw されるのでここには来ない（= 通信断等を競合と取り違えない）。
          const after = await tx.ticketLink.findFirst({
            where:  { id: link.id, workId: work.id },
            select: { status: true },
          });
          if (!after) break;
          observed = after.status; // 次の周回で最新 status に対して再評価する
        }

        // uzuSyncedAt は status に依存しない「この時刻の同期結果を受け取った」記録。
        // 最初から REVOKED だった場合の既存挙動と同じく、status が no-op でも進める。
        if (markSynced) {
          await tx.ticketLink.updateMany({
            where: { id: link.id, workId: work.id },
            data:  { uzuSyncedAt: now },
          });
        }

        await tx.ticketLinkSyncLog.create({
          data: {
            ticketLinkId: link.id,
            uzuWorkId:    r.uzuWorkId ?? null,
            result:       r.result,
            errorCode:    r.errorCode ?? null,
            syncedAt:     now,
          },
        });
        return applied;
      });

      // 集計の意味は据え置き（markSynced === (result !== "ERROR") なので、
      // 非 ERROR は status が no-op でも applied。最初から REVOKED の場合と同じ）。
      if (r.result === "ERROR") counts.errors += 1;
      else if (statusApplied || markSynced) counts.applied += 1;
      else counts.skipped += 1;
    }

    if (idempotencyKey) {
      await prisma.uzuProSyncRequest.update({
        where: { idempotencyKey },
        data: { status: "processed", processedAt: new Date() },
      });
    }

    // 監査ログ（PII 非含有: 件数のみ）。
    await recordUzuProActivity(prisma, {
      oaId:       work.oaId,
      workId:     work.id,
      action:     "sync_success",
      targetType: "sync",
      detail:     { kind: "ticket_link_sync_result", ...counts },
    });

    return ok(counts);
  } catch (err) {
    if (err instanceof ZodError) return badRequest("リクエスト内容が不正です");
    if (idempotencyKey) {
      await prisma.uzuProSyncRequest
        .update({ where: { idempotencyKey }, data: { status: "failed", processedAt: new Date() } })
        .catch(() => undefined);
    }
    console.error("[external/v2/uzu-pro/ticket-links/sync-result] error:", err);
    return serverError(err);
  }
}
