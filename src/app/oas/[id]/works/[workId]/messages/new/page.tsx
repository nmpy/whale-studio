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
      const mainBody = formStateToMsgBody(form);
      const created = await messageApi.create(getDevToken(), {
        work_id: workId,
        ...mainBody,
      });

      // 2通目以降のメッセージを作成してチェーン
      let prevId: string = created.id;
      for (const slot of form.additionalMessages) {
        const additionalBody = {
          work_id:      workId,
          phase_id:     mainBody.phase_id,
          // スロット個別のキャラクター指定があればそちらを優先、なければ1通目を引き継ぐ
          character_id: slot.character_id || mainBody.character_id,
          kind:         mainBody.kind,
          message_type: slot.message_type,
          body:         slot.message_type === "carousel"
            ? JSON.stringify(slot.carousel_items)
            : slot.message_type === "text" ? (slot.body || undefined) : undefined,
          asset_url:    (slot.message_type === "image" || slot.message_type === "video" || slot.message_type === "voice")
            ? (slot.asset_url || undefined) : undefined,
          notify_text:  slot.message_type !== "text" ? (slot.notify_text || undefined) : undefined,
          lag_ms:       slot.lag_ms,
          sort_order:   mainBody.sort_order,
          is_active:    mainBody.is_active,
        };
        const additionalCreated = await messageApi.create(getDevToken(), additionalBody);
        await messageApi.update(getDevToken(), prevId, { next_message_id: additionalCreated.id });
        prevId = additionalCreated.id;
      }

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
