// src/app/oas/layout.tsx
// /oas 配下の Server Component 共通レイアウト。
// 利用規約同意 + OA 連携審査が完了していないユーザーをオンボーディングへリダイレクトする。

import { enforceOnboarding } from "@/lib/onboarding-guard";

export default async function OasLayout({ children }: { children: React.ReactNode }) {
  await enforceOnboarding("/oas");
  return <>{children}</>;
}
