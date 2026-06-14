// src/app/oas/[id]/sns/page.tsx
// 旧「SNS投稿管理」(OA単位)。「X投稿管理」として作品（work）単位へ移設したため、
// 旧 URL は作品リストへリダイレクトする（作品を選んで X投稿管理を開く導線に統一）。
// ※ 既存 SNS API / SnsPost テーブルは互換のため残置（破壊しない）。
import { redirect } from "next/navigation";

export default async function SnsRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/oas/${id}/works`);
}
