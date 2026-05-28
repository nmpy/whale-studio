// src/app/page.tsx
// app.whale-studio.app のルート（Server Component）。
//
// 公開 LP は STUDIO 側（whale-studio.app）で運用するため、本アプリの "/" は
// LP ではなく「認証状態に応じた入口」として振る舞う:
//   - 未ログイン  → /login
//   - ログイン済  → /oas（その後 onboarding guard が terms/審査状態で /onboarding/* へ振り分け）

import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";

// 認証状態で遷移先が変わるため毎リクエスト評価する。
export const dynamic = "force-dynamic";

export default async function RootPage() {
  const user = await getServerUser();
  if (user) {
    redirect("/oas");
  }
  redirect("/login");
}
