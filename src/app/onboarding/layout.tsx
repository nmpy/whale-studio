// src/app/onboarding/layout.tsx
// オンボーディング画面共通レイアウト（Server Component）
// - ログイン必須（未認証なら /login へリダイレクト）
// - サイドバーは出さない（オンボード完了前は他のページに遷移しないため）

import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await getServerUser();
  if (!user) {
    redirect("/login?next=/onboarding/terms");
  }

  return (
    <div
      style={{
        minHeight:  "calc(100vh - 64px)",
        maxWidth:   720,
        margin:     "0 auto",
        padding:    "32px 16px 64px",
      }}
    >
      {children}
    </div>
  );
}
