// src/app/api/oas/[id]/live/sessions/[sessionId]/export/route.ts
// GET — セッション配下の participants を CSV でエクスポート
//
// 認可: live admin 集合
// 出力: UTF-8 BOM 付き CSV (= Excel ダブルクリックで文字化けしない)
//
// 列 (Phase 2-G):
//   session_name / session_starts_at / team_name / reservation_number /
//   display_name / status / current_step / current_phase_name / line_user_id /
//   memo / assigned_actors / active_instruction_count / last_contact_at /
//   created_at / updated_at

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";
import { NATIVE_ORIGIN } from "@/lib/live-origin";
import Papa from "papaparse";

export const dynamic = "force-dynamic";

// Phase 2-G.1: current_step は「Phase.name 優先 / 無ければ legacy free-text」の統合 1 列。
// Phase 2-G 初版で別途出していた current_phase_name 列は廃止。
const CSV_COLUMNS = [
  "session_name",
  "session_starts_at",
  "team_name",
  "reservation_number",
  "display_name",
  "status",
  "current_step",
  "line_user_id",
  "memo",
  "assigned_actors",
  "active_instruction_count",
  "last_contact_at",
  "created_at",
  "updated_at",
] as const;

function formatJst(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
) {
  const auth = await authorizeLive(req, params.id, "read");
  if (!auth.ok) return auth.response;

  const session = await prisma.liveSession.findFirst({
    where:  { id: params.sessionId, oaId: params.id, origin: NATIVE_ORIGIN },
    select: { id: true, name: true, startsAt: true },
  });
  if (!session) return notFound("LiveSession");

  try {
    const [participants, assignments, actors, instructions, lastContacts] = await Promise.all([
      prisma.liveParticipant.findMany({
        where:   { liveSessionId: params.sessionId, origin: NATIVE_ORIGIN },
        orderBy: { createdAt: "asc" },
        include: {
          team:         { select: { name: true } },
          currentPhase: { select: { name: true } },
        },
        take: 2000,
      }),
      prisma.liveAssignment.findMany({
        where:   { liveSessionId: params.sessionId },
        select: { participantId: true, actorId: true },
      }),
      prisma.liveActor.findMany({
        where:   { oaId: params.id },
        select: { id: true, displayName: true },
      }),
      prisma.liveActorInstruction.findMany({
        where:   { liveSessionId: params.sessionId, status: "active" },
        select: { participantId: true },
      }),
      prisma.liveEventLog.groupBy({
        by:    ["participantId"],
        where: {
          liveSessionId: params.sessionId,
          type:          "actor_contacted",
          participantId: { not: null },
        },
        _max: { createdAt: true },
      }),
    ]);

    const actorById = new Map(actors.map((a) => [a.id, a.displayName] as const));
    const assignedActorsByPid = new Map<string, string[]>();
    for (const a of assignments) {
      const list = assignedActorsByPid.get(a.participantId) ?? [];
      const name = actorById.get(a.actorId);
      if (name) list.push(name);
      assignedActorsByPid.set(a.participantId, list);
    }

    const activeInstructionCountByPid = new Map<string, number>();
    for (const i of instructions) {
      if (!i.participantId) continue;
      activeInstructionCountByPid.set(
        i.participantId,
        (activeInstructionCountByPid.get(i.participantId) ?? 0) + 1,
      );
    }

    const lastContactByPid = new Map<string, Date | null>();
    for (const row of lastContacts) {
      if (row.participantId) lastContactByPid.set(row.participantId, row._max.createdAt);
    }

    const rows = participants.map((p) => ({
      session_name:             session.name,
      session_starts_at:        formatJst(session.startsAt),
      team_name:                p.team?.name ?? "",
      reservation_number:       p.reservationNumber ?? "",
      display_name:             p.displayName ?? "",
      status:                   p.status,
      // Phase 2-G.1: Phase.name 優先 / 無ければ legacy free-text
      current_step:             p.currentPhase?.name ?? p.currentStep ?? "",
      line_user_id:             p.lineUserId ?? "",
      memo:                     p.memo ?? "",
      assigned_actors:          (assignedActorsByPid.get(p.id) ?? []).join(" / "),
      active_instruction_count: String(activeInstructionCountByPid.get(p.id) ?? 0),
      last_contact_at:          formatJst(lastContactByPid.get(p.id) ?? null),
      created_at:               formatJst(p.createdAt),
      updated_at:               formatJst(p.updatedAt),
    }));

    const csv = Papa.unparse(rows, { columns: [...CSV_COLUMNS] });
    // UTF-8 BOM 付き (= Excel で文字化けしない)
    const body = "﻿" + csv;

    // ファイル名: live-session-{name}-{YYYYMMDD}.csv (= 日付は startsAt or 現在日)
    const dt = session.startsAt ?? new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    const safeName = (session.name || "session").replace(/[^\w\-]+/g, "_").slice(0, 40);
    const filename = `live-${safeName}-${y}${m}${d}.csv`;

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type":        "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control":       "no-store",
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
