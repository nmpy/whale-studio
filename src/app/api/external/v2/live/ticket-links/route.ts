// /api/external/v2/live/ticket-links
//   v2 = 匿名予約モデル専用（ウズプロCMS 正式 API）。v1 の legacy 契約（reservationNumber/ticketId）とは別バージョン。
//   POST : 匿名連携（ウズプロCMS）の予約枠に対して LIFF URL / トークンを発行する（発行の正本 = live-ticket-mint）。
//   GET  : 予約枠のチケットリンク状態を取得する（平文トークン / hash / 個人情報を返さない）。
//
//   認証:
//     POST → requireExternalWriteApiKey（x-whale-api-key ↔ WHALE_EXTERNAL_WRITE_API_KEY）＝書き込み
//     GET  → requireExternalApiKey（x-whale-api-key ↔ WHALE_EXTERNAL_API_KEY）＝読み取り
//     いずれも WHALE_EXTERNAL_OA_IDS allowlist（scope.allowsOa）でテナント境界を検証。
//
//   新設計: 予約者氏名・メール・ESCAPE.ID チケットID・予約番号・購入日時・チケット種別等の個人情報は
//           受け取らない（strict schema で未知フィールドを 400 拒否）。匿名参照 externalSessionRef /
//           externalBookingRef と capacity(2/4) のみ扱う。
//   セキュリティ: 平文トークンは発行レスポンス URL に一度だけ載る。DB は tokenHash のみ。
//                APIキー / 平文トークン / tokenHash / body 全体はログ・レスポンスへ出さない。
//   再送安全: 同一予約枠は常に最新 1 件だけ有効（旧・有効トークンを失効 → 新規発行）。

import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, conflict, unprocessable, serverError } from "@/lib/api-response";
import { requireExternalApiKey, requireExternalWriteApiKey } from "@/lib/external-auth";
import { getLiffIdForUrlGeneration } from "@/lib/liff/config";
import { resolveTicketExpiresAt, ticketTokenState } from "@/lib/live-ticket-link";
import { findExternalLiveSession } from "@/lib/live-external-session";
import { mintAnonymousTicketLink } from "@/lib/live-ticket-mint";
import { UZU_PRO_ORIGIN } from "@/lib/live-origin";

export const dynamic = "force-dynamic";

// strict(): 個人情報を含む未知フィールドは 400 で拒否。capacity は 2 / 4 のみ許可。
const postSchema = z
  .object({
    workId:             z.string().min(1).max(100),
    externalSessionRef: z.string().min(1).max(200),
    externalBookingRef: z.string().min(1).max(200),
    capacity:           z.union([z.literal(2), z.literal(4)]),
  })
  .strict();

const getSchema = z.object({
  workId:             z.string().min(1).max(100),
  externalSessionRef: z.string().min(1).max(200),
  externalBookingRef: z.string().min(1).max(200),
});

/** work → OA を解決し allowlist を検証（存在秘匿のため未許可/不在は一律 404）。 */
async function resolveWorkOa(workId: string, scope: { allowsOa(oaId: string): boolean }) {
  const work = await prisma.work.findUnique({ where: { id: workId }, select: { id: true, oaId: true } });
  if (!work) return null;
  if (!scope.allowsOa(work.oaId)) return null;
  return work;
}

export async function POST(req: NextRequest) {
  const auth = requireExternalWriteApiKey(req);
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  try {
    const data = postSchema.parse(await req.json());

    const work = await resolveWorkOa(data.workId, scope);
    if (!work) return notFound("作品");

    const oa = await prisma.oa.findUnique({ where: { id: work.oaId }, select: { id: true, liffId: true } });
    if (!oa) return notFound("アカウント");
    const liffId = getLiffIdForUrlGeneration(oa);
    if (!liffId) return unprocessable("このアカウントの LIFF が未設定です", "LIFF_NOT_CONFIGURED");

    // 匿名の公演セッションは事前同期（PUT /sessions）が前提。未同期なら明示エラー。
    const session = await findExternalLiveSession(prisma, {
      oaId: oa.id, workId: work.id, externalSessionRef: data.externalSessionRef,
    });
    if (!session) return conflict("対象の公演セッションが未同期です（先に公演セッションを同期してください）");

    const now = new Date();
    const expiresAt = resolveTicketExpiresAt({ startsAt: session.startsAt, now });

    // team upsert → 旧トークン失効 → 新トークン発行 を 1 トランザクションで（再送で有効 URL が増えない）。
    const minted = await prisma.$transaction((tx) =>
      mintAnonymousTicketLink(tx, {
        oaId: oa.id,
        workId: work.id,
        externalSessionRef: data.externalSessionRef,
        externalBookingRef: data.externalBookingRef,
        liveSessionId: session.id,
        capacity: data.capacity,
        liffId,
        expiresAt,
        now,
      }),
    );

    // 外部契約: 内部主キー（LiveSession/Team/token の id・tokenRecordId）は返さない。匿名 ref と URL のみ。
    return ok({
      externalSessionRef: data.externalSessionRef,
      externalBookingRef: data.externalBookingRef,
      url:                minted.url,
      expiresAt:          minted.expiresAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest(err.errors[0]?.message ?? "入力が不正です");
    return serverError(err);
  }
}

export async function GET(req: NextRequest) {
  const auth = requireExternalApiKey(req);
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  try {
    const url = new URL(req.url);
    const data = getSchema.parse({
      workId:             url.searchParams.get("workId") ?? undefined,
      externalSessionRef: url.searchParams.get("externalSessionRef") ?? undefined,
      externalBookingRef: url.searchParams.get("externalBookingRef") ?? undefined,
    });

    const work = await resolveWorkOa(data.workId, scope);
    if (!work) return notFound("作品");

    const session = await findExternalLiveSession(prisma, {
      oaId: work.oaId, workId: work.id, externalSessionRef: data.externalSessionRef,
    });
    if (!session) return notFound("公演セッション");

    const team = await prisma.liveTeam.findFirst({
      where:  { liveSessionId: session.id, externalBookingRef: data.externalBookingRef, origin: UZU_PRO_ORIGIN },
      select: { id: true, capacity: true },
    });
    if (!team) return notFound("チケットリンク");

    const now = new Date();
    // 有効トークン（未失効・期限内）があれば active。無ければ最新履歴から revoked/expired を判定。origin=UZU_PRO 限定。
    const activeTok = await prisma.liveTicketLinkToken.findFirst({
      where:   { oaId: work.oaId, workId: work.id, origin: UZU_PRO_ORIGIN, externalSessionRef: data.externalSessionRef, externalBookingRef: data.externalBookingRef, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select:  { expiresAt: true },
    });
    let state: "active" | "revoked" | "expired" | "none" = "none";
    let expiresAt: Date | null = null;
    if (activeTok) {
      state = "active";
      expiresAt = activeTok.expiresAt;
    } else {
      const latest = await prisma.liveTicketLinkToken.findFirst({
        where:   { oaId: work.oaId, workId: work.id, origin: UZU_PRO_ORIGIN, externalSessionRef: data.externalSessionRef, externalBookingRef: data.externalBookingRef },
        orderBy: { createdAt: "desc" },
        select:  { expiresAt: true, revokedAt: true },
      });
      if (latest) {
        const s = ticketTokenState(latest, now);
        state = s === "active" ? "active" : s; // active は上で拾うのでここは revoked/expired
        expiresAt = latest.expiresAt;
      }
    }

    // 登録人数は対象 team（UZU_PRO）の LiveParticipant 数（後続 Phase で登録実装。現状は通常 0）。
    const registrationCount = await prisma.liveParticipant.count({ where: { teamId: team.id, origin: UZU_PRO_ORIGIN } });

    // 平文トークン / tokenHash / LINE UID / 氏名 / メール / ESCAPE.ID チケットID は返さない。
    return ok({
      link: {
        externalSessionRef: data.externalSessionRef,
        externalBookingRef: data.externalBookingRef,
        state,
        expiresAt:          expiresAt ? expiresAt.toISOString() : null,
        capacity:           team.capacity ?? null,
        registrationCount,
        sessionStatus:      session.status,
      },
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest(err.errors[0]?.message ?? "入力が不正です");
    return serverError(err);
  }
}
