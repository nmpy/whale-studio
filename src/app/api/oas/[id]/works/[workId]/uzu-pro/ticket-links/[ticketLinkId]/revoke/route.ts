// src/app/api/oas/[id]/works/[workId]/uzu-pro/ticket-links/[ticketLinkId]/revoke/route.ts
// POST /api/oas/:id/works/:workId/uzu-pro/ticket-links/:ticketLinkId/revoke
//   — チケット連携の解除（status を REVOKED にするだけ。**物理削除しない**）。
//
// 認可: authorizeUzuPro（Work.uzuProEnabled + UzuProGrant + active メンバーの 3 条件）。
//       1 つでも欠ければ存在を露出せず 404（既存 for ウズプロ mutation と同じ方針）。
// テナント境界: 対象 TicketLink は **oaId + workId も where に含めて**照合する。
//       別 OA / 別作品の id を渡されても 1 件も引けない（= 404）。
// クライアント値の不信用: body は受け取らない。oaId / workId は URL params だが
//       authorizeUzuPro を通過した値のみを DB 条件に使い、actorUserId はセッションから取る。
//
// 予約実体（UZU Pro CMS 側の予約）には一切触れない。Whale Studio に予約実体は無い。
// ログ・エラー文言に予約番号 / 氏名 / コードネーム / LINE UID を出さない。

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, notFound, conflict, serverError } from "@/lib/api-response";
import { authorizeUzuPro } from "@/lib/uzupro-auth";
import { revokeTicketLink, recordTicketLinkRevoked } from "@/lib/uzupro/ticket-link-revoke";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; workId: string; ticketLinkId: string } },
) {
  const auth = await authorizeUzuPro(req, params.id, params.workId);
  if (!auth.ok) return auth.response;

  try {
    const outcome = await revokeTicketLink(prisma, {
      ticketLinkId: params.ticketLinkId,
      // 認可を通過した値のみを境界条件に使う。
      oaId: params.id,
      workId: params.workId,
    });

    switch (outcome.kind) {
      case "revoked":
        // 履歴は既存 UzuProActivityLog へ（PII を含めない）。
        // ログ書き込みの失敗で解除自体を巻き戻さないため、更新とは分けて実行する。
        await recordTicketLinkRevoked(prisma, {
          oaId: params.id,
          workId: params.workId,
          actorUserId: auth.user.id,
          ticketLinkId: params.ticketLinkId,
          previousStatus: outcome.previousStatus,
        });
        return ok({ status: "revoked" });

      case "already_revoked":
        // 冪等: 二重送信・再実行でもエラーにしない。
        return ok({ status: "already_revoked" });

      case "invalid_transition":
        return conflict("現在の状態からは解除できません");

      case "not_found":
      default:
        // 別 OA / 別作品 / 存在しない id を区別せず 404（存在を露出しない）。
        return notFound("チケット連携");
    }
  } catch (err) {
    // serverError は内部でログを出すが、ここで予約番号等を足さない。
    return serverError(err);
  }
}
