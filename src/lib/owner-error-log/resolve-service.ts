// src/lib/owner-error-log/resolve-service.ts
// 解決 / 再オープンのサーバー側ロジック（認可はルート側で実施済み前提）。
//   - クライアントの oaId / accountName / isResolved は信用しない。source + sourceId のみ受け取り、
//     対象ログを引いて「実在」「失敗状態」を検証し、oaId は対象ログから導出する。
//   - resolve / reopen は共に idempotent。競合時の unique 制約エラーはユーザーへ出さない。

import { prisma } from "@/lib/prisma";
import type { OwnerErrorLogSource } from "./types";

const SOURCES: OwnerErrorLogSource[] = ["beacon_event", "checkin_attempt", "scheduled_line_message"];

export function isValidSource(s: unknown): s is OwnerErrorLogSource {
  return typeof s === "string" && (SOURCES as string[]).includes(s);
}

/**
 * 対象ログが実在し「失敗状態」であることを検証し、対象ログ由来の oaId を返す。
 * 無効（不在 / 成功状態 / work 不在）なら null。
 */
export async function resolveTargetOa(source: OwnerErrorLogSource, sourceId: string): Promise<{ oaId: string } | null> {
  if (source === "beacon_event") {
    const r = await prisma.beaconEventLog.findUnique({ where: { id: sourceId }, select: { oaId: true, actionStatus: true } });
    if (!r || r.actionStatus !== "failed") return null;
    return { oaId: r.oaId };
  }
  if (source === "checkin_attempt") {
    const r = await prisma.checkinAttempt.findUnique({ where: { id: sourceId }, select: { status: true, workId: true } });
    if (!r || r.status === "success") return null;
    const w = await prisma.work.findUnique({ where: { id: r.workId }, select: { oaId: true } });
    if (!w) return null;
    return { oaId: w.oaId };
  }
  // scheduled_line_message
  const r = await prisma.scheduledLineMessage.findUnique({ where: { id: sourceId }, select: { oaId: true, status: true } });
  if (!r || r.status !== "failed") return null;
  return { oaId: r.oaId };
}

export type ResolveResult =
  | { ok: true; isResolved: true; resolvedAt: string; oaId: string }
  | { ok: false; reason: "invalid" | "not_resolvable" };

/** 解決（idempotent・upsert）。既存の解決情報は保持する。 */
export async function resolveError(source: OwnerErrorLogSource, sourceId: string, userId: string): Promise<ResolveResult> {
  if (!isValidSource(source) || !sourceId) return { ok: false, reason: "invalid" };
  const target = await resolveTargetOa(source, sourceId);
  if (!target) return { ok: false, reason: "not_resolvable" };
  try {
    const row = await prisma.errorLogResolution.upsert({
      where: { source_sourceId: { source, sourceId } },
      create: { source, sourceId, oaId: target.oaId, resolvedAt: new Date(), resolvedByUserId: userId },
      update: {}, // 既に解決済みなら no-op（resolvedAt/By を上書きしない）
    });
    return { ok: true, isResolved: true, resolvedAt: row.resolvedAt.toISOString(), oaId: target.oaId };
  } catch {
    // 競合（P2002 等）: 既存行を読み直して成功扱い（unique エラーをユーザーへ出さない）。
    const existing = await prisma.errorLogResolution.findUnique({ where: { source_sourceId: { source, sourceId } } });
    if (existing) return { ok: true, isResolved: true, resolvedAt: existing.resolvedAt.toISOString(), oaId: existing.oaId };
    return { ok: false, reason: "not_resolvable" };
  }
}

export type ReopenResult =
  | { ok: true; isResolved: false; oaId: string | null }
  | { ok: false; reason: "invalid" };

/** 再オープン（idempotent・対応行を削除）。対象行が無くても成功扱い（未解決状態）。 */
export async function reopenError(source: OwnerErrorLogSource, sourceId: string): Promise<ReopenResult> {
  if (!isValidSource(source) || !sourceId) return { ok: false, reason: "invalid" };
  // 監査用に oaId を取得してから削除。
  const existing = await prisma.errorLogResolution.findUnique({ where: { source_sourceId: { source, sourceId } }, select: { oaId: true } });
  await prisma.errorLogResolution.deleteMany({ where: { source, sourceId } });
  return { ok: true, isResolved: false, oaId: existing?.oaId ?? null };
}
