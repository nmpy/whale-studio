"use client";

// src/app/oas/[id]/works/[workId]/messages/new/page.tsx

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTesterRouter as useRouter } from "@/hooks/useTesterRouter";
import { workApi, messageApi, getDevToken, ValidationError } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { MessageForm, EMPTY_MESSAGE_FORM, formStateToMsgBody, type MessageFormState } from "../_form";

export default function NewMessagePage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const router  = useRouter();
  const { showToast } = useToast();

  const [workTitle, setWorkTitle]   = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    workApi.get(getDevToken(), workId)
      .then((w) => setWorkTitle(w.title))
      .catch(() => {});
  }, [workId]);

  async function handleSubmit(form: MessageFormState) {
    setSubmitting(true);
    try {
      await messageApi.create(getDevToken(), {
        work_id: workId,
        ...formStateToMsgBody(form),
      });
      showToast("メッセージを追加しました", "success");
      router.push(`/oas/${oaId}/works/${workId}/messages`);
    } catch (err) {
      const msg = err instanceof ValidationError
        ? err.toDetailString()
        : err instanceof Error ? err.message : "追加に失敗しました";
      console.error("[NewMessagePage] save error:", msg, err);
      showToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <MessageForm
      oaId={oaId}
      workId={workId}
      workTitle={workTitle}
      initialForm={EMPTY_MESSAGE_FORM}
      isNew={true}
      submitting={submitting}
      onSubmit={handleSubmit}
    />
  );
}
