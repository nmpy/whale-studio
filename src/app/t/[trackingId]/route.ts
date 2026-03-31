// src/app/t/[trackingId]/route.ts
// GET /t/[trackingId]
//
// トラッキングリダイレクトエンドポイント。
// 1. tracking_events にクリックを記録
// 2. ブラウザに _tid cookie を設定（24h）
// 3. targetUrl（+ UTM）へ 302 リダイレクト

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: { trackingId: string } }
) {
  const { trackingId } = params;

  // トラッキングリンクを取得
  const tracking = await prisma.tracking.findUnique({
    where: { trackingId },
  });

  if (!tracking) {
    return new NextResponse("Not found", { status: 404 });
  }

  // IP・UA・Referer を収集
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    null;
  const userAgent = req.headers.get("user-agent") ?? null;
  const referer   = req.headers.get("referer")    ?? null;

  // クリックイベントを非同期で記録（リダイレクト速度に影響させない）
  prisma.trackingEvent
    .create({ data: { trackingId, ip, userAgent, referer } })
    .catch((e) => console.error("[/t] trackingEvent 記録エラー:", e));

  // UTM 付き URL を構築
  let redirectUrl = tracking.targetUrl;
  if (tracking.utmEnabled) {
    const sep = redirectUrl.includes("?") ? "&" : "?";
    redirectUrl +=
      `${sep}utm_source=x&utm_medium=social` +
      `&utm_campaign=tracking_${trackingId}`;
  }

  // レスポンス: 302 リダイレクト + _tid cookie（24h）
  const res = NextResponse.redirect(redirectUrl, { status: 302 });
  res.cookies.set("_tid", trackingId, {
    maxAge:   60 * 60 * 24,
    sameSite: "lax",
    httpOnly: false,
    path:     "/",
  });
  return res;
}
