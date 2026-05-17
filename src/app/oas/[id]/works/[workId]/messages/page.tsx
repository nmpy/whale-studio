import { Prisma } from "@prisma/client";
import { MessagesClient } from "./MessagesClient";
import { prisma } from "@/lib/prisma";
import { getServerAuthUser } from "@/lib/server-auth-user";
import { isPlatformOwner } from "@/lib/platform-admin";
import { getWorkspaceRole } from "@/lib/rbac";
import { parseAnswerMatchType } from "@/lib/puzzle-answer";
import type { MessageWithRelations, PhaseWithCounts, TransitionWithPhases } from "@/types";

export const dynamic = "force-dynamic";

type PageProps = {
  params: { id: string; workId: string };
};

function parseJsonArray(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function formatPhase(p: {
  id: string; workId: string; phaseType: string; name: string; description: string | null;
  startTrigger: string | null; resumeSummary: string | null; sortOrder: number; isActive: boolean;
  createdAt: Date; updatedAt: Date; _count: { messages: number; transitionsFrom: number };
}): PhaseWithCounts {
  return {
    id: p.id,
    work_id: p.workId,
    phase_type: p.phaseType as PhaseWithCounts["phase_type"],
    name: p.name,
    description: p.description,
    start_trigger: p.startTrigger,
    resume_summary: p.resumeSummary,
    sort_order: p.sortOrder,
    is_active: p.isActive,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
    _count: p._count,
  };
}

function formatTransition(t: {
  id: string; workId: string; fromPhaseId: string; toPhaseId: string; label: string;
  condition: string | null; flagCondition: string | null; setFlags: string;
  sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date;
  toPhase: { id: string; name: string; phaseType: string } | null;
}): TransitionWithPhases {
  return {
    id: t.id,
    work_id: t.workId,
    from_phase_id: t.fromPhaseId,
    to_phase_id: t.toPhaseId,
    label: t.label,
    condition: t.condition,
    flag_condition: t.flagCondition,
    set_flags: t.setFlags,
    sort_order: t.sortOrder,
    is_active: t.isActive,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
    to_phase: t.toPhase
      ? { id: t.toPhase.id, name: t.toPhase.name, phase_type: t.toPhase.phaseType as TransitionWithPhases["to_phase"]["phase_type"] }
      : { id: t.toPhaseId, name: "未設定", phase_type: "normal" },
  };
}

function formatMessage(m: {
  id: string; workId: string; phaseId: string | null; characterId: string | null;
  messageType: string; kind: string; body: string | null; assetUrl: string | null;
  triggerKeyword: string | null; targetSegment: string | null; notifyText: string | null; riddleId: string | null;
  quickReplies: string | null; nextMessageId: string | null; altText: string | null; flexPayloadJson: string | null;
  puzzleType: string | null; answer: string | null; puzzleHintText: string | null; answerMatchType: string | null;
  correctAction: string | null; correctText: string | null; incorrectText: string | null; incorrectQuickReplies: string | null;
  correctNextPhaseId: string | null; hintMode: string; lagMs: number;
  readReceiptMode: string | null; readDelayMs: number | null; typingEnabled: boolean | null; typingMinMs: number | null; typingMaxMs: number | null;
  loadingEnabled: boolean | null; loadingThresholdMs: number | null; loadingMinSeconds: number | null; loadingMaxSeconds: number | null;
  tapDestinationId: string | null; tapUrl: string | null; sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date;
  phase: { id: string; name: string; phaseType: string } | null;
  character: { id: string; name: string; iconType: string; iconText: string | null; iconImageUrl: string | null; iconColor: string | null } | null;
}): MessageWithRelations {
  return {
    id: m.id,
    work_id: m.workId,
    phase_id: m.phaseId,
    character_id: m.characterId,
    message_type: m.messageType as MessageWithRelations["message_type"],
    kind: m.kind as MessageWithRelations["kind"],
    body: m.body,
    asset_url: m.assetUrl,
    trigger_keyword: m.triggerKeyword,
    target_segment: m.targetSegment,
    notify_text: m.notifyText,
    riddle_id: m.riddleId,
    quick_replies: parseJsonArray(m.quickReplies),
    next_message_id: m.nextMessageId,
    alt_text: m.altText,
    flex_payload_json: m.flexPayloadJson,
    puzzle_type: m.puzzleType,
    answer: m.answer,
    puzzle_hint_text: m.puzzleHintText,
    answer_match_type: parseAnswerMatchType(m.answerMatchType),
    correct_action: m.correctAction,
    correct_text: m.correctText,
    incorrect_text: m.incorrectText,
    incorrect_quick_replies: parseJsonArray(m.incorrectQuickReplies),
    correct_next_phase_id: m.correctNextPhaseId,
    hint_mode: m.hintMode as MessageWithRelations["hint_mode"],
    lag_ms: m.lagMs,
    read_receipt_mode: m.readReceiptMode as MessageWithRelations["read_receipt_mode"],
    read_delay_ms: m.readDelayMs,
    typing_enabled: m.typingEnabled,
    typing_min_ms: m.typingMinMs,
    typing_max_ms: m.typingMaxMs,
    loading_enabled: m.loadingEnabled,
    loading_threshold_ms: m.loadingThresholdMs,
    loading_min_seconds: m.loadingMinSeconds,
    loading_max_seconds: m.loadingMaxSeconds,
    tap_destination_id: m.tapDestinationId,
    tap_url: m.tapUrl,
    sort_order: m.sortOrder,
    is_active: m.isActive,
    created_at: m.createdAt.toISOString(),
    updated_at: m.updatedAt.toISOString(),
    phase: m.phase ? { id: m.phase.id, name: m.phase.name, phase_type: m.phase.phaseType as NonNullable<MessageWithRelations["phase"]>["phase_type"] } : null,
    character: m.character ? {
      id: m.character.id,
      name: m.character.name,
      icon_type: m.character.iconType as NonNullable<MessageWithRelations["character"]>["icon_type"],
      icon_text: m.character.iconText,
      icon_image_url: m.character.iconImageUrl,
      icon_color: m.character.iconColor,
    } : null,
  };
}

async function loadInitialData(oaId: string, workId: string) {
  const user = await getServerAuthUser();
  if (!user) return { workTitle: "", welcomeMsg: "", messages: [], phases: [], transitions: [], error: "ログインが必要です" };

  const work = await prisma.work.findUnique({
    where: { id: workId },
    select: { id: true, oaId: true, title: true, welcomeMessage: true },
  });
  if (!work || work.oaId !== oaId) return { workTitle: "", welcomeMsg: "", messages: [], phases: [], transitions: [], error: "作品が見つかりません" };

  if (!isPlatformOwner(user.id)) {
    const member = await getWorkspaceRole(oaId, user.id);
    if (!member || member.status !== "active") {
      return { workTitle: work.title, welcomeMsg: work.welcomeMessage ?? "", messages: [], phases: [], transitions: [], error: "このワークスペースへのアクセス権がありません" };
    }
  }

  const [messages, phases, transitions] = await Promise.all([
    prisma.message.findMany({
      where: { workId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        phase: { select: { id: true, name: true, phaseType: true } },
        character: { select: { id: true, name: true, iconType: true, iconText: true, iconImageUrl: true, iconColor: true } },
      },
    }),
    prisma.phase.findMany({
      where: { workId, phaseType: { not: "global" } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { messages: true, transitionsFrom: true } } },
    }),
    prisma.transition.findMany({
      where: { workId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { toPhase: { select: { id: true, name: true, phaseType: true } } },
    }),
  ]);

  return {
    workTitle: work.title,
    welcomeMsg: work.welcomeMessage ?? "",
    messages: messages.map(formatMessage),
    phases: phases.map(formatPhase),
    transitions: transitions.map(formatTransition),
    error: null,
  };
}

export default async function MessagesPage({ params }: PageProps) {
  try {
    const initial = await loadInitialData(params.id, params.workId);
    return (
      <MessagesClient
        oaId={params.id}
        workId={params.workId}
        initialWorkTitle={initial.workTitle}
        initialWelcomeMsg={initial.welcomeMsg}
        initialMessages={initial.messages}
        initialPhases={initial.phases}
        initialTransitions={initial.transitions}
        initialError={initial.error}
      />
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("[/messages] Prisma error", err.code, err.meta);
    } else {
      console.error("[/messages] SSR load failed", err);
    }
    return (
      <MessagesClient
        oaId={params.id}
        workId={params.workId}
        initialWorkTitle=""
        initialWelcomeMsg=""
        initialMessages={[]}
        initialPhases={[]}
        initialTransitions={[]}
        initialError="読み込みに失敗しました"
      />
    );
  }
}
