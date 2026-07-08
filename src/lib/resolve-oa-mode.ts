// src/lib/resolve-oa-mode.ts
//
// /oas トップの導線出し分け用に、対象 OA の運用モード（Oa.mode）を server 側で解決する。
//   - アクセス権のあるユーザーにのみ解決して返す（権限のない OA の mode は露出しない）。
//   - oaId なし / 未ログイン / 有効アクセスなし / 解決失敗 → DEFAULT_OA_MODE（= content・非破壊の安全側）。
//   - 判定は Oa.mode（TEXT）。不正/未設定は normalizeOaMode で content にフォールバック。
// server 専用（getServerUser / getWorkspaceRole / prisma を使う）。client から import しないこと。

import { prisma } from "@/lib/prisma";
import { getServerUser } from "@/lib/supabase/server";
import { getWorkspaceRole } from "@/lib/rbac";
import { normalizeOaMode, DEFAULT_OA_MODE, type OaMode } from "@/lib/oa-mode";

export async function resolveOaMode(oaId: string | undefined): Promise<OaMode> {
  if (!oaId) return DEFAULT_OA_MODE;
  try {
    const user = await getServerUser();
    if (!user) return DEFAULT_OA_MODE;
    const info = await getWorkspaceRole(oaId, user.id);
    if (!info || info.status !== "active") return DEFAULT_OA_MODE;
    const oa = await prisma.oa.findUnique({
      where:  { id: oaId },
      select: { mode: true },
    });
    return normalizeOaMode((oa as { mode?: string | null } | null)?.mode);
  } catch {
    return DEFAULT_OA_MODE; // 解決失敗時は安全側（content・非破壊）
  }
}
