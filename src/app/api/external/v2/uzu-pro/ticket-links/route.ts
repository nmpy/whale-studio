// GET /api/external/v2/uzu-pro/ticket-links
//   for ウズプロ: UZU Pro CMS の「Whale連携確認」が、Whale Studio 側の確定済みチケット連携を取得する。
//
//   認証: read 用ガード requireExternalApiKey（x-whale-api-key ↔ WHALE_EXTERNAL_API_KEY）+
//         WHALE_EXTERNAL_OA_IDS allowlist（scope.allowsOa）でテナント境界を検証。fail closed。
//
//   返す情報は「予約と LINE を突き合わせるのに必要な最小限」だけ。
//   lineUserId / lineDisplayName / コードネームは CMS 連携に必要なため意図的に含める
//   （認証 + 作品権限を検証済みの UZU Pro CMS にのみ返る）。
//   ESCAPE.ID 由来の本名・購入者名・メールアドレス、OCR 原文、画像、公演会場は **返さない**
//   （そもそも TicketLink に保存していない）。
//   内部主キーのうち外部へ出すのは whaleTicketLinkId（同期結果の宛先）のみ。
//
//   取得条件: 対象作品 / 未同期のみ / 更新日時以降 / カーソルページング / 最大取得件数 / ID 指定。
//
//   ID 指定 (`ids`) について:
//     CMS 側は「一度同期結果を返したが、CMS 内部の事情でまだ解決していない連携」を後から
//     もう一度評価したいことがある（例: 予約データの取込が後から行われた）。
//     同期結果を受け取った連携は uzuSyncedAt が入るため既定 feed からは外れ、
//     差分 feed を先頭から辿る方式では作品の連携が増えるほど目的の 1 件へ届かなくなる。
//     そこで **ID を直接指定して引ける**ようにする。追加パラメータであり、
//     `ids` を送らない既存リクエストの挙動は完全に従来どおり。



import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { requireExternalApiKey } from "@/lib/external-auth";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * `ids` に指定できる最大件数。
 *
 * TicketLink.id は UUID（36 文字）なので `&ids=` を含めて 1 件あたり約 41 文字。
 * 100 件でクエリ文字列は約 4KB で、一般的なリクエストラインの上限（8KB）に対して十分な余裕がある。
 * MAX_LIMIT(200) まで許すと約 8KB になり上限に張り付くため、意図的に低く取る。
 * **無制限にはしない**（1 リクエストの重さを有界に保つ）。
 */
const MAX_IDS = 100;

const querySchema = z.object({
  workId: z.string().min(1).max(100),
  /**
   * 取得対象を ID で限定する（繰り返しクエリ: `?ids=A&ids=B`）。
   * 値の形式は sync-result の `whaleTicketLinkId` と同じ規則に揃える
   * （同じ識別子が両エンドポイントで同じように受理される状態を保つ）。
   */
  ids: z.array(z.string().min(1).max(100)).min(1).max(MAX_IDS).optional(),
  /** true（既定）= 未同期 or 同期後に更新された分のみ返す。 */
  unsyncedOnly: z.enum(["true", "false"]).optional(),
  /** この日時より後に更新されたものだけ返す（ISO8601）。 */
  updatedSince: z.string().datetime({ offset: true }).optional(),
  /** 直前ページ末尾の whaleTicketLinkId。 */
  cursor: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

export async function GET(req: NextRequest) {
  const auth = requireExternalApiKey(req);
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  try {
    const url = new URL(req.url);
    // `ids` は繰り返しクエリ（?ids=A&ids=B）。1 つも無ければ undefined として扱い、
    // 従来どおりの feed 取得になる（空配列を渡して「0 件指定」にはしない）。
    const rawIds = url.searchParams.getAll("ids");
    const params = querySchema.parse({
      workId:       url.searchParams.get("workId") ?? undefined,
      ids:          rawIds.length > 0 ? rawIds : undefined,
      unsyncedOnly: url.searchParams.get("unsyncedOnly") ?? undefined,
      updatedSince: url.searchParams.get("updatedSince") ?? undefined,
      cursor:       url.searchParams.get("cursor") ?? undefined,
      limit:        url.searchParams.get("limit") ?? undefined,
    });
    // 同じ ID を並べても結果は変わらない（重複行を返さない）。上限判定は正規化前の件数で行う
    // ＝ 重複で上限を回避できないようにする。
    const ids = params.ids ? [...new Set(params.ids)] : undefined;

    // work → OA を導出し allowlist を検証。存在秘匿のため未許可/不在は一律 404。
    const work = await prisma.work.findUnique({
      where: { id: params.workId },
      select: { id: true, oaId: true },
    });
    if (!work) return notFound("作品");
    if (!scope.allowsOa(work.oaId)) return notFound("作品");

    const limit = params.limit ?? DEFAULT_LIMIT;
    const unsyncedOnly = params.unsyncedOnly !== "false";

    // REVOKED は同期対象外（運営が無効化した連携を CMS へ流さない）。
    const where: Record<string, unknown> = {
      workId: work.id,
      status: { in: ["PENDING_UZU_BOOKING", "LINKED", "CONFLICT"] },
    };
    if (params.updatedSince) {
      where.updatedAt = { gt: new Date(params.updatedSince) };
    }
    if (unsyncedOnly) {
      // 未同期（uzuSyncedAt = null）のみを対象にする。
      // 「同期後に更新された分」は CMS 側が updatedSince カーソルで拾う。
      where.uzuSyncedAt = null;
    }
    if (ids) {
      // **他の条件は緩めない**。workId・status・unsyncedOnly・updatedSince は
      // そのまま AND される（別作品の ID を渡しても返らない。REVOKED も復活しない）。
      where.id = { in: ids };
    }

    // ID 指定は「この ID を必ず 1 回の応答で受け取る」ための経路なので、
    // 目的の行がページ外へ押し出されないよう **1 ページで返し切る**（MAX_IDS <= MAX_LIMIT）。
    // limit / cursor は ID 指定時には使わない。ids を送らない従来のリクエストは一切変わらない。
    const effectiveLimit = ids ? ids.length : limit;
    const rows = await prisma.ticketLink.findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: effectiveLimit + 1, // 次ページ有無の判定用に 1 件多く取る
      ...(!ids && params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        workId: true,
        lineUserId: true,
        lineDisplayName: true,
        normalizedReservationNumber: true,
        ticketType: true,
        participantCount: true,
        source: true,
        status: true,
        confirmedAt: true,
        updatedAt: true,
        members: {
          orderBy: { memberIndex: "asc" },
          select: { memberIndex: true, codeName: true },
        },
      },
    });

    // ID 指定時は take が ids.length + 1 なので、行数が ids.length を超えることはない
    //（同じ ID は 1 行しか一致しない）＝ hasMore は必ず false になる。
    const hasMore = rows.length > effectiveLimit;
    const page = hasMore ? rows.slice(0, effectiveLimit) : rows;

    const items = page.map((r) => ({
      whaleTicketLinkId: r.id,
      externalWorkId:    r.workId,
      reservationNumber: r.normalizedReservationNumber,
      lineUserId:        r.lineUserId,
      lineDisplayName:   r.lineDisplayName,
      ticketType:        r.ticketType,
      participantCount:  r.participantCount,
      codeNames:         r.members.map((m) => m.codeName),
      source:            r.source,
      status:            r.status,
      confirmedAt:       r.confirmedAt.toISOString(),
      updatedAt:         r.updatedAt.toISOString(),
    }));

    return ok(items, {
      next_cursor: hasMore ? page[page.length - 1]?.id ?? null : null,
      has_more:    hasMore,
      limit:       effectiveLimit,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です");
    console.error("[external/v2/uzu-pro/ticket-links] error:", err);
    return serverError(err);
  }
}
