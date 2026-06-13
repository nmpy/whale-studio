"use client";

// src/app/oas/[id]/locations/new/page.tsx
// OA レベルのチェックインポイント新規作成。既存 LocationForm を再利用。
// ?workId= があれば対象作品に固定、無ければ作品セレクタで選択してから作成する。
// 作成後は /oas/[id]/locations へ戻る。既存 /api/locations（POST）をそのまま使う。

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { locationApi, workApi, getDevToken } from "@/lib/api-client";
import { LocationForm } from "../../works/[workId]/locations/_form";

export default function OaNewLocationPage() {
  const params = useParams();
  const router = useRouter();
  const oaId = params.id as string;
  const queryWorkId = useSearchParams().get("workId");

  const [works, setWorks] = useState<{ id: string; title: string }[]>([]);
  const [workId, setWorkId] = useState<string>(queryWorkId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    workApi.list(getDevToken(), oaId)
      .then((list) => setWorks(list.map((w) => ({ id: w.id, title: w.title }))))
      .catch(() => {});
  }, [oaId]);

  const handleSubmit = async (formData: Record<string, unknown>) => {
    if (!workId) { setError("作品を選択してください"); return; }
    setSaving(true);
    setError(null);
    try {
      await locationApi.create(getDevToken(), { work_id: workId, ...formData } as Parameters<typeof locationApi.create>[1]);
      router.push(`/oas/${oaId}/locations?workId=${workId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 16px" }}>
      <Breadcrumb
        items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "ロケーション管理", href: `/oas/${oaId}/locations` },
          { label: "新規作成" },
        ]}
      />
      <h1 className="mb-4 font-round text-[clamp(18px,3.5vw,22px)] font-extrabold tracking-[-0.02em] text-ink">チェックインポイントを追加</h1>

      {error && (
        <div className="mb-4 rounded-field border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">{error}</div>
      )}

      {/* 紐づける作品（必須）。LocationForm は workId をキーに transitions / messages を取得するため先に確定させる。 */}
      <div className="mb-4">
        <label className="mb-1 block text-[13px] font-semibold text-ink">紐づける作品<span className="ml-1 text-danger">*</span></label>
        <select
          className="w-full rounded-field border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-brand"
          value={workId}
          onChange={(e) => setWorkId(e.target.value)}
        >
          <option value="">選択してください</option>
          {works.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
        <p className="mt-1 text-[11px] text-ink-3">チェックインポイントは作品に紐づきます（OA 共通は Beacon をご利用ください）。</p>
      </div>

      {workId ? (
        <LocationForm onSubmit={handleSubmit} saving={saving} workId={workId} />
      ) : (
        <div className="rounded-card border border-dashed border-line bg-bg px-4 py-8 text-center text-[13px] text-ink-3">
          作品を選択するとフォームが表示されます。
        </div>
      )}
    </div>
  );
}
