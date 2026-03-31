"use client";

// src/app/oas/[id]/works/[workId]/dashboard/page.tsx
// 旧ダッシュボード → オーディエンスへリダイレクト

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function DashboardRedirectPage() {
  const params = useParams<{ id: string; workId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/oas/${params.id}/works/${params.workId}/audience`);
  }, [params.id, params.workId, router]);

  return null;
}
