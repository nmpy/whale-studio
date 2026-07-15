"use client";

// src/app/oas/[id]/locations/[locationId]/page.tsx
// 薄い resolver: locationId → Location.workId を解決し、既存の編集+分析ページ
// /oas/[id]/works/[workId]/locations/[locationId] へリダイレクトする（編集UIは既存を再利用）。
//
// - OA スコープは GET /api/oas/[id]/locations（oaId=[id] に限定して集約）で担保する。
//   一覧に locationId が含まれなければ「このアカウントに属さない」として 404 相当の表示。
// - workId は query ではなく実際の Location.workId を採用する。
// - preview params（previewPlan / previewRole）は redirect 先へ引き継ぐ。
// - 未認証は既存の認証ガード（middleware）が /login へ 307 するためここには到達しない。
// - 公開 LIFF URL / buildLiffCheckinUrl / /api/liff/* は触らない。

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getAuthHeaders } from "@/lib/api-client";
import { withWorkId } from "../../_lib/work-context";

export default function LocationResolverPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const oaId = params.id as string;
  const locationId = params.locationId as string;

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/oas/${oaId}/locations`, { headers: { ...getAuthHeaders() }, cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (!json?.success || !Array.isArray(json.data)) { setError("読み込みに失敗しました"); return; }
        const loc = (json.data as { id: string; work_id: string }[]).find((l) => l.id === locationId);
        if (!loc) { setError("このアカウントに該当するチェックインポイントが見つかりません"); return; }
        // 実際の workId を優先して既存の編集+分析ページへ。
        // 受け取った query param（previewPlan/previewRole/suggested_radius 等）はすべて転送する。
        const qs = searchParams.toString();
        const dest = `/oas/${oaId}/works/${loc.work_id}/locations/${locationId}${qs ? `?${qs}` : ""}`;
        router.replace(dest);
      } catch {
        if (!cancelled) setError("通信エラーが発生しました");
      }
    })();
    return () => { cancelled = true; };
  }, [oaId, locationId, router, searchParams]);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px", textAlign: "center" }}>
      {error ? (
        <>
          <div className="rounded-card border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</div>
          <Link href={withWorkId(`/oas/${oaId}/locations`, searchParams.get("workId"))} className="mt-4 inline-block text-[13px] font-semibold text-brand-ink underline">
            ← 現地トリガーへ戻る
          </Link>
        </>
      ) : (
        <p className="text-[13px] text-ink-3">編集画面を開いています…</p>
      )}
    </div>
  );
}
