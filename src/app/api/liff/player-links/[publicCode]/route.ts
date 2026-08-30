// GET /api/liff/player-links/[publicCode]
//   for UZU Pro プレイヤー連携 LIFF ページの初期化用。公開コード(平文トークン)を解決し、
//   LIFF SDK 初期化に必要な liffId と、リンクの粗い状態のみを返す。
//   個人情報・内部ID・予約/チケット情報・他プレイヤー情報・他リンクは一切返さない。
//   存在しない/失効/期限切れの違いから対象データの存在を推測させないため、状態は一般化する。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { resolveUzuProPlayerLink } from "@/lib/uzupro/line-link";

export const dynamic = "force-dynamic";

// 公開コード = base64url トークン（generateTicketToken）。DB アクセス前に形式検証する。
const PUBLIC_CODE_RE = /^[A-Za-z0-9_-]{16,256}$/;

export async function GET(_req: NextRequest, { params }: { params: { publicCode: string } }) {
  try {
    const code = params.publicCode ?? "";
    // 形式不正は DB を触らず一般化した not_found として返す（存在推測防止）。
    if (!PUBLIC_CODE_RE.test(code)) {
      return ok({ state: "not_found", liffId: null });
    }
    const r = await resolveUzuProPlayerLink(prisma, code);
    if (r.kind === "ok") {
      // liffId は公開コード URL に既に露出している公開値。LIFF SDK init に必要。
      return ok({ state: "active", liffId: r.liffId });
    }
    const state = r.kind === "expired" ? "expired" : r.kind === "revoked" ? "revoked" : "not_found";
    return ok({ state, liffId: null });
  } catch (err) {
    return serverError(err);
  }
}
