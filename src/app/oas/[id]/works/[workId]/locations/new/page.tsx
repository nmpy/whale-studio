"use client";

// src/app/oas/[id]/works/[workId]/locations/new/page.tsx
// ロケーション作成ページ

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/Breadcrumb";
import { locationApi, getDevToken } from "@/lib/api-client";
import { LocationForm } from "../_form";

export default function NewLocationPage() {
  const params = useParams();
  const router = useRouter();
  const oaId = params.id as string;
  const workId = params.workId as string;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (formData: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const token = getDevToken();
      await locationApi.create(token, {
        work_id: workId,
        ...formData,
      } as Parameters<typeof locationApi.create>[1]);
      router.push(`/oas/${oaId}/works/${workId}/locations`);
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
          { label: "OA一覧", href: "/oas" },
          { label: "作品", href: `/oas/${oaId}` },
          { label: "ロケーション", href: `/oas/${oaId}/works/${workId}/locations` },
          { label: "新規作成" },
        ]}
      />
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>ロケーション作成</h1>
      {error && (
        <div style={{ padding: 12, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, color: "#dc2626", marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}
      <LocationForm onSubmit={handleSubmit} saving={saving} workId={workId} />
    </div>
  );
}
