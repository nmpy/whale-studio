// src/app/r/[trackingCode]/route.ts
// 計測URL: https://app.whale-studio.app/r/[trackingCode]
// 認証不要。クリックを XPostClickEvent に記録し、遷移先（UTM付きURL優先）へ 302 redirect する。
// X API / スクレイピングは使わない。クリック数は参考値（Bot 混在の可能性あり）。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashIp, clientIpFromHeaders } from "@/lib/x-posts/tracking-server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ trackingCode: string }> }) {
  const { trackingCode } = await ctx.params;
  const fallback = new URL("/", req.url);
  try {
    const post = await prisma.xPost.findUnique({
      where:  { trackingCode },
      select: { id: true, oaId: true, workId: true, generatedUrl: true, linkUrl: true, utmEnabled: true },
    });
    if (!post) return NextResponse.redirect(fallback, 302);

    // 遷移先: UTM 有効かつ generatedUrl があれば UTM 付き、なければ linkUrl。
    const destination = (post.utmEnabled && post.generatedUrl)
      ? post.generatedUrl
      : (post.linkUrl || post.generatedUrl);
    if (!destination) return NextResponse.redirect(fallback, 302);

    // クリックログ（記録の失敗が redirect を止めないよう try/catch）。
    try {
      await prisma.xPostClickEvent.create({
        data: {
          oaId:           post.oaId,
          workId:         post.workId,
          xPostId:        post.id,
          trackingCode,
          destinationUrl: destination,
          referer:        req.headers.get("referer"),
          userAgent:      req.headers.get("user-agent"),
          ipHash:         hashIp(clientIpFromHeaders(req.headers)), // 生IPは保存しない
        },
      });
    } catch (e) {
      console.warn("[/r] click log skipped:", e);
    }

    return NextResponse.redirect(destination, 302);
  } catch (err) {
    console.error("[/r] redirect error:", err);
    return NextResponse.redirect(fallback, 302);
  }
}
