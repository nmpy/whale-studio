// src/app/api/liff/works/[workId]/survey-responses/route.ts
// POST /api/liff/works/[workId]/survey-responses — LIFF アンケート回答送信（認証不要）
//
// LIFF プレイヤー側のフォームから呼ばれる公開エンドポイント。
// answers は { [questionId: string]: string | string[] } を期待する。

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { findWorkByIdOrPublicId } from "@/lib/public-id-resolver";

export const dynamic = "force-dynamic";

// 回答値: 1 つの input は string、複数選択 (checkbox) は string[]
const answerValueSchema = z.union([z.string().max(5000), z.array(z.string().max(500)).max(50)]);

const surveyResponseBodySchema = z.object({
  line_user_id: z.string().max(100).optional().nullable(),
  /** 質問 id をキー、回答値を value とするマップ */
  answers: z.record(answerValueSchema),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ workId: string }> }
) {
  try {
    const { workId: workIdOrPublic } = await ctx.params;

    // workId は UUID か publicId のどちらでも受け付ける
    const work = await findWorkByIdOrPublicId(workIdOrPublic);
    if (!work) {
      console.error(`[LIFF Survey] Work not found: workIdOrPublic=${workIdOrPublic}`);
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "作品が見つかりません" } },
        { status: 404 }
      );
    }

    const json = await req.json();
    const data = surveyResponseBodySchema.parse(json);

    // answers が空オブジェクトの場合はバリデーションエラー
    if (Object.keys(data.answers).length === 0) {
      return NextResponse.json(
        { success: false, error: { code: "BAD_REQUEST", message: "回答が空です" } },
        { status: 400 }
      );
    }

    const saved = await prisma.liffSurveyResponse.create({
      data: {
        workId: work.id,
        lineUserId: data.line_user_id ?? null,
        answersJson: data.answers as Prisma.InputJsonValue,
      },
      select: { id: true, submittedAt: true },
    });

    // 計測: survey_submit (失敗してもアンケート登録は成功扱いとし、UX を阻害しない)
    prisma.liffEventLog
      .create({
        data: {
          workId:       work.id,
          lineUserId:   data.line_user_id ?? null,
          eventType:    "survey_submit",
          metadataJson: { response_id: saved.id, answer_count: Object.keys(data.answers).length } as Prisma.InputJsonValue,
        },
      })
      .catch((e) => console.error("[LIFF Survey] event log failed:", e));

    return NextResponse.json({
      success: true,
      data: {
        id: saved.id,
        submitted_at: saved.submittedAt.toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: { code: "BAD_REQUEST", message: "入力内容に誤りがあります" } },
        { status: 400 }
      );
    }
    console.error("[LIFF Survey Submit Error]", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "サーバーエラーが発生しました" } },
      { status: 500 }
    );
  }
}
