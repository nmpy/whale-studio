// src/app/oas/[id]/layout.tsx
//
// OA 配下（/oas/[id]/**）共通の薄い layout。作品コンテキストが取れる管理画面にだけ
// 共通サイドバー（WorkManagementShell）を 1 か所で差し込むための client 境界を挿す。
//   - 認証/オンボーディングは親 /oas/layout.tsx（server, enforceOnboarding）と各ページ・
//     各 segment の既存ガード（例: live/layout.tsx）が担保する（ここでは追加しない）。
//   - layout は searchParams を受け取れないため、workId 判定は client 境界（WorkShellBoundary）側で
//     usePathname / useSearchParams を使って行う。
//   - children は Server Component のまま境界に渡る（SSR・データ取得境界を壊さない）。

import WorkShellBoundary from "./_components/WorkShellBoundary";

export default function OaIdLayout({ children }: { children: React.ReactNode }) {
  return <WorkShellBoundary>{children}</WorkShellBoundary>;
}
