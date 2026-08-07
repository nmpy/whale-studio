// src/lib/uzupro/ticket-link-revoke.ts
//
// for ウズプロ ＞ チケット連携の「連携を解除」処理。
//
// 方針:
//   - **物理削除しない。** 既存 enum の `REVOKED` へ status を変更するだけ。
//     予約実体（UZU Pro CMS 側）にも一切触れない（そもそも Whale Studio に予約実体は無い）。
//   - テナント境界は **id だけでなく oaId + workId も where に入れて**照合する。
//     クライアントから渡る値は URL の id のみで、oaId / workId はサーバー側の認可済み値を使う。
//   - 既に REVOKED のレコードへの再実行は **冪等**（何も変えず成功扱い）。
//   - 履歴は既存の `UzuProActivityLog` に残す（schema 変更なし）。
//     detail には PII を入れない（件数・状態・遷移元のみ。予約番号・氏名・LINE UID は入れない）。
//   - **status 更新と ActivityLog 作成は同一トランザクションで行う**（revokeTicketLinkAtomic）。
//     ActivityLog を「解除履歴」として正式に使うため、
//     「status だけ REVOKED / 履歴だけ無い」という部分成功を許容しない。
//
// 状態遷移は既存の canTransitionLink に従う。REVOKED は終端のため
// 「REVOKED → REVOKED」は遷移として許可されないが、それは失敗ではなく冪等の成功として扱う。

import { Prisma } from "@prisma/client";
import type { TicketLinkStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canTransitionLink } from "@/lib/ticket-link/rules";
import { recordUzuProActivity } from "@/lib/uzupro/activity";

type Db = Prisma.TransactionClient | typeof prisma;

export type RevokeOutcome =
  /** REVOKED へ変更した。 */
  | { kind: "revoked"; previousStatus: TicketLinkStatus }
  /** 既に REVOKED だった（冪等・変更なし）。 */
  | { kind: "already_revoked" }
  /** 対象が無い / 別 OA・別作品だった。存在を露出しないため呼び出し側は 404 にする。 */
  | { kind: "not_found" }
  /** 現在の状態からは REVOKED へ遷移できない（既存 rules 上は発生しない想定）。 */
  | { kind: "invalid_transition"; currentStatus: TicketLinkStatus };

export interface RevokeInput {
  /** URL 由来。これ単体では対象を確定させない。 */
  ticketLinkId: string;
  /** サーバー側で認可済みの OA。クライアント値を使わないこと。 */
  oaId: string;
  /** サーバー側で認可済みの作品。クライアント値を使わないこと。 */
  workId: string;
}

/**
 * チケット連携を解除する（status を REVOKED にするだけ。DELETE しない）。
 *
 * 呼び出し側で `authorizeUzuPro(req, oaId, workId)` を通し、その **認可済みの oaId / workId** を渡すこと。
 */
export async function revokeTicketLink(db: Db, input: RevokeInput): Promise<RevokeOutcome> {
  const { ticketLinkId, oaId, workId } = input;

  // id 単体ではなく oaId + workId も条件に含める。
  // 別 OA / 別作品の id を渡されても 1 件も引けない（= not_found）。
  const link = await db.ticketLink.findFirst({
    where: { id: ticketLinkId, oaId, workId },
    select: { id: true, status: true },
  });
  if (!link) return { kind: "not_found" };

  // 冪等: 既に解除済みなら何も変えずに成功扱い（再実行で updatedAt を動かさない）。
  if (link.status === "REVOKED") return { kind: "already_revoked" };

  if (!canTransitionLink(link.status, "REVOKED")) {
    return { kind: "invalid_transition", currentStatus: link.status };
  }

  // 更新も同じ境界条件で行う（findFirst と update の間に別 OA へ移ることは無いが、多層防御）。
  const updated = await db.ticketLink.updateMany({
    where: { id: link.id, oaId, workId, status: { not: "REVOKED" } },
    data: { status: "REVOKED" },
  });

  if (updated.count === 0) {
    // count 0 = 「where に一致する行が無かった」だけ。DB エラーは throw されるのでここには来ない。
    // それでも "同時に解除された" と "行が消えた/境界外へ動いた" を取り違えないよう、
    // 最終状態を読み直して判定する（count 0 を無条件に already_revoked としない）。
    const after = await db.ticketLink.findFirst({
      where: { id: link.id, oaId, workId },
      select: { status: true },
    });
    if (!after) return { kind: "not_found" };
    if (after.status === "REVOKED") return { kind: "already_revoked" };
    // REVOKED でないのに更新できていない = 想定外。成功扱いにせず衝突として返す。
    return { kind: "invalid_transition", currentStatus: after.status };
  }

  return { kind: "revoked", previousStatus: link.status };
}

/**
 * 解除の監査ログ（既存 UzuProActivityLog）。
 * **PII を入れない**: 予約番号・氏名・コードネーム・LINE UID は detail に含めない。
 */
export async function recordTicketLinkRevoked(
  db: Db,
  args: { oaId: string; workId: string; actorUserId: string; ticketLinkId: string; previousStatus: TicketLinkStatus },
): Promise<void> {
  await recordUzuProActivity(db, {
    oaId: args.oaId,
    workId: args.workId,
    actorUserId: args.actorUserId,
    action: "ticket_link_revoke",
    targetType: "ticket_link",
    targetId: args.ticketLinkId,
    detail: { from: args.previousStatus, to: "REVOKED" },
  });
}

/**
 * 解除と履歴書き込みを **同一トランザクション**で行う。
 *
 * ActivityLog を解除履歴として正式に使うため、
 * 「status だけ REVOKED になり履歴が残らない」部分成功を作らない。
 * 履歴の作成に失敗した場合はトランザクションごと巻き戻り、status も REVOKED にならない。
 *
 * 冪等性は revokeTicketLink 側の判定をそのまま維持する:
 *   already_revoked / not_found / invalid_transition では **何も書き込まない**（ログも作らない）。
 */
export async function revokeTicketLinkAtomic(
  args: RevokeInput & { actorUserId: string },
): Promise<RevokeOutcome> {
  const { actorUserId, ...input } = args;
  return prisma.$transaction(async (tx) => {
    const outcome = await revokeTicketLink(tx, input);
    if (outcome.kind === "revoked") {
      await recordTicketLinkRevoked(tx, {
        oaId: input.oaId,
        workId: input.workId,
        actorUserId,
        ticketLinkId: input.ticketLinkId,
        previousStatus: outcome.previousStatus,
      });
    }
    return outcome;
  });
}
