// src/app/api/liff/works/[workId]/puzzles/route.ts
// GET /api/liff/works/[workId]/puzzles?line_user_id=... — LIFF「謎・問題」ブロック用公開API（認証不要）
//
// そのプレイヤー（lineUserId）に **実際に出題された** 謎・問題のみを返す。
// 表示対象 = 「送信済みと証明できるもの」のみ:
//   - PuzzleDelivery に記録済み（実送信時に記録）
//   - UserProgress.flags.solvedPuzzles に含まれる（正解＝出題済みの証明）
// ※ currentPhaseId だけでフェーズ内の全 puzzle を出すと「まだ送られていない問題」が混ざるため使わない。
//   未到達/未送信は絶対に出さない（既存ユーザーの過去未回答が出ないのは許容）。
//
// 状態: flags.solvedPuzzles に含まれれば "solved"（正解済み）、それ以外は "delivered"（未回答）。
// ネタバレ防止: answer / correctText / incorrectText / puzzleHintText 等は一切返さない。
// 認可: lineUserId + workId スコープ。他プレイヤーの履歴は混ざらない。
// 未ログイン / 進捗なし / 例外時は 500 にせず空配列を返す。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findWorkByIdOrPublicId } from "@/lib/public-id-resolver";

export const dynamic = "force-dynamic";

function emptyOk() {
  return NextResponse.json({ success: true, data: { puzzles: [] } });
}

/** flags(JSON文字列) から solvedPuzzles を安全に取り出す。parse 失敗 / 非配列は空集合。 */
function parseSolvedPuzzles(flags: string | null | undefined): Set<string> {
  try {
    if (!flags) return new Set();
    const obj = JSON.parse(flags) as unknown;
    const arr = (obj && typeof obj === "object" && "solvedPuzzles" in obj)
      ? (obj as { solvedPuzzles?: unknown }).solvedPuzzles
      : undefined;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
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

    const url = new URL(req.url);
    const lineUserId = url.searchParams.get("line_user_id");
    // PR-PZ2.1: 表示範囲モード。未指定/不正は "delivered"（従来挙動・後方互換）。
    //   all       … 作品内の有効な謎・問題をすべて表示（line_user_id 無しでも可）
    //   delivered … プレイヤーが到達した問題のみ（従来）
    //   solved    … プレイヤーが正解済みの問題のみ
    const modeParam = url.searchParams.get("mode");
    const mode: "all" | "delivered" | "solved" =
      modeParam === "all" || modeParam === "solved" ? modeParam : "delivered";

    // delivered / solved は per-user。line_user_id 無しは従来どおり空（500 にしない）。
    // all は line_user_id 無しでも一覧表示可能（その場合 solved 判定だけ無効＝全て未回答扱い）。
    if (!lineUserId && mode !== "all") return emptyOk();

    // 進捗（正解済み判定用の flags）。line_user_id が無ければ solved は空集合。
    const solvedSet = lineUserId
      ? parseSolvedPuzzles(
          (await prisma.userProgress.findUnique({
            where:  { lineUserId_workId: { lineUserId, workId: work.id } },
            select: { flags: true },
          }))?.flags,
        )
      : new Set<string>();

    // 出題履歴（実送信済み）。delivered モードでのみ必要（all/solved は参照しない）。
    // テーブル未適用でも落ちないよう defensive（degrade して flags のみで動作）。
    const deliveredAtById = new Map<string, Date>();
    if (lineUserId && mode === "delivered") {
      try {
        const deliveries = await prisma.puzzleDelivery.findMany({
          where:   { lineUserId, workId: work.id },
          select:  { messageId: true, deliveredAt: true },
          orderBy: { deliveredAt: "asc" },
        });
        for (const d of deliveries) deliveredAtById.set(d.messageId, d.deliveredAt);
      } catch (e) {
        console.warn("[puzzles API] puzzle_deliveries unavailable (pre-migration?):", e);
      }
    }

    // 表示対象（モード別）。ネタバレ列（answer 等）は一切 select しない（spoiler-safe）。
    //   all       … 有効な puzzle 全件（where で直接）
    //   delivered … 出題履歴 ∪ 正解済み（どちらも送信済みの証明・従来）
    //   solved    … 正解済みのみ
    const baseWhere = { workId: work.id, kind: "puzzle", isActive: true };
    let where: Record<string, unknown> = baseWhere;
    if (mode !== "all") {
      const candidateIds =
        mode === "solved"
          ? Array.from(solvedSet)
          : Array.from(new Set<string>([...deliveredAtById.keys(), ...solvedSet]));
      if (candidateIds.length === 0) return emptyOk();
      where = { ...baseWhere, id: { in: candidateIds } };
    }

    const msgs = await prisma.message.findMany({
      where,
      select: { id: true, body: true, phaseId: true, sortOrder: true },
    });
    if (msgs.length === 0) return emptyOk();

    // phase 名の解決。
    const phaseIds = Array.from(new Set(msgs.map((m) => m.phaseId).filter((x): x is string => !!x)));
    const phases = phaseIds.length
      ? await prisma.phase.findMany({ where: { id: { in: phaseIds } }, select: { id: true, name: true } })
      : [];
    const phaseNameById = new Map(phases.map((p) => [p.id, p.name]));

    const puzzles = msgs
      .map((m) => ({
        id:         m.id,
        body:       m.body ?? "",
        phase_name: m.phaseId ? (phaseNameById.get(m.phaseId) ?? null) : null,
        status:     solvedSet.has(m.id) ? ("solved" as const) : ("delivered" as const),
        _t:         deliveredAtById.get(m.id)?.getTime() ?? Number.MAX_SAFE_INTEGER, // 並び用（履歴なしは末尾）
        _o:         m.sortOrder, // all モードは _t 同値のため sortOrder で安定整列
      }))
      .sort((a, b) => (a._t - b._t) || (a._o - b._o))
      .map(({ _t, _o, ...rest }) => { void _t; void _o; return rest; });

    return NextResponse.json({ success: true, data: { puzzles } });
  } catch (err) {
    console.error("[LIFF puzzles API]", err);
    return emptyOk();
  }
}
