// src/lib/live-external-session.ts
//
// 匿名連携（ウズプロCMS → Whale Studio）用の LiveSession upsert / 参照サービス。
//   - ウズプロCMS が正本として持つ「匿名の公演参照」= externalSessionRef をキーに、
//     Whale Studio 内の LiveSession を冪等に作成／更新する。
//   - 個人情報（氏名・メール・購入情報・チケットID 等）は一切受け取らず・保存しない。
//   - 外部 API route と将来の管理画面の双方から呼べる純サービス（route 間 HTTP はしない）。
//
// status 遷移ルール（§API契約 1）:
//   - 初回作成は draft。
//   - 再送（同一 oaId + workId + externalSessionRef）は日時のみ更新し status は据え置く。
//     → active を draft へ戻さない / ended を無条件で再オープンしない。

import { Prisma, LiveSessionStatus, LiveOrigin } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UZU_PRO_ORIGIN } from "@/lib/live-origin";

type Db = Prisma.TransactionClient | typeof prisma;

export interface UpsertExternalSessionArgs {
  oaId: string;
  workId: string;
  externalSessionRef: string;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface ExternalSessionResult {
  id: string;
  externalSessionRef: string;
  status: LiveSessionStatus;
  origin: LiveOrigin;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * 匿名の公演参照から表示用のセッション名を導出する（個人情報を含めない）。
 * externalSessionRef 自体が匿名の安定 ID なのでそのまま名前に使う。
 */
export function deriveAnonymousSessionName(externalSessionRef: string): string {
  return externalSessionRef;
}

/**
 * 匿名連携の LiveSession を冪等 upsert する。
 * キー = (oaId, workId, externalSessionRef)（複合 unique・原子的 upsert）。
 * update では status を **一切触らない**（active→draft 降格・ended 再オープンを構造的に防ぐ）。
 */
export async function upsertExternalLiveSession(
  db: Db,
  args: UpsertExternalSessionArgs,
): Promise<ExternalSessionResult> {
  const session = await db.liveSession.upsert({
    where: {
      oaId_workId_externalSessionRef: {
        oaId: args.oaId,
        workId: args.workId,
        externalSessionRef: args.externalSessionRef,
      },
    },
    // 再送: 日時のみ更新。status / name は据え置き。
    update: { startsAt: args.startsAt, endsAt: args.endsAt },
    // 初回: draft・origin=UZU_PRO で作成。name は匿名（externalSessionRef ベース）。
    create: {
      oaId: args.oaId,
      workId: args.workId,
      externalSessionRef: args.externalSessionRef,
      origin: UZU_PRO_ORIGIN,
      name: deriveAnonymousSessionName(args.externalSessionRef),
      status: "draft",
      startsAt: args.startsAt,
      endsAt: args.endsAt,
    },
    select: { id: true, externalSessionRef: true, status: true, origin: true, startsAt: true, endsAt: true },
  });
  // 不変条件: native は externalSessionRef を設定しない → 非 null ref の upsert は UZU_PRO のみに一致する。
  // 万一 NATIVE 行に一致した場合は境界違反として拒否（tripwire）。
  if (session.origin !== UZU_PRO_ORIGIN) {
    throw new Error(`[live-external-session] origin boundary violation: matched non-UZU_PRO session for externalSessionRef`);
  }
  return {
    id: session.id,
    externalSessionRef: session.externalSessionRef ?? args.externalSessionRef,
    status: session.status,
    origin: session.origin,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
  };
}

/**
 * 匿名連携キーから LiveSession を引く（発行・状態取得・失効で共用）。
 * テナント境界のため oaId は必ず条件に含める。
 */
export async function findExternalLiveSession(
  db: Db,
  args: { oaId: string; workId: string; externalSessionRef: string },
): Promise<ExternalSessionResult | null> {
  const s = await db.liveSession.findFirst({
    where: {
      oaId: args.oaId,
      workId: args.workId,
      externalSessionRef: args.externalSessionRef,
      origin: UZU_PRO_ORIGIN, // external v2 は UZU_PRO のみを扱う（NATIVE は取得できない）
    },
    select: { id: true, externalSessionRef: true, status: true, origin: true, startsAt: true, endsAt: true },
  });
  if (!s) return null;
  return {
    id: s.id,
    externalSessionRef: s.externalSessionRef ?? args.externalSessionRef,
    status: s.status,
    origin: s.origin,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
  };
}
