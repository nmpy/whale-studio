// src/app/api/oas/[id]/riddles/route.ts
// GET  /api/oas/:id/riddles  — 謎一覧（作成日時降順）
// POST /api/oas/:id/riddles  — 謎作成

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { createRiddleSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import type { CarouselCard, Hint } from "@/types";

type RiddleRow = {
  id: string;
  oaId: string;
  title: string;
  questionType: string;
  questionText: string | null;
  questionImageUrl: string | null;
  questionVideoUrl: string | null;
  questionCarousel: string | null;
  answerText: string;
  matchCondition: string;
  correctMessage: string;
  wrongMessage: string;
  status: string;
  hints: string;
  characterId: string | null;
  targetSegment: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toResponse(r: RiddleRow) {
  let carousel: CarouselCard[] | null = null;
  if (r.questionCarousel) {
    try { carousel = JSON.parse(r.questionCarousel) as CarouselCard[]; } catch { carousel = null; }
  }
  let hints: Hint[] = [];
  try { hints = JSON.parse(r.hints) as Hint[]; } catch { hints = []; }
  return {
    id:                 r.id,
    oa_id:              r.oaId,
    title:              r.title,
    question_type:      r.questionType,
    question_text:      r.questionText,
    question_image_url: r.questionImageUrl,
    question_video_url: r.questionVideoUrl,
    question_carousel:  carousel,
    answer_text:        r.answerText,
    match_condition:    r.matchCondition,
    correct_message:    r.correctMessage,
    wrong_message:      r.wrongMessage,
    status:             r.status,
    hints,
    character_id:       r.characterId,
    target_segment:     r.targetSegment,
    created_at:         r.createdAt,
    updated_at:         r.updatedAt,
  };
}

export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  'viewer',
  async (_req, { params }) => {
    try {
      const oa = await prisma.oa.findUnique({ where: { id: params.id } });
      if (!oa) return notFound("OA");

      const riddles = await prisma.riddle.findMany({
        where:   { oaId: params.id },
        orderBy: { createdAt: "desc" },
      });

      return ok(riddles.map(toResponse));
    } catch (err) {
      return serverError(err);
    }
  }
);

export const POST = withRole<{ id: string }>(
  ({ params }) => params.id,
  'editor',
  async (req, { params }) => {
  try {
    const oa = await prisma.oa.findUnique({ where: { id: params.id } });
    if (!oa) return notFound("OA");

    const body = await req.json();
    const data = createRiddleSchema.parse(body);

    const riddle = await prisma.riddle.create({
      data: {
        oaId:             params.id,
        title:            data.title,
        questionType:     data.question_type,
        questionText:     data.question_text      ?? null,
        questionImageUrl: data.question_image_url ?? null,
        questionVideoUrl: data.question_video_url ?? null,
        questionCarousel: data.question_carousel  ? JSON.stringify(data.question_carousel) : null,
        answerText:       data.answer_text,
        matchCondition:   data.match_condition,
        correctMessage:   data.correct_message,
        wrongMessage:     data.wrong_message,
        status:           data.status,
        hints:            JSON.stringify(data.hints),
        characterId:      data.character_id   ?? null,
        targetSegment:    data.target_segment ?? null,
      },
    });

    return created(toResponse(riddle));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
  }
);
