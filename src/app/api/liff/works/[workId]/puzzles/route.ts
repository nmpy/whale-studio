// src/app/api/liff/works/[workId]/puzzles/route.ts
// GET /api/liff/works/[workId]/puzzles?line_user_id=... — LIFF「謎・問題」ブロック用公開API（認証不要）
//
// そのプレイヤー（lineUserId）が「確実に到達している」謎・問題だけを返す。
// 到達履歴テーブルが無い（AnswerAttempt 等が無い）ため、別ルート(分岐)の未到達問題を
// 絶対に混ぜないよう、安全側として **現在フェーズ(currentPhaseId)の puzzle のみ** を返す。
// （sortOrder で「以前のフェーズ」までさかのぼると分岐先の未到達問題が混ざる恐れがあるため使わない。）
//
// ネタバレ防止: answer / correctText / incorrectText / puzzleHintText 等は一切返さない。
// 認可: lineUserId + workId スコープで UserProgress を引くため、他プレイヤーの履歴は混ざらない。
// 未認証 / lineUserId 未取得 / 進捗なし / 例外時は 500 にせず空配列を返す。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findWorkByIdOrPublicId } from "@/lib/public-id-resolver";

export const dynamic = "force-dynamic";

function emptyOk() {
  return NextResponse.json({ success: true, data: { puzzles: [] } });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workId: string }> },
) {
  try {
    const { workId: workIdOrPublic } = await ctx.params;
    const work = await findWorkByIdOrPublicId(workIdOrPublic);
    if (!work) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ページを読み込めませんでした。" } },
        { status: 404 },
      );
    }

    const lineUserId = new URL(req.url).searchParams.get("line_user_id");
    if (!lineUserId) return emptyOk(); // 未ログイン等 → 空（500 にしない）

    const up = await prisma.userProgress.findUnique({
      where: { lineUserId_workId: { lineUserId, workId: work.id } },
      select: { currentPhaseId: true },
    });
    if (!up?.currentPhaseId) return emptyOk(); // 未開始 → 空

    // 現在フェーズの名前（全 puzzle 共通ラベル）。
    const phase = await prisma.phase.findUnique({
      where: { id: up.currentPhaseId },
      select: { name: true },
    });

    // 現在フェーズの puzzle のみ（確実に到達中）。answer 等のネタバレは select しない。
    const msgs = await prisma.message.findMany({
      where: { workId: work.id, phaseId: up.currentPhaseId, kind: "puzzle", isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, body: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        puzzles: msgs.map((m) => ({
          id:         m.id,
          body:       m.body ?? "",
          phase_name: phase?.name ?? null,
          status:     "delivered" as const, // 出題中（到達済み）。正解/不正解は履歴が無いため出さない。
        })),
      },
    });
  } catch (err) {
    console.error("[LIFF puzzles API]", err);
    return emptyOk(); // 例外でも画面を壊さない
  }
}
