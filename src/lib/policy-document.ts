// src/lib/policy-document.ts
//
// 規約文書 (= 利用規約 / プライバシーポリシー) の現在公開中バージョン取得 helper。
//
// 取得戦略:
//   1. DB の policy_document_versions に isPublished=true の row があればそれを使う。
//   2. なければ既存 constants ファイル (= terms.ts / privacy-policy.ts) に fallback。
//
// この fallback により:
//   - migration 適用直後 (= 公開版 row が無い) でも既存 /terms /privacy /onboarding/terms
//     が壊れない。
//   - 管理画面から公開した瞬間に DB 値に切り替わる。
//   - DB 障害時も constants で表示継続可能。

import { prisma } from "@/lib/prisma";
import type { PolicyDocumentType } from "@prisma/client";
import {
  CURRENT_TERMS_VERSION,
  TERMS_TITLE,
  TERMS_BODY,
} from "@/lib/constants/terms";
import {
  CURRENT_PRIVACY_POLICY_VERSION,
  PRIVACY_POLICY_TITLE,
  PRIVACY_POLICY_BODY,
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_EFFECTIVE_DATE,
} from "@/lib/constants/privacy-policy";

export interface PolicyDocumentSnapshot {
  version:     string;
  title:       string;
  body:        string;
  lastUpdated: string | null;
  effectiveAt: string | null;
  /** DB から取得した場合は publishedAt が入る (= constants fallback 時は null) */
  publishedAt: Date | null;
  /** true = DB / false = constants fallback */
  fromDb: boolean;
}

/** 指定 type の現在公開中バージョンを取得 (= DB → constants fallback)。 */
export async function getCurrentPolicyDocument(
  type: PolicyDocumentType,
): Promise<PolicyDocumentSnapshot> {
  // DB 優先
  try {
    const row = await prisma.policyDocumentVersion.findFirst({
      where:   { type, isPublished: true },
      orderBy: { publishedAt: "desc" },
    });
    if (row) {
      return {
        version:     row.version,
        title:       row.title,
        body:        row.body,
        lastUpdated: row.lastUpdated,
        effectiveAt: row.effectiveAt,
        publishedAt: row.publishedAt,
        fromDb:      true,
      };
    }
  } catch (err) {
    // DB 障害時は constants fallback で継続 (= 公開ページが落ちないように)
    console.warn("[policy-document] DB lookup failed, falling back to constants:", err);
  }

  // constants fallback
  if (type === "TERMS") {
    return {
      version:     CURRENT_TERMS_VERSION,
      title:       TERMS_TITLE,
      body:        TERMS_BODY,
      lastUpdated: null,
      effectiveAt: null,
      publishedAt: null,
      fromDb:      false,
    };
  }
  // PRIVACY_POLICY
  return {
    version:     CURRENT_PRIVACY_POLICY_VERSION,
    title:       PRIVACY_POLICY_TITLE,
    body:        PRIVACY_POLICY_BODY,
    lastUpdated: PRIVACY_POLICY_LAST_UPDATED,
    effectiveAt: PRIVACY_POLICY_EFFECTIVE_DATE,
    publishedAt: null,
    fromDb:      false,
  };
}

export async function getCurrentTermsDocument(): Promise<PolicyDocumentSnapshot> {
  return getCurrentPolicyDocument("TERMS");
}

export async function getCurrentPrivacyPolicyDocument(): Promise<PolicyDocumentSnapshot> {
  return getCurrentPolicyDocument("PRIVACY_POLICY");
}
