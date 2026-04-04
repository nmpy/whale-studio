// src/app/api/oas/[id]/riddles/[rid]/route.ts
// GET    /api/oas/:id/riddles/:rid  — 謎詳細
// PATCH  /api/oas/:id/riddles/:rid  — 謎更新
// DELETE /api/oas/:id/riddles/:rid  — 謎削除

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { updateRiddleSchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import type { CarouselCard, Hint } from "@/types";

type RiddleRow = {
  id: string;
  oaId: string;
  workId: string | null;
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
    work_id:            r.workId,
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

async function findRiddle(oaId: string, riddleId: string) {
  const riddle = await prisma.riddle.findUnique({ where: { id: riddleId } });
  if (!riddle || riddle.oaId !== oaId) return null;
  return riddle;
}

export const GET = withRole<{ id: string; rid: string }>(
  ({ params }) => params.id,
  'viewer',
  async (_req, { params }) => {
    try {
      const riddle = await findRiddle(params.id, params.rid);
      if (!riddle) return notFound("Riddle");
      return ok(toResponse(riddle));
    } catch (err) {
      return serverError(err);
    }
  }
);

export const PATCH = withRole<{ id: string; rid: string }>(
  ({ params }) => params.id,
  'tester',
  async (req, { params }) => {
    try {
      const riddle = await findRiddle(params.id, params.rid);
      if (!riddle) return notFound("Riddle");

      const body = await req.json();
      const data = updateRiddleSchema.parse(body);

      const updated = await prisma.riddle.update({
        where: { id: params.rid },
        data: {
          ...(data.title              !== undefined && { title:            data.title }),
          ...(data.question_type      !== undefined && { questionType:     data.question_type }),
          ...(data.question_text      !== undefined && { questionText:     data.question_text }),
          ...(data.question_image_url !== undefined && { questionImageUrl: data.question_image_url }),
          ...(data.question_video_url !== undefined && { questionVideoUrl: data.question_video_url }),
          ...(data.question_carousel  !== undefined && {
            questionCarousel: data.question_carousel ? JSON.stringify(data.question_carousel) : null,
          }),
          ...(data.answer_text        !== undefined && { answerText:       data.answer_text }),
          ...(data.match_condition    !== undefined && { matchCondition:   data.match_condition }),
          ...(data.correct_message    !== undefined && { correctMessage:   data.correct_message }),
          ...(data.wrong_message      !== undefined && { wrongMessage:     data.wrong_message }),
          ...(data.status             !== undefined && { status:           data.status }),
          ...(data.hints              !== undefined && { hints:            JSON.stringify(data.hints) }),
          ...(data.character_id       !== undefined && { characterId:      data.character_id }),
          ...(data.target_segment     !== undefined && { targetSegment:    data.target_segment }),
          ...(data.work_id            !== undefined && { workId:           data.work_id }),
        },
      });

      return ok(toResponse(updated));
    } catch (err) {
      if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
      return serverError(err);
    }
  }
);

export const DELETE = withRole<{ id: string; rid: string }>(
  ({ params }) => params.id,
  'owner',
  async (_req, { params }) => {
    try {
      const riddle = await findRiddle(params.id, params.rid);
      if (!riddle) return notFound("Riddle");
      await prisma.riddle.delete({ where: { id: params.rid } });
      return noContent();
    } catch (err) {
      return serverError(err);
    }
  }
);
