// src/app/admin/layout.tsx
// 管理者エリア共通レイアウト（Server Component）
//
// セキュリティ要件:
//   - サーバーサイドで認証 + プラットフォームオーナー判定を行う
//   - 未認証 → /login?next=/admin にリダイレクト
//   - 認証済みだが非オーナー → /oas にリダイレクト（403 より UX 優先）
//   - クライアントサイドのみのガードは useEffect バイパス可能なため使わない
//
// Note: usePathname を使うサイドバーは Client Component (_components/AdminSidebar) に分離済み
import { isAnyWorkspaceOwner } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { isPlatformOwner } from "@/lib/platform-admin";
import { AdminSidebar } from "./_components/AdminSidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ── サーバーサイド認証チェック ─────────────────────────────────────
  const user = await getServerUser();

  if (!user) {
    // 未認証 → ログインページへ（ログイン後に /admin/... へ戻れるよう next= 付き）
    redirect("/login?next=/admin/announcements");
  }

  const isPlatform = isPlatformOwner(user.id);
  const isWorkspaceOwner = await isAnyWorkspaceOwner(user.id);

  if (!isPlatform && !isWorkspaceOwner) {
  redirect("/oas");
  }

  // ── オーナー確認済み: レイアウトをレンダー ───────────────────────
  return (
    <div
      style={{
        display:    "flex",
        gap:        24,
        minHeight:  "calc(100vh - 64px)",
        alignItems: "flex-start",
      }}
    >
      {/* ── サイドバー（Client Component: usePathname 使用） ── */}
      <AdminSidebar />

      {/* ── メインコンテンツ ── */}
      <div style={{ flex: 1, minWidth: 0, paddingTop: 8 }}>
        {children}
      </div>
    </div>
  );
}
