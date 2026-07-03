// src/lib/resolve-oa-usage-type.ts
//
// 料金プラン画面の「個人 / 法人」出し分け用に、対象 OA の利用区分を server 側で解決する。
//   - アクセス権のあるユーザーにのみ解決して返す（権限のない OA の usageType は露出しない）。
//   - oaId なし / 未ログイン / 有効アクセスなし / 解決失敗 → null（= 両方表示の安全側）。
//   - 判定は Oa.usageType（BusinessUsageType）。プラン名（Pro Max 等）や作品名では判定しない。
// server 専用（getServerUser / getWorkspaceRole / prisma を使う）。client から import しないこと。

import { prisma } from "@/lib/prisma";
import { getServerUser } from "@/lib/supabase/server";
import { getWorkspaceRole } from "@/lib/rbac";
import type { UsageType } from "@/lib/usage-type";

export async function resolveOaUsageType(
  oaId: string | undefined,
): Promise<UsageType | null> {
  if (!oaId) return null;
  try {
    const user = await getServerUser();
    if (!user) return null;
    const info = await getWorkspaceRole(oaId, user.id);
    // active なアクセス（owner/platform admin 含む）のみ許可。それ以外は露出しない。
    if (!info || info.status !== "active") return null;
    const oa = await prisma.oa.findUnique({
      where:  { id: oaId },
      select: { usageType: true },
    });
    return (oa?.usageType as UsageType | undefined) ?? null;
  } catch {
    return null; // 解決失敗時は安全側（両方表示）
  }
}
