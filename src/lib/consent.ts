// src/lib/consent.ts
// 同意ログ（UserConsentLog）の記録ヘルパー。
//
// 設計方針:
//   - 利用規約 / プライバシーポリシーへの同意を監査ログ（誰が・いつ・どの版に・どこから）として残す。
//   - 同時に、既存のオンボーディング同意ゲート（TermsAcceptance / PrivacyPolicyAcceptance）も
//     満たすように upsert する → 登録時に同意したユーザーは /onboarding/terms を再要求されない。
//   - バージョンは既存の CURRENT_TERMS_VERSION / CURRENT_PRIVACY_POLICY_VERSION を再利用する
//     （別の定数を導入すると同意ゲートの版チェックと食い違い、再同意ループになるため）。
//   - userId は Supabase auth.users.id を文字列で保持（他テーブルと同方針で Prisma relation は張らない）。

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { CURRENT_TERMS_VERSION } from "@/lib/constants/terms";
import { CURRENT_PRIVACY_POLICY_VERSION } from "@/lib/constants/privacy-policy";

export const CONSENT_TYPE = {
  TERMS: "terms",
  PRIVACY_POLICY: "privacy_policy",
} as const;
export type ConsentType = (typeof CONSENT_TYPE)[keyof typeof CONSENT_TYPE];

export interface ConsentMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

type Db = Prisma.TransactionClient | typeof prisma;

/** 該当ポリシーの公開ページ URL（ドキュメント URL 記録用）。 */
export function consentDocumentUrl(consentType: ConsentType): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.trim().replace(/\/$/, "") || "https://app.whale-studio.app";
  return consentType === CONSENT_TYPE.PRIVACY_POLICY ? `${base}/privacy` : `${base}/terms`;
}

/** 同意ログを 1 件追記する。同一 (userId, consentType, documentVersion) のログが既にあればスキップ（冪等）。 */
export async function appendConsentLogOnce(
  db: Db,
  args: { userId: string; consentType: ConsentType; documentVersion: string; meta?: ConsentMeta; agreedAt?: Date },
): Promise<void> {
  const existing = await db.userConsentLog.findFirst({
    where: { userId: args.userId, consentType: args.consentType, documentVersion: args.documentVersion },
    select: { id: true },
  });
  if (existing) return;
  await db.userConsentLog.create({
    data: {
      userId:          args.userId,
      consentType:     args.consentType,
      documentVersion: args.documentVersion,
      documentUrl:     consentDocumentUrl(args.consentType),
      ipAddress:       args.meta?.ipAddress ?? null,
      userAgent:       args.meta?.userAgent ?? null,
      ...(args.agreedAt ? { agreedAt: args.agreedAt } : {}),
    },
  });
}

/**
 * 初回登録時の同意を一括記録する。
 * 1 つの transaction で:
 *   1. profile を確保（無ければ作成。username があれば採用）
 *   2. 同意ログ（terms / privacy_policy）を追記（冪等）
 *   3. オンボーディング同意ゲート用 TermsAcceptance / PrivacyPolicyAcceptance を upsert
 *
 * → ユーザー(=profile)作成と同意ログ作成が同一 transaction で行われ、
 *    片方だけ成功する中途半端な状態を避ける。
 */
export async function recordRegistrationConsent(args: {
  userId: string;
  username?: string | null;
  termsVersion?: string;
  privacyVersion?: string;
  meta?: ConsentMeta;
  agreedAt?: Date;
}): Promise<void> {
  const termsVersion = args.termsVersion ?? CURRENT_TERMS_VERSION;
  const privacyVersion = args.privacyVersion ?? CURRENT_PRIVACY_POLICY_VERSION;
  const username = args.username?.trim().slice(0, 20) || null;

  await prisma.$transaction(async (tx) => {
    // 1. profile 確保
    const profile = await tx.profile.findUnique({ where: { userId: args.userId }, select: { id: true } });
    if (!profile && username) {
      await tx.profile.create({ data: { userId: args.userId, username } });
    } else if (profile && username) {
      await tx.profile.update({ where: { userId: args.userId }, data: { username } });
    }

    // 2. 同意ログ
    await appendConsentLogOnce(tx, { userId: args.userId, consentType: CONSENT_TYPE.TERMS, documentVersion: termsVersion, meta: args.meta, agreedAt: args.agreedAt });
    await appendConsentLogOnce(tx, { userId: args.userId, consentType: CONSENT_TYPE.PRIVACY_POLICY, documentVersion: privacyVersion, meta: args.meta, agreedAt: args.agreedAt });

    // 3. 同意ゲート用 acceptance（再同意済みなら既存日時を維持）
    await tx.termsAcceptance.upsert({
      where:  { userId_termsVersion: { userId: args.userId, termsVersion } },
      create: { userId: args.userId, termsVersion },
      update: {},
    });
    await tx.privacyPolicyAcceptance.upsert({
      where:  { userId_privacyPolicyVersion: { userId: args.userId, privacyPolicyVersion: privacyVersion } },
      create: { userId: args.userId, privacyPolicyVersion: privacyVersion },
      update: {},
    });
  });
}

/** リクエストヘッダーからクライアント IP を推定（x-forwarded-for の先頭）。 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return headers.get("x-real-ip");
}
