// src/lib/onboarding-guard.ts
// Server Component から呼び出してオンボード状態に応じた redirect 先を返す helper。
//
// 設計方針:
//   - middleware は DB アクセスを行わない方針なので、ガードはすべて Server Component layout 側で行う。
//   - 既存ユーザー（= WorkspaceMember(role=owner, status=active) を 1 件以上所有）は terms 同意のみ通過すれば従来通り。
//   - ループ防止のため /onboarding/** や /api/** は呼び出し側で除外する（このファイルでは判定のみを返す）。

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getServerUser } from "@/lib/supabase/server";
import { CURRENT_TERMS_VERSION } from "@/lib/constants/terms";

export type OnboardingRedirect =
  | { kind: "ok" }
  | { kind: "redirect"; to: "/onboarding/terms" | "/onboarding/line-oa" | "/onboarding/review" };

/**
 * 利用規約同意 / OA 連携審査の状態を判定し、ユーザーが通常画面に入って良いかを返す。
 *
 * @returns
 *   - `{ kind: "ok" }`              通常画面に入って良い
 *   - `{ kind: "redirect", to }`    指定パスへリダイレクト
 */
export async function getOnboardingState(userId: string): Promise<OnboardingRedirect> {
  // 1. 利用規約同意チェック
  const terms = await prisma.termsAcceptance.findUnique({
    where: { userId_termsVersion: { userId, termsVersion: CURRENT_TERMS_VERSION } },
  });
  if (!terms) {
    return { kind: "redirect", to: "/onboarding/terms" };
  }

  // 2. 既に OA を所有しているユーザー（= 既存ユーザー or 承認済み）は通過
  const ownsAnyOa = await prisma.workspaceMember.findFirst({
    where: { userId, role: "owner", status: "active" },
    select: { workspaceId: true },
  });
  if (ownsAnyOa) {
    return { kind: "ok" };
  }

  // 3. OA を持たないユーザーは onboarding request のステータスを見る
  const latest = await prisma.oaOnboardingRequest.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { status: true },
  });

  if (!latest) {
    return { kind: "redirect", to: "/onboarding/line-oa" };
  }

  switch (latest.status) {
    case "SUBMITTED":
    case "IN_REVIEW":
      return { kind: "redirect", to: "/onboarding/review" };
    case "DRAFT":
    case "REJECTED":
      return { kind: "redirect", to: "/onboarding/line-oa" };
    case "APPROVED":
      // approved だが Oa が見つからない異常系。再度オンボーディングへ。
      return { kind: "redirect", to: "/onboarding/line-oa" };
    default:
      return { kind: "redirect", to: "/onboarding/line-oa" };
  }
}

/**
 * 保護ルートの Server Component layout から呼ぶ。
 *
 * - 未認証 → /login?next=<currentPath>
 * - terms 未同意 / OA未承認 → /onboarding/* へリダイレクト
 * - それ以外 → そのまま通過
 *
 * リダイレクト時は `next/navigation` の `redirect()` を内部で throw するため、
 * 呼び出し側はこの関数の戻り値を確認する必要はない。
 */
export async function enforceOnboarding(currentPath: string): Promise<void> {
  const user = await getServerUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  }
  const state = await getOnboardingState(user.id);
  if (state.kind === "redirect") {
    redirect(state.to);
  }
}
