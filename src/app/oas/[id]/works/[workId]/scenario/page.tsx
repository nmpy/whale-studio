import { Prisma } from "@prisma/client";
import { ScenarioClient } from "./ScenarioClient";
import { prisma } from "@/lib/prisma";
import { getServerAuthUser } from "@/lib/server-auth-user";
import { isPlatformOwner } from "@/lib/platform-admin";
import { getWorkspaceRole } from "@/lib/rbac";
import { parseAnswerMatchType } from "@/lib/puzzle-answer";
import type { Message, PhaseWithCounts, QuickReplyItem, TransitionWithPhases } from "@/types";

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
}): Message {
  return {
    id: m.id,
    work_id: m.workId,
    phase_id: m.phaseId,
    character_id: m.characterId,
    message_type: m.messageType as Message["message_type"],
    kind: m.kind as Message["kind"],
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
    hint_mode: m.hintMode as Message["hint_mode"],
    lag_ms: m.lagMs,
    read_receipt_mode: m.readReceiptMode as Message["read_receipt_mode"],
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
  };
}

type QrBranch =
  | { kind: "phase"; label: string; phaseId: string }
  | { kind: "message"; label: string; msgId: string; preview: string }
  | { kind: "hint"; label: string }
  | { kind: "url"; label: string; url: string }
  | { kind: "text"; label: string; value: string };

type MsgQrEntry = { msgId: string; preview: string; branches: QrBranch[] };

function buildMsgQrData(messages: Message[], transitions: TransitionWithPhases[]): Record<string, MsgQrEntry[]> {
  const norm = (s: string) => s.trim().toLowerCase().normalize("NFKC");
  const msgPreviewMap: Record<string, string> = {};
  for (const msg of messages) {
    msgPreviewMap[msg.id] = msg.body
      ? msg.body.slice(0, 36) + (msg.body.length > 36 ? "..." : "")
      : `[${msg.kind}]`;
  }

  const transLabelMap: Record<string, Record<string, string>> = {};
  for (const t of transitions) {
    if (!transLabelMap[t.from_phase_id]) transLabelMap[t.from_phase_id] = {};
    transLabelMap[t.from_phase_id][norm(t.label)] = t.to_phase_id;
  }

  const data: Record<string, MsgQrEntry[]> = {};
  const sortedMsgs = [...messages].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  for (const msg of sortedMsgs) {
    if (!msg.phase_id || !msg.quick_replies || msg.quick_replies.length === 0) continue;
    const qrItems = msg.quick_replies as QuickReplyItem[];
    const branches: QrBranch[] = [];
    for (const item of qrItems) {
      if (item.enabled === false) continue;
      const label = item.label;
      if (item.target_phase_id) {
        branches.push({ kind: "phase", label, phaseId: item.target_phase_id });
      } else if (item.target_type === "message" && item.target_message_id) {
        branches.push({ kind: "message", label, msgId: item.target_message_id, preview: msgPreviewMap[item.target_message_id] ?? `(ID: ${item.target_message_id.slice(0, 8)}...)` });
      } else if (item.action === "hint") {
        branches.push({ kind: "hint", label });
      } else if (item.action === "url" && item.value) {
        branches.push({ kind: "url", label, url: item.value });
      } else {
        const textVal = item.value?.trim() || label;
        const matchedPhaseId = transLabelMap[msg.phase_id]?.[norm(textVal)];
        branches.push(matchedPhaseId ? { kind: "phase", label, phaseId: matchedPhaseId } : { kind: "text", label, value: textVal });
      }
    }
    if (branches.length === 0) continue;
    if (!data[msg.phase_id]) data[msg.phase_id] = [];
    data[msg.phase_id].push({ msgId: msg.id, preview: msgPreviewMap[msg.id], branches });
  }
  return data;
}

async function loadInitialData(oaId: string, workId: string) {
  const user = await getServerAuthUser();
  if (!user) return { workTitle: "", phases: [], transitions: [], messages: [], msgQrData: {} };

  const work = await prisma.work.findUnique({
    where: { id: workId },
    select: { id: true, oaId: true, title: true },
  });
  if (!work || work.oaId !== oaId) return { workTitle: "", phases: [], transitions: [], messages: [], msgQrData: {} };

  if (!isPlatformOwner(user.id)) {
    const member = await getWorkspaceRole(oaId, user.id);
    if (!member || member.status !== "active") {
      return { workTitle: work.title, phases: [], transitions: [], messages: [], msgQrData: {} };
    }
  }

  const [phaseRows, transitionRows, messageRows] = await Promise.all([
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
    prisma.message.findMany({
      where: { workId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const phases = phaseRows.map(formatPhase);
  const transitions = transitionRows.map(formatTransition);
  const messages = messageRows.map(formatMessage);

  return {
    workTitle: work.title,
    phases,
    transitions,
    messages,
    msgQrData: buildMsgQrData(messages, transitions),
  };
}

export default async function ScenarioPage({ params }: PageProps) {
  try {
    const initial = await loadInitialData(params.id, params.workId);
    return (
      <ScenarioClient
        oaId={params.id}
        workId={params.workId}
        initialWorkTitle={initial.workTitle}
        initialPhases={initial.phases}
        initialTransitions={initial.transitions}
        initialMessages={initial.messages}
        initialMsgQrData={initial.msgQrData}
      />
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("[/scenario] Prisma error", err.code, err.meta);
    } else {
      console.error("[/scenario] SSR load failed", err);
    }
    return (
      <ScenarioClient
        oaId={params.id}
        workId={params.workId}
        initialWorkTitle=""
        initialPhases={[]}
        initialTransitions={[]}
        initialMessages={[]}
        initialMsgQrData={{}}
      />
    );
  }
}
