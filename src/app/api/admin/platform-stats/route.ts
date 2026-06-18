// src/app/api/admin/platform-stats/route.ts
// GET /api/admin/platform-stats — プラットフォーム全体の集計値（アカウント数 / 公開中 / 総作品数 / 総プレイヤー数）
//
// プラットフォームオーナー専用。
// これはプラットフォーム全体の規模感を返す platform-wide stats のため、
// workspace owner / OA owner / member / 一般ユーザーには絶対に取得させない。
//
// withPlatformAdmin は isPlatformOwner || isAnyWorkspaceOwner を許可する汎用管理ガードのため
// ここでは使わず（= workspace owner も通ってしまう）、withAuth 後に isPlatformOwner で厳密に限定する。
// この strict 化は本ルート内に閉じており、withPlatformAdmin 自体の挙動や他の管理機能には影響しない。
// 参考: src/app/api/admin/users/route.ts も同じ理由で同じ idiom を採用している。
//
// 以前は /oas のアカウント一覧上部に出していたが、一般ユーザーには不要かつ
// プラットフォーム規模感に近い情報のため、スタジオ管理（運営オーナー）側へ移動した。

import { prisma } from "@/lib/prisma";
import { ok, forbidden, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";

export const GET = withAuth(async (_req, _ctx, user) => {
  try {
    // platform owner のみ。非オーナー（workspace owner 含む）は 403。
    if (!isPlatformOwner(user.id)) return forbidden();

    const [accountCount, activeCount, totalWorks, totalPlayers] = await Promise.all([
      prisma.oa.count(),
      prisma.oa.count({ where: { publishStatus: "active" } }),
      prisma.work.count(),
      // 総プレイヤー数 = 全作品の userProgress 件数（preview/テスター試遊 = isPreview:true は除外）。
      // 旧 /oas の progress_stats.total 合算（works/route.ts の groupBy where:{isPreview:false}）と
      // 同じ定義に揃えている。ユニークユーザー数ではなく progress レコード件数。
      prisma.userProgress.count({ where: { isPreview: false } }),
    ]);

    return ok({
      account_count: accountCount,
      active_count:  activeCount,
      total_works:   totalWorks,
      total_players: totalPlayers,
    });
  } catch (err) {
    return serverError(err);
  }
});
