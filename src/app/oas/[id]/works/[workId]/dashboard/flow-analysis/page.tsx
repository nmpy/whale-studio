"use client";

// src/app/oas/[id]/works/[workId]/dashboard/flow-analysis/page.tsx
// フロー分析 → オーディエンス（フロータブ）へリダイレクト

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function FlowAnalysisRedirectPage() {
  const params = useParams<{ id: string; workId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/oas/${params.id}/works/${params.workId}/audience?tab=flow`);
  }, [params.id, params.workId, router]);

  return null;
}
