// src/app/api/liff/pages/[pageId]/submissions/route.ts
// POST /api/liff/pages/[pageId]/submissions — LIFF フォーム/アンケート送信（公開・認証不要）
//
// 責務:
//  - LIFF ページが存在することを確認（pageId は UUID / publicId どちらでも可）
//  - page から workId / oaId を特定
//  - body の answers（ブロック配列 or { blocks: [...] }）を LiffSubmission に保存
//  - line_user_id / display_name / player_id は取得できた場合のみ保存（null 許容）
//  - 空回答 / 不正な pageId は 400 / 404
//  - 送信後は { ok: true } を返す

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { findLiffPageConfigByIdOrPublicId } from "@/lib/public-id-resolver";
import { extractAnswerBlocks } from "@/lib/liff/submission";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  line_user_id: z.string().max(100).optional().nullable(),
  display_name: z.string().max(200).optional().nullable(),
  player_id:    z.string().max(100).optional().nullable(),
  // answers は { blocks: [...] } / 直接の配列 / その他を受け、extractAnswerBlocks で正規化する。
  answers:      z.any(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ pageId: string }> }) {
  try {
    const { pageId: pageIdOrPublic } = await ctx.params;

    const page = await findLiffPageConfigByIdOrPublicId(pageIdOrPublic);
    if (!page) {
      return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "ページが見つかりません" } }, { status: 404 });
    }

    const work = await prisma.work.findUnique({ where: { id: page.workId }, select: { id: true, oaId: true } });
    if (!work) {
      return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "作品が見つかりません" } }, { status: 404 });
    }

    const data = bodySchema.parse(await req.json());
    const blocks = extractAnswerBlocks(data.answers);
    if (blocks.length === 0) {
      return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST", message: "回答が空です" } }, { status: 400 });
    }

    await prisma.liffSubmission.create({
      data: {
        oaId:        work.oaId,
        workId:      work.id,
        liffPageId:  page.id,
        lineUserId:  data.line_user_id ?? null,
        displayName: data.display_name ?? null,
        playerId:    data.player_id ?? null,
        answersJson: { blocks } as unknown as Prisma.InputJsonValue,
      },
    });

    // 計測（失敗しても送信は成功扱い）。
    prisma.liffEventLog
      .create({
        data: {
          workId:           work.id,
          liffPageConfigId: page.id,
          lineUserId:       data.line_user_id ?? null,
          eventType:        "survey_submit",
          metadataJson:     { answer_count: blocks.length, source: "submissions_api" } as Prisma.InputJsonValue,
        },
      })
      .catch((e) => console.error("[LIFF Submission] event log failed:", e));

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST", message: "入力内容に誤りがあります" } }, { status: 400 });
    }
    console.error("[LIFF Submission Error]", err);
    return NextResponse.json({ ok: false, error: { code: "INTERNAL_SERVER_ERROR", message: "サーバーエラーが発生しました" } }, { status: 500 });
  }
}
