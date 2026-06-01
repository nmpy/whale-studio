// src/app/onboarding/terms/page.tsx
// 利用規約 + プライバシーポリシー同意画面 (Server Component)。
//
// Server Component で DB から現在公開中の規約文書を取得し、
// _client.tsx (Client Component) に props で渡して表示・送信を任せる。
//
// - 本文表示: DB の policy_document_versions の isPublished=true 版 / なければ constants fallback
// - 送信: Client 側で POST /api/onboarding/terms/accept + POST /api/onboarding/privacy/accept

import {
  getCurrentTermsDocument,
  getCurrentPrivacyPolicyDocument,
} from "@/lib/policy-document";
import { TermsConsentClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function TermsConsentPage() {
  const [terms, privacy] = await Promise.all([
    getCurrentTermsDocument(),
    getCurrentPrivacyPolicyDocument(),
  ]);

  return (
    <TermsConsentClient
      terms={{
        version: terms.version,
        title:   terms.title,
        body:    terms.body,
      }}
      privacy={{
        version: privacy.version,
        title:   privacy.title,
        body:    privacy.body,
      }}
    />
  );
}
