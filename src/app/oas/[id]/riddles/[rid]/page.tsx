"use client";

// src/app/oas/[id]/riddles/[rid]/page.tsx
// GET   /api/oas/:id/riddles/:rid → プリフィル
// PATCH /api/oas/:id/riddles/:rid → 更新
// DELETE/api/oas/:id/riddles/:rid → 削除

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { riddleApi, oaApi, getDevToken } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";
import { RiddleForm, riddleToFormState, formStateToBody, EMPTY_FORM, type FormState } from "../_form";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";

export default function EditRiddlePage() {
  const params    = useParams<{ id: string; rid: string }>();
  const oaId      = params.id;
  const riddleId  = params.rid;
  const router    = useRouter();
  const { showToast } = useToast();
  const { role, canEdit, isOwner, isAdmin } = useWorkspaceRole(oaId);

  const [oaTitle, setOaTitle]       = useState("");
  const [initialForm, setInitialForm] = useState<FormState | null>(null);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting]     = useState(false);

  useEffect(() => {
    Promise.all([
      oaApi.get(getDevToken(), oaId),
      riddleApi.get(getDevToken(), oaId, riddleId),
    ])
      .then(([oa, riddle]) => {
        setOaTitle(oa.title);
        setInitialForm(riddleToFormState(riddle));
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [oaId, riddleId]);

  async function handleSubmit(form: FormState) {
    setSubmitting(true);
    try {
      await riddleApi.update(getDevToken(), oaId, riddleId, formStateToBody(form));
      showToast("謎を保存しました", "success");
      router.push(`/oas/${oaId}/riddles`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await riddleApi.delete(getDevToken(), oaId, riddleId);
      showToast("謎を削除しました", "success");
      router.push(`/oas/${oaId}/riddles`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "削除に失敗しました", "error");
    } finally {
      setDeleting(false);
    }
  }

  // ── ローディング ──────────────────────────────────────
  if (!initialForm && !loadError) {
    return (
      <>
        <div className="page-header">
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "謎管理", href: `/oas/${oaId}/riddles` },
            { label: "編集" },
          ]} />
          <h2>謎を編集</h2>
        </div>
        <div className="card" style={{ maxWidth: 640 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="form-group">
              <div className="skeleton" style={{ width: 120, height: 13, marginBottom: 4 }} />
              <div className="skeleton" style={{ height: 36 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="page-header">
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "謎管理", href: `/oas/${oaId}/riddles` },
            { label: "編集" },
          ]} />
          <h2>謎を編集</h2>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  return (
    <>
      <ViewerBanner role={role} />
      <RiddleForm
        oaId={oaId}
        oaTitle={oaTitle}
        initialForm={initialForm ?? EMPTY_FORM}
        isNew={false}
        submitting={submitting}
        deleting={deleting}
        onSubmit={handleSubmit}
        onDelete={handleDelete}
        canEdit={canEdit}
        canDelete={isOwner || isAdmin}
      />
    </>
  );
}
