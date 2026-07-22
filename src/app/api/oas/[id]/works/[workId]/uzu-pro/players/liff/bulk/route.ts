// src/app/api/oas/[id]/works/[workId]/uzu-pro/players/liff/bulk/route.ts
// POST /api/oas/:id/works/:workId/uzu-pro/players/liff/bulk — 当該 work の未発行 active プレイヤーへ一括発行。
//
// 対象: status=active かつ issued リンクを 1 つも持たないプレイヤーのみ（未発行のみ）。
// キャンセル済み / 既発行は対象外（集計に excluded / alreadyIssued として計上）。
// 各プレイヤーは独立した $transaction 内で発行し、二重発行を構造的に防ぎつつ 1 件失敗が全体を巻き込まないようにする。
// レスポンスには平文 URL を載せない（件数が多く、URL は各レコード側に存在する）。detail は PII フリー（件数のみ）。

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, unprocessable } from "@/lib/api-response";
import { authorizeUzuPro } from "@/lib/uzupro-auth";
import { issueLiffForPlayer } from "@/lib/uzupro/liff";
import { recordUzuProActivity } from "@/lib/uzupro/activity";
import { resolveTicketExpiresAt } from "@/lib/live-ticket-link";
import { getLiffIdForUrlGeneration } from "@/lib/liff/config";

export const dynamic = "force-dynamic";

// 同時に走らせる発行数。プレイヤー行の FOR UPDATE ロックで直列化される前提で、
// Transaction Pooler を圧迫しない小さめのバッチにする。
const BATCH_SIZE = 5;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; workId: string } },
) {
  const auth = await authorizeUzuPro(req, params.id, params.workId);
  if (!auth.ok) return auth.response;

  // 当該 OA が存在することは authorizeUzuPro が保証するが、work の帰属確認のため
  // 対象プレイヤーの where に booking.workId を必ず含める（他作品/他 OA は対象外）。

  const oa = await prisma.oa.findUnique({ where: { id: params.id }, select: { liffId: true } });
  const liffId = getLiffIdForUrlGeneration(oa);
  if (!liffId) return unprocessable("このアカウントの LIFF が未設定です", "LIFF_NOT_CONFIGURED");

  // 発行対象: 当該 work の active かつ未発行（issued リンクを持たない）プレイヤー。
  const targets = await prisma.uzuProPlayer.findMany({
    where: {
      oaId:      params.id,
      status:    "active",
      booking:   { workId: params.workId },
      liffLinks: { none: { status: "issued" } },
    },
    select: { id: true, booking: { select: { liveSession: { select: { startsAt: true } } } } },
  });

  // 除外件数（集計表示用・PII フリー）。
  const [skippedCancelled, alreadyIssued] = await Promise.all([
    prisma.uzuProPlayer.count({
      where: { oaId: params.id, status: "cancelled", booking: { workId: params.workId } },
    }),
    prisma.uzuProPlayer.count({
      where: { oaId: params.id, status: "active", booking: { workId: params.workId }, liffLinks: { some: { status: "issued" } } },
    }),
  ]);

  const now = new Date();
  let generated = 0;
  let failed = 0;
  const failures: Array<{ playerId: string; reason: string }> = [];

  // 小バッチ並行で発行（各プレイヤーは独立 tx）。
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (p) => {
        const expiresAt = resolveTicketExpiresAt({ startsAt: p.booking?.liveSession?.startsAt ?? null, now });
        try {
          const result = await prisma.$transaction((tx) =>
            issueLiffForPlayer(tx, { oaId: params.id, playerId: p.id, liffId, expiresAt, now, reissue: false }),
          );
          switch (result.kind) {
            case "issued":
              generated += 1;
              break;
            case "already_issued":
              // 抽出後に別経路で発行された等のレース。二重発行ではないので失敗扱いにしない。
              break;
            case "skipped_cancelled":
              // 抽出後にキャンセルされたレース。除外として扱う。
              break;
            case "not_found":
              failed += 1;
              failures.push({ playerId: p.id, reason: "not_found" });
              break;
          }
        } catch {
          // 例外内容は PII を含みうるためレスポンス/ログに詳細を載せない。
          failed += 1;
          failures.push({ playerId: p.id, reason: "error" });
        }
      }),
    );
  }

  await recordUzuProActivity(prisma, {
    oaId: params.id, workId: params.workId, actorUserId: auth.user.id,
    action: "liff_bulk_issue", targetType: "player",
    detail: { generated, alreadyIssued, skippedCancelled, failed, targets: targets.length },
  });

  return ok({ generated, alreadyIssued, excluded: skippedCancelled, failed, failures });
}
