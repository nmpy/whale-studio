// src/app/api/liff/events/route.ts
// POST /api/liff/events — LIFF プレイヤーからのイベント計測 (公開エンドポイント、認証不要)
//
// LIFF 側からは navigator.sendBeacon で呼ばれる前提のため、
// レスポンスは軽量に保ち、エラー時も 204 で返してクライアントを邪魔しない。
//
// 不正な workId / pageId / blockId は記録せずに無視する (DB に汚いデータを残さない)。
// ID は UUID か publicId のどちらでも受け付ける (resolver で UUID に正規化してから保存)。

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  findWorkByIdOrPublicId,
  findLiffPageConfigByIdOrPublicId,
} from "@/lib/public-id-resolver";
import { isValidLiffEventType } from "@/lib/liff-events";

export const dynamic = "force-dynamic";

const MAX_METADATA_BYTES = 4096;

export async function POST(req: NextRequest) {
  // 204 No Content を共通的に返すヘルパー (失敗してもクライアントに伝えない)
  const ack = () => new NextResponse(null, { status: 204 });

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return ack();

    const eventType = body.event_type;
    if (!isValidLiffEventType(eventType)) return ack();

    const workIdOrPublic = typeof body.work_id === "string" ? body.work_id : null;
    if (!workIdOrPublic) return ack();

    const work = await findWorkByIdOrPublicId(workIdOrPublic);
    if (!work) return ack();

    // pageId が来ていれば検証 (work に属するか)。属さなければ pageId を捨ててログだけ残す。
    let liffPageConfigId: string | null = null;
    const pageIdOrPublic = typeof body.page_id === "string" ? body.page_id : null;
    if (pageIdOrPublic) {
      const page = await findLiffPageConfigByIdOrPublicId(pageIdOrPublic, { workScope: work.id });
      if (page) liffPageConfigId = page.id;
    }

    // blockId は LiffPageBlock を直接引いて、上記 page に属するか検証する
    let liffPageBlockId: string | null = null;
    const blockId = typeof body.block_id === "string" ? body.block_id : null;
    if (blockId && liffPageConfigId) {
      const block = await prisma.liffPageBlock.findFirst({
        where: { id: blockId, pageConfigId: liffPageConfigId },
        select: { id: true },
      });
      if (block) liffPageBlockId = block.id;
    }

    const lineUserId = typeof body.line_user_id === "string" && body.line_user_id.length > 0
      ? body.line_user_id
      : null;

    // メタデータは安全側に切り詰める (JSON サイズ上限 4KB)
    let metadataJson: Prisma.InputJsonValue | undefined;
    if (body.metadata_json && typeof body.metadata_json === "object") {
      try {
        const serialized = JSON.stringify(body.metadata_json);
        if (serialized.length <= MAX_METADATA_BYTES) {
          metadataJson = body.metadata_json as Prisma.InputJsonValue;
        }
      } catch {
        // 巨大 / 循環参照などは捨てる
      }
    }

    await prisma.liffEventLog.create({
      data: {
        workId:           work.id,
        liffPageConfigId,
        liffPageBlockId,
        lineUserId,
        eventType,
        metadataJson,
      },
    });

    return ack();
  } catch (err) {
    console.error("[LIFF events] failed to record:", err);
    // クライアントには 204 で返す (計測失敗で UX を壊さない)
    return ack();
  }
}
