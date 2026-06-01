// src/app/admin/policies/page.tsx
//
// 規約管理画面 (Server Component) — 利用規約 / プライバシーポリシーの編集 + 同意履歴閲覧。
// **platform admin only** (= /admin/layout.tsx の guard では workspace owner も通すため、
// 本ページ側で isPlatformOwner を再チェックして workspace owner は /admin に戻す)。

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getServerUser } from "@/lib/supabase/server";
import { isPlatformOwner } from "@/lib/platform-admin";
import {
  getCurrentTermsDocument,
  getCurrentPrivacyPolicyDocument,
} from "@/lib/policy-document";
import { PoliciesClient } from "./_client";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "規約管理 | スタジオ管理",
};

const VERSION_LIMIT = 50;

export default async function PoliciesAdminPage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  // platform admin only
  const user = await getServerUser();
  if (!user || !isPlatformOwner(user.id)) {
    redirect("/admin");
  }

  const tab = searchParams?.tab === "privacy" || searchParams?.tab === "acceptances"
    ? searchParams.tab
    : "terms";

  // 現在公開版 + 既存バージョン一覧 + 同意履歴を並列取得
  const [currentTerms, currentPrivacy, allVersions] = await Promise.all([
    getCurrentTermsDocument(),
    getCurrentPrivacyPolicyDocument(),
    prisma.policyDocumentVersion.findMany({
      orderBy: [{ type: "asc" }, { createdAt: "desc" }],
      take:    VERSION_LIMIT,
    }),
  ]);

  return (
    <PoliciesClient
      initialTab={tab}
      currentTerms={{
        version:     currentTerms.version,
        title:       currentTerms.title,
        body:        currentTerms.body,
        lastUpdated: currentTerms.lastUpdated,
        effectiveAt: currentTerms.effectiveAt,
        publishedAt: currentTerms.publishedAt?.toISOString() ?? null,
        fromDb:      currentTerms.fromDb,
      }}
      currentPrivacy={{
        version:     currentPrivacy.version,
        title:       currentPrivacy.title,
        body:        currentPrivacy.body,
        lastUpdated: currentPrivacy.lastUpdated,
        effectiveAt: currentPrivacy.effectiveAt,
        publishedAt: currentPrivacy.publishedAt?.toISOString() ?? null,
        fromDb:      currentPrivacy.fromDb,
      }}
      versions={allVersions.map((v) => ({
        id:           v.id,
        type:         v.type,
        version:      v.version,
        title:        v.title,
        is_published: v.isPublished,
        published_at: v.publishedAt?.toISOString() ?? null,
        created_at:   v.createdAt.toISOString(),
        updated_at:   v.updatedAt.toISOString(),
      }))}
    />
  );
}
