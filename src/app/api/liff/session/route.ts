// src/app/api/liff/session/route.ts
//
// POST /api/liff/session — LIFF セッション確立（公開・他 /api/liff/* と同様に認証なし）。
//
// LIFF Runtime が liff.init() 後に liff.getAccessToken() を送り、サーバーが LINE 側で
// 検証して「本物の lineUserId」を返す。フロントの userId / displayName は信用しない。
//
// body: { accessToken?: string, idToken?: string, oaId?, workId?, locationId?, pageId? }
// 返却: { ok: true, lineUserId, displayName, oaId, workId, locationId, pageId } | エラー
//
// エラー方針:
//   - ユーザー向け: 一貫した安全な文言 (LIFF_SESSION_USER_ERROR)。
//   - 管理者向けログ: missing_access_token / token verify failure / missing oaId など原因を残す。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLiffAccessToken, LIFF_SESSION_USER_ERROR } from "@/lib/liff/session";

export const dynamic = "force-dynamic";

/** ユーザー向けエラーレスポンス（理由は出さず、ログにのみ残す）。 */
function userError(status: number, logReason: string, ctx: Record<string, unknown> = {}) {
  // 管理者向けログ（原因が追える情報。PII = userId は持たないのでそのまま出してよい）。
  console.warn(`[liff/session] failed reason=${logReason}`, JSON.stringify(ctx));
  return NextResponse.json(
    { success: false, error: { code: "LIFF_SESSION_FAILED", message: LIFF_SESSION_USER_ERROR } },
    { status },
  );
}

export async function POST(req: NextRequest) {
  let body: {
    accessToken?: unknown; idToken?: unknown;
    oaId?: unknown; workId?: unknown; locationId?: unknown; pageId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return userError(400, "invalid_json");
  }

  const accessToken = typeof body.accessToken === "string" ? body.accessToken : null;
  const hasIdTokenOnly = !accessToken && typeof body.idToken === "string";
  const oaIdIn       = typeof body.oaId === "string"       ? body.oaId       : null;
  const workId       = typeof body.workId === "string"     ? body.workId     : null;
  const locationId   = typeof body.locationId === "string" ? body.locationId : null;
  const pageId       = typeof body.pageId === "string"     ? body.pageId     : null;

  if (!accessToken) {
    // idToken のみのケースは、LINE Login チャネル ID を保持していないため正式検証できない。
    // 未検証トークンは信用しない方針 → accessToken を要求する。
    return userError(400, hasIdTokenOnly ? "id_token_only_unsupported" : "missing_access_token");
  }

  // ── LINE 側でアクセストークンを検証して lineUserId を取得 ──
  const verified = await verifyLiffAccessToken(accessToken);
  if (!verified.ok) {
    return userError(401, `token_verify_failure:${verified.reason}`);
  }

  // ── oaId 解決（直接指定 → workId/locationId/pageId から逆引き） ──
  let oaId: string | null = oaIdIn;
  try {
    if (!oaId && workId) {
      const w = await prisma.work.findUnique({ where: { id: workId }, select: { oaId: true } });
      oaId = w?.oaId ?? null;
    }
    if (!oaId && locationId) {
      const loc = await prisma.location.findUnique({ where: { id: locationId }, select: { work: { select: { oaId: true } } } });
      oaId = loc?.work?.oaId ?? null;
    }
    if (!oaId && pageId) {
      const pg = await prisma.liffPageConfig.findUnique({ where: { id: pageId }, select: { work: { select: { oaId: true } } } });
      oaId = pg?.work?.oaId ?? null;
    }
  } catch (err) {
    console.warn("[liff/session] oaId resolve error", err);
    // oaId 解決失敗は致命的ではない（lineUserId は確定済み）。oaId=null で返す。
  }

  if (!oaId) {
    // oaId が解決できなくても lineUserId は有効なので 200 で返す（呼び出し側で扱える）。
    // ただし「対象 OA が分からない」ことはログに残す。
    console.info("[liff/session] missing oaId (lineUserId verified)", JSON.stringify({ workId, locationId, pageId }));
  }

  return NextResponse.json({
    success: true,
    data: {
      ok:          true,
      lineUserId:  verified.lineUserId,
      displayName: verified.displayName,
      oaId,
      workId,
      locationId,
      pageId,
    },
  });
}
