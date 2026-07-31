// src/app/api/liff/works/[workId]/survey-responses/route.ts
// POST /api/liff/works/[workId]/survey-responses — LIFF アンケート回答送信（認証不要）
// GET  /api/liff/works/[workId]/survey-responses?page_id=&line_user_id= — 回答済み判定（認証不要）
//
// LIFF プレイヤー側のフォームから呼ばれる公開エンドポイント。
// answers は { [questionId: string]: string | string[] } を期待する。
//
// 重複回答防止（survey_allow_multiple=false 時）:
//   - サーバー側でも (surveyId=liffPageConfigId, lineUserId) で回答済みを判定して 409 を返す
//     （画面制御だけに依存しない）。
//   - 競合送信（同時 POST）は dedupe_key の UNIQUE で DB 側が 1 件だけ通し、残りは P2002→409 に変換する。
//   - ※ ticketId / bookingId は現状のアンケート送信フローに存在しないため判定キーに含めない
//     （将来 LIFF コンテキストで供給された場合に dedupeKey を拡張できる設計）。

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import {
  findWorkByIdOrPublicId,
  findLiffPageConfigByIdOrPublicId,
} from "@/lib/public-id-resolver";
import { buildSubmissionAnswers } from "@/lib/liff/submission";
import { isMultipleAllowed, SURVEY_ALREADY_ANSWERED_DEFAULT } from "@/lib/liff/survey-completion";
import type { LiffPageConfigSettings } from "@/types";

export const dynamic = "force-dynamic";

// 回答値: 1 つの input は string、複数選択 (checkbox) は string[]
const answerValueSchema = z.union([z.string().max(5000), z.array(z.string().max(500)).max(50)]);

const surveyResponseBodySchema = z.object({
  line_user_id: z.string().max(100).optional().nullable(),
  /** LIFF profile 表示名（取得できた場合のみ）。回答結果画面で表示する。 */
  display_name: z.string().max(200).optional().nullable(),
  /** どの LIFF ページから送信されたか。UUID か publicId のどちらでも受け付ける。 */
  page_id:      z.string().max(200).optional().nullable(),
  /** 質問 id をキー、回答値を value とするマップ */
  answers: z.record(answerValueSchema),
});

function alreadyAnsweredResponse() {
  return NextResponse.json(
    { success: false, error: { code: "ALREADY_ANSWERED", message: SURVEY_ALREADY_ANSWERED_DEFAULT } },
    { status: 409 },
  );
}

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

    const lineUserId = data.line_user_id ?? null;

    // ページ解決（重複判定 + 計測 の双方で使う。UUID/publicId 両対応・work scope を検証）。
    const page = data.page_id
      ? await findLiffPageConfigByIdOrPublicId(data.page_id, { workScope: work.id })
      : null;
    const pageId = page?.id ?? null;
    const settings = (page?.settingsJson ?? {}) as LiffPageConfigSettings;
    const allowMultiple = isMultipleAllowed(settings);

    // 重複回答防止キー: 複数回答不可 かつ (surveyId, lineUserId) が特定できるときのみ設定。
    //   複数回答可 / 匿名 / 旧経路(page 不明) は null（重複を強制しない）。
    const canDedupe = !allowMultiple && !!pageId && !!lineUserId;
    const dedupeKey = canDedupe ? `${pageId}:${lineUserId}` : null;

    // 事前チェック（速いパス・親切な 409）。競合はこの後の UNIQUE が最終防波堤。
    if (canDedupe) {
      const existing = await prisma.liffSurveyResponse.findFirst({
        where: { dedupeKey },
        select: { id: true },
      });
      if (existing) return alreadyAnsweredResponse();
    }

    let saved: { id: string; submittedAt: Date };
    try {
      saved = await prisma.liffSurveyResponse.create({
        data: {
          workId: work.id,
          liffPageConfigId: pageId,
          lineUserId,
          dedupeKey,
          answersJson: data.answers as Prisma.InputJsonValue,
        },
        select: { id: true, submittedAt: true },
      });
    } catch (e) {
      // 競合送信: dedupe_key UNIQUE 違反（P2002）→ 回答済みとして 409。
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return alreadyAnsweredResponse();
      }
      throw e;
    }

    // 計測 / 回答結果画面用の保存（page が解決できたときのみ）。
    // 失敗してもアンケート登録は成功扱いとし、UX を阻害しない。
    if (page) {
      try {
        const blocks = buildSubmissionAnswers(settings.survey_items, data.answers);
        if (blocks.length > 0) {
          await prisma.liffSubmission.create({
            data: {
              oaId:        work.oaId,
              workId:      work.id,
              liffPageId:  page.id,
              lineUserId,
              displayName: data.display_name ?? null,
              answersJson: { blocks } as unknown as Prisma.InputJsonValue,
            },
          });
        }
      } catch (e) {
        console.error("[LIFF Survey] LiffSubmission save failed:", e);
      }
    }

    // 計測: survey_submit (失敗してもアンケート登録は成功扱い)
    prisma.liffEventLog
      .create({
        data: {
          workId:          work.id,
          liffPageConfigId: pageId,
          lineUserId,
          eventType:       "survey_submit",
          metadataJson:    { response_id: saved.id, answer_count: Object.keys(data.answers).length } as Prisma.InputJsonValue,
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

/**
 * GET: 回答済み判定。複数回答不可のアンケートで、指定 LINE ユーザーが当該ページへ回答済みかを返す。
 *   query: page_id（UUID / publicId）, line_user_id
 *   複数回答許可 / page 不明 / lineUserId 無し のときは常に answered=false（フォームを表示させる）。
 * サーバー側の回答データ（localStorage 非依存）で判定する。
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workId: string }> }
) {
  try {
    const { workId: workIdOrPublic } = await ctx.params;
    const work = await findWorkByIdOrPublicId(workIdOrPublic);
    if (!work) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "作品が見つかりません" } },
        { status: 404 }
      );
    }

    const url = new URL(req.url);
    const pageParam  = url.searchParams.get("page_id");
    const lineUserId = url.searchParams.get("line_user_id");

    const page = pageParam
      ? await findLiffPageConfigByIdOrPublicId(pageParam, { workScope: work.id })
      : null;
    const settings = (page?.settingsJson ?? {}) as LiffPageConfigSettings;
    const allowMultiple = isMultipleAllowed(settings);

    let answered = false;
    if (!allowMultiple && page?.id && lineUserId) {
      const existing = await prisma.liffSurveyResponse.findFirst({
        where: { liffPageConfigId: page.id, lineUserId },
        select: { id: true },
      });
      answered = !!existing;
    }

    return NextResponse.json({ success: true, data: { answered } });
  } catch (err) {
    console.error("[LIFF Survey Status Error]", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "サーバーエラーが発生しました" } },
      { status: 500 }
    );
  }
}
