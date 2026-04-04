// src/app/oas/[id]/works/[workId]/phases/page.tsx
// フェーズ管理タブはシナリオフローに統合済みのため、シナリオフローへリダイレクトします。
import { redirect } from "next/navigation";

export default function PhasesRedirectPage({
  params,
}: {
  params: { id: string; workId: string };
}) {
  redirect(`/oas/${params.id}/works/${params.workId}/scenario`);
}
