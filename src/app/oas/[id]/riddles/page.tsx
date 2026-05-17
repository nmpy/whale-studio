import { Prisma } from "@prisma/client";
import { RiddlesClient } from "./RiddlesClient";
import { prisma } from "@/lib/prisma";
import { getServerAuthUser } from "@/lib/server-auth-user";
import { isPlatformOwner } from "@/lib/platform-admin";
import { getWorkspaceRole } from "@/lib/rbac";
import type { CarouselCard, Hint, Riddle } from "@/types";

export const dynamic = "force-dynamic";

type PageProps = {
  params: { id: string };
};

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function formatRiddle(r: {
  id: string; oaId: string; workId: string | null; title: string; questionType: string;
  questionText: string | null; questionImageUrl: string | null; questionVideoUrl: string | null; questionCarousel: string | null;
  answerText: string; matchCondition: string; correctMessage: string; wrongMessage: string; status: string;
  hints: string; characterId: string | null; targetSegment: string | null; createdAt: Date; updatedAt: Date;
}): Riddle {
  return {
    id: r.id,
    oa_id: r.oaId,
    work_id: r.workId,
    title: r.title,
    question_type: r.questionType as Riddle["question_type"],
    question_text: r.questionText,
    question_image_url: r.questionImageUrl,
    question_video_url: r.questionVideoUrl,
    question_carousel: parseJson<CarouselCard[] | null>(r.questionCarousel, null),
    answer_text: r.answerText,
    match_condition: r.matchCondition as Riddle["match_condition"],
    correct_message: r.correctMessage,
    wrong_message: r.wrongMessage,
    status: r.status as Riddle["status"],
    hints: parseJson<Hint[]>(r.hints, []),
    character_id: r.characterId,
    target_segment: r.targetSegment,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

async function loadInitialData(oaId: string) {
  const user = await getServerAuthUser();
  if (!user) return { oaTitle: "", riddles: [], error: "ログインが必要です" };

  const oa = await prisma.oa.findUnique({
    where: { id: oaId },
    select: { title: true },
  });
  if (!oa) return { oaTitle: "", riddles: [], error: "OAが見つかりません" };

  if (!isPlatformOwner(user.id)) {
    const member = await getWorkspaceRole(oaId, user.id);
    if (!member || member.status !== "active") {
      return { oaTitle: oa.title, riddles: [], error: "このワークスペースへのアクセス権がありません" };
    }
  }

  const riddles = await prisma.riddle.findMany({
    where: { oaId },
    orderBy: { createdAt: "desc" },
  });

  return { oaTitle: oa.title, riddles: riddles.map(formatRiddle), error: null };
}

export default async function RiddlesPage({ params }: PageProps) {
  try {
    const initial = await loadInitialData(params.id);
    return (
      <RiddlesClient
        oaId={params.id}
        initialOaTitle={initial.oaTitle}
        initialRiddles={initial.riddles}
        initialError={initial.error}
      />
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("[/riddles] Prisma error", err.code, err.meta);
    } else {
      console.error("[/riddles] SSR load failed", err);
    }
    return (
      <RiddlesClient
        oaId={params.id}
        initialOaTitle=""
        initialRiddles={[]}
        initialError="読み込みに失敗しました"
      />
    );
  }
}
