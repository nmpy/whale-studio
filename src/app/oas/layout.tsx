// src/app/oas/layout.tsx
// /oas 配下の Server Component 共通レイアウト。
// 利用規約同意 + OA 連携審査が完了していないユーザーをオンボーディングへリダイレクトする。

import { enforceOnboarding } from "@/lib/onboarding-guard";
import { AdminHelpAiWidget } from "@/components/admin/AdminHelpAiWidget";

export default async function OasLayout({ children }: { children: React.ReactNode }) {
  await enforceOnboarding("/oas");
  // ヘルプAIは feature flag ON のときだけマウント（OFF 時は client JS も含め一切描画しない）。
  // server 専用 env のため client へ露出しない。/liff や platform /admin には出ない（/oas 配下のみ）。
  const helpAiEnabled = process.env.ENABLE_ADMIN_HELP_AI === "true";
  return (
    <>
      {children}
      {helpAiEnabled && <AdminHelpAiWidget />}
    </>
  );
}
