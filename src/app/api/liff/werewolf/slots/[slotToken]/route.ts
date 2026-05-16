// src/app/api/liff/werewolf/slots/[slotToken]/route.ts
//
// プレイヤー側公開 API — QR 経由でアクセスされたとき、その slot の配役情報を返す。
//
// セキュリティ最重要ポイント:
//   ゲーム開始前 (title.isStarted=false) は **cards を返さない**。サーバー側 gating で
//   ネタバレ防止する。クライアント側だけでブロックすると dev tools で覗ける。
//
// ?preview=1:
//   CMS プレビュー用に gate をバイパスしたい用途がある。が、`/liff/r/[slotToken]` を
//   外から開かれた場合に preview=1 で盗み見できるとマズいので、preview=1 は
//   **このエンドポイントでは受け付けない** (= 常に gate を適用)。
//   GM が CMS でカードの中身を確認したい場合は、認証つきの GM API (詳細 GET) を経由する。
//
// 認証:
//   不要 (LIFF 側のため)。token 自体が opaque で、GM が QR 経由で配布するもの。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slotToken: string }> }
) {
  try {
    const { slotToken } = await ctx.params;

    const slot = await prisma.werewolfRoleSlot.findUnique({
      where: { token: slotToken },
      include: {
        title: true,
        cards: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });

    if (!slot) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "配役が見つかりませんでした。URL を再度ご確認ください。" } },
        { status: 404 }
      );
    }

    // サーバー側 gating: ゲーム開始前は cards を返さない。
    const cards = slot.title.isStarted
      ? slot.cards.map((c) => ({
          id:          c.id,
          slot_id:     c.slotId,
          title:       c.title,
          subtitle:    c.subtitle,
          badge_label: c.badgeLabel,
          body:        c.body,
          sort_order:  c.sortOrder,
          created_at:  c.createdAt,
          updated_at:  c.updatedAt,
        }))
      : [];

    return NextResponse.json({
      success: true,
      data: {
        slot_token:   slot.token,
        slot_number:  slot.slotNumber,
        title:        slot.title.title,
        description:  slot.title.description,
        scheduled_at: slot.title.scheduledAt,
        is_started:   slot.title.isStarted,
        cards,
      },
    });
  } catch (err) {
    console.error("[LIFF Werewolf Slot API Error]", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "サーバーエラーが発生しました" } },
      { status: 500 }
    );
  }
}
