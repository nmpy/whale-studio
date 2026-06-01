// src/app/admin/privacy-acceptances/page.tsx
//
// 旧 URL の互換性維持: 同意履歴は /admin/policies に統合されたため、
// このパスにアクセスされたら /admin/policies?tab=acceptances へ恒久リダイレクトする。
// platform admin / workspace owner の認可は /admin/policies 側で再確認される。

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function PrivacyAcceptancesAdminPage() {
  redirect("/admin/policies?tab=acceptances");
}
