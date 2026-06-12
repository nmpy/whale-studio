// src/app/admin/personal-plan-permissions/page.tsx
// 個人プラン権限ページ (Server Component / platform admin 専用)。
//
// 現時点では個人利用アカウントのプラン・権限を操作する専用管理機能は存在しないため、
// 最小の空状態を表示する（将来、個人プラン変更 / tester plan 管理等を統合する想定）。
//
// セキュリティ: /admin/layout.tsx は platform admin OR workspace owner を許可するが、
//   このページは platform admin 専用。非該当 (workspace owner 含む) は redirect。
//   ナビ導線も platform admin のみ表示（AdminSidebar）。

import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { isPlatformOwner } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

export default async function PersonalPlanPermissionsPage() {
  const user = await getServerUser();
  if (!user) {
    redirect("/login?next=/admin/personal-plan-permissions");
  }
  if (!isPlatformOwner(user.id)) {
    redirect("/oas");
  }

  return (
    <div style={{ maxWidth: 880 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>個人プラン権限</h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20, lineHeight: 1.7 }}>
        個人利用アカウントのプラン・権限を管理します。
      </p>

      <div
        style={{
          border: "1px dashed #e5e7eb",
          borderRadius: 12,
          background: "#f9fafb",
          padding: 24,
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
          個人プラン権限の管理機能は今後追加予定です。
        </p>
        <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.7 }}>
          現在は各OAの設定画面からプラン・利用区分を確認してください。
        </p>
      </div>
    </div>
  );
}
