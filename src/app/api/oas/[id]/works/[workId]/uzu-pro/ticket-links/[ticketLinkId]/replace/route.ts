// src/app/api/oas/[id]/works/[workId]/uzu-pro/ticket-links/[ticketLinkId]/replace/route.ts
// POST /api/oas/:id/works/:workId/uzu-pro/ticket-links/:ticketLinkId/replace
//   — チケット連携の「内容を修正」（PR-C）。
//
// 修正は既存行の上書きではなく **replacement**（旧を REVOKED + 修正内容で新規作成）。
// 詳細な不変条件は src/lib/uzupro/ticket-link-replace.ts のヘッダを参照。
//
// 認可: authorizeUzuPro（Work.uzuProEnabled + UzuProGrant + active メンバーの 3 条件）。
//       1 つでも欠ければ存在を露出せず 404（既存 for ウズプロ mutation と同じ方針）。
// テナント境界: 対象 TicketLink は oaId + workId も where に含めて照合する。
// クライアント値の不信用: body は **strict schema** で編集内容のみを受け取る。
//       userId / lineUserId / oaId / workId / status / actorUserId 等が混ざっていれば 400 で弾く。
//       oaId / workId は URL params のうち authorizeUzuPro を通過した値のみを DB 条件に使い、
//       actorUserId はセッションから取る。ownership は旧 TicketLink から引き継ぐ。
//
// 原子性: 旧解除・新規作成・メンバー作成・UzuProActivityLog は同一トランザクション。
//       「旧連携だけ無効になって新連携が作れなかった」部分成功を作らない。
// レスポンスに予約番号 / コードネーム / LINE UID / 表示名 / 内部 ID を返さない。
// ログ・エラー文言にも同様に出さない。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { ok, badRequest, notFound, conflict, serverError } from "@/lib/api-response";
import { authorizeUzuPro } from "@/lib/uzupro-auth";
import { replaceTicketLink } from "@/lib/uzupro/ticket-link-replace";
import { MAX_PARTICIPANT_COUNT } from "@/lib/ticket-link/settings";
import { CODE_NAME_MAX_LENGTH } from "@/lib/ticket-link/rules";
import { RESERVATION_NUMBER_MAX_LENGTH } from "@/lib/ticket-link/reservation-number";

export const dynamic = "force-dynamic";

// 受け取るのは編集内容のみ。participantCount は作品設定から解決するため受け取らない。
const bodySchema = z
  .object({
    ticketTypeKey: z.string().min(1).max(200),
    // 生値のまま受け取り、正規化・検証はサーバー側の既存純関数で行う。
    // 全角・空白・ハイフン異体字を含み得るので長さに余裕を持たせる。
    reservationNumber: z.string().min(1).max(RESERVATION_NUMBER_MAX_LENGTH * 4),
    codeNames: z.array(z.string().max(CODE_NAME_MAX_LENGTH * 4)).min(1).max(MAX_PARTICIPANT_COUNT),
  })
  .strict();

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; workId: string; ticketLinkId: string } },
) {
  const auth = await authorizeUzuPro(req, params.id, params.workId);
  if (!auth.ok) return auth.response;

  try {
    const body = bodySchema.parse(await req.json());

    const outcome = await replaceTicketLink({
      ticketLinkId: params.ticketLinkId,
      // 認可を通過した値のみを境界条件に使う。
      oaId: params.id,
      workId: params.workId,
      ticketTypeKey: body.ticketTypeKey,
      reservationNumberInput: body.reservationNumber,
      codeNames: body.codeNames,
      // actor はセッション由来（クライアント値を使わない）。
      actorUserId: auth.user.id,
    });

    switch (outcome.kind) {
      case "replaced":
        // 内部 ID を返さない（一覧は router.refresh() で取り直す）。
        return ok({ status: "replaced" });

      case "no_change":
        // 何も書き込んでいない。エラーではないので 200 で返し、UI 側で案内する。
        return ok({ status: "no_change" });

      case "invalid":
        return badRequest(outcome.message);

      case "reservation_taken":
        return conflict("この予約番号はすでに別の有効な連携で使用されています");

      case "already_revoked":
        return conflict("解除済みの連携は修正できません");

      case "invalid_transition":
        return conflict("現在の状態からは修正できません");

      case "conflict":
        return conflict("他の処理と競合しました。画面を更新して、もう一度お試しください。");

      case "not_found":
      default:
        // 別 OA / 別作品 / 存在しない id を区別せず 404（存在を露出しない）。
        return notFound("チケット連携");
    }
  } catch (err) {
    if (err instanceof ZodError) return badRequest("リクエスト内容が不正です");
    // serverError は内部でログを出すが、ここで予約番号等を足さない。
    return serverError(err);
  }
}
