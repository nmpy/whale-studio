// src/lib/onboarding-guard.ts
// Server Component から呼び出してオンボード状態に応じた redirect 先を返す helper。
//
// 設計方針:
//   - middleware は DB アクセスを行わない方針なので、ガードはすべて Server Component layout 側で行う。
//   - 既存ユーザー（= WorkspaceMember(role=owner, status=active) を 1 件以上所有）は terms 同意のみ通過すれば従来通り。
//   - ループ防止のため /onboarding/** や /api/** は呼び出し側で除外する（このファイルでは判定のみを返す）。

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getServerUserWithMetadata } from "@/lib/supabase/server";
import {
  getCurrentTermsDocument,
  getCurrentPrivacyPolicyDocument,
} from "@/lib/policy-document";
import { isPlatformOwner } from "@/lib/platform-admin";
import { recordRegistrationConsent, clientIpFromHeaders } from "@/lib/consent";

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
  // 1. 利用規約 / プライバシーポリシー同意チェック (= どちらも platform owner にも適用 / 法的に必須)
  //    現在公開中のバージョン (= DB の policy_document_versions 優先 / なければ constants fallback)
  //    に対する同意があるかを確認する。新しいバージョンを公開すると、既存ユーザーは
  //    そのバージョンへの同意 row が無いため再同意画面に redirect される。
  const [termsDoc, privacyDoc] = await Promise.all([
    getCurrentTermsDocument(),
    getCurrentPrivacyPolicyDocument(),
  ]);
  const [terms, privacy] = await Promise.all([
    prisma.termsAcceptance.findUnique({
      where: { userId_termsVersion: { userId, termsVersion: termsDoc.version } },
    }),
    prisma.privacyPolicyAcceptance.findUnique({
      where: {
        userId_privacyPolicyVersion: {
          userId,
          privacyPolicyVersion: privacyDoc.version,
        },
      },
    }),
  ]);
  if (!terms || !privacy) {
    return { kind: "redirect", to: "/onboarding/terms" };
  }

  // 1.5. (PR #166) Platform owner / 運営者は terms 同意後は無条件通過。
  //   理由: OA の新規追加は platform owner のみ許可される仕様 (`/oas` の
  //   「+ アカウントを追加」ボタンと `/api/oas` POST 参照) のため、
  //   memberships=0 の platform owner も `/oas` に到達できる必要がある。
  //   この bypass がないと onboarding-guard で `/onboarding/line-oa` へ
  //   redirect され、platform owner が操作不能になる。
  if (isPlatformOwner(userId)) {
    return { kind: "ok" };
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
  const user = await getServerUserWithMetadata();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  }

  let state = await getOnboardingState(user.id);

  // メール確認 ON で signUp 直後にセッションが無く同意ログを保存できなかったケースの救済。
  // 初回登録時に同意した情報を user_metadata.registration_consent に載せているので、
  // 同意ゲート未通過（terms へ redirect）かつ metadata がある場合はここで materialize する
  // （UserConsentLog + acceptance を 1 transaction で記録）→ 再判定して二重同意を防ぐ。
  if (state.kind === "redirect" && state.to === "/onboarding/terms") {
    const consent = user.metadata?.registration_consent as
      | { terms_version?: string; privacy_version?: string; agreed_at?: string }
      | undefined;
    if (consent && (consent.terms_version || consent.privacy_version)) {
      try {
        const h = await headers();
        await recordRegistrationConsent({
          userId:         user.id,
          username:       typeof user.metadata?.display_name === "string" ? (user.metadata.display_name as string) : null,
          termsVersion:   consent.terms_version,
          privacyVersion: consent.privacy_version,
          agreedAt:       consent.agreed_at ? new Date(consent.agreed_at) : undefined,
          meta: { ipAddress: clientIpFromHeaders(h), userAgent: h.get("user-agent") },
        });
        state = await getOnboardingState(user.id); // 同意済みになったか再判定
      } catch {
        // materialize 失敗時は従来どおり /onboarding/terms へ誘導（同意は失われない）
      }
    }
  }

  if (state.kind === "redirect") {
    redirect(state.to);
  }
}
