"use client";

// src/app/oas/[id]/riddles/new/page.tsx
// POST /api/oas/:id/riddles → 謎作成

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { riddleApi, oaApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { RiddleForm, EMPTY_FORM, formStateToBody, type FormState } from "../_form";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { ViewerBanner } from "@/components/PermissionGuard";

export default function NewRiddlePage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const router = useRouter();
  const { showToast } = useToast();

  const { role, canEdit } = useWorkspaceRole(oaId);

  const [oaTitle, setOaTitle]       = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    oaApi.get(getDevToken(), oaId)
      .then((oa) => setOaTitle(oa.title))
      .catch(() => {});
  }, [oaId]);

  async function handleSubmit(form: FormState) {
    setSubmitting(true);
    try {
      await riddleApi.create(getDevToken(), oaId, formStateToBody(form));
      showToast("謎を登録しました", "success");
      router.push(`/oas/${oaId}/riddles`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "登録に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <ViewerBanner role={role} />
      <RiddleForm
        oaId={oaId}
        oaTitle={oaTitle}
        initialForm={EMPTY_FORM}
        isNew={true}
        submitting={submitting}
        onSubmit={handleSubmit}
        canEdit={canEdit}
        canDelete={false}
      />
    </>
  );
}
