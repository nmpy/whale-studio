// src/app/oas/[id]/settings/liff/page.tsx
// 旧「OA設定 > LIFF設定」ページ。入力項目は「アカウント情報」(/oas/[id]/account) に統合済み。
// 旧 URL への直アクセスはアカウント情報へリダイレクトする（404 にしない）。
import { redirect } from "next/navigation";

export default async function OaLiffSettingsRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/oas/${id}/account`);
}
