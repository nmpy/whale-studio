"use client";

// src/app/oas/[id]/works/[workId]/messages/[mid]/page.tsx

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTesterRouter as useRouter } from "@/hooks/useTesterRouter";
import { TLink as Link } from "@/components/TLink";
import { workApi, messageApi, getDevToken, ValidationError } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { Breadcrumb } from "@/components/Breadcrumb";
import { MessageForm, msgToFormState, formStateToMsgBody, EMPTY_MESSAGE_FORM, type MessageFormState } from "../_form";

export default function EditMessagePage() {
  const params    = useParams<{ id: string; workId: string; mid: string }>();
  const oaId      = params.id;
  const workId    = params.workId;
  const messageId = params.mid;
  const router    = useRouter();
  const { showToast } = useToast();

  const [workTitle, setWorkTitle]       = useState("");
  const [initialForm, setInitialForm]   = useState<MessageFormState | null>(null);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [deleting, setDeleting]         = useState(false);

  useEffect(() => {
    const token = getDevToken();
    Promise.all([
      workApi.get(token, workId),
      messageApi.list(token, workId, { with_relations: false }) as Promise<import("@/types").Message[]>,
    ])
      .then(([w, list]) => {
        setWorkTitle(w.title);
        const msg = list.find((m) => m.id === messageId);
        if (!msg) {
          setLoadError("メッセージが見つかりません");
          return;
        }
        setInitialForm(msgToFormState(msg));
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [workId, messageId]);

  async function handleSubmit(form: MessageFormState) {
    setSubmitting(true);
    try {
      await messageApi.update(getDevToken(), messageId, formStateToMsgBody(form));
      showToast("メッセージを保存しました", "success");
      router.push(`/oas/${oaId}/works/${workId}/messages`);
    } catch (err) {
      const msg = err instanceof ValidationError
        ? err.toDetailString()
        : err instanceof Error ? err.message : "保存に失敗しました";
      console.error("[EditMessagePage] save error:", msg, err);
      showToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await messageApi.delete(getDevToken(), messageId);
      showToast("メッセージを削除しました", "success");
      router.push(`/oas/${oaId}/works/${workId}/messages`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "削除に失敗しました", "error");
    } finally {
      setDeleting(false);
    }
  }

  const breadcrumb = (
    <Breadcrumb items={[
      { label: "アカウントリスト", href: "/oas" },
      { label: "作品リスト", href: `/oas/${oaId}/works` },
      ...(workTitle ? [{ label: workTitle, href: `/oas/${oaId}/works/${workId}` }] : []),
      { label: "メッセージ・謎", href: `/oas/${oaId}/works/${workId}/messages` },
      { label: "編集" },
    ]} />
  );

  // ローディング
  if (!initialForm && !loadError) {
    return (
      <>
        <div className="page-header">
          <div>{breadcrumb}<h2>メッセージを編集</h2></div>
        </div>
        <div className="card" style={{ maxWidth: 600 }}>
          {[1, 2, 3, 4].map((i) => (
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
          <div>{breadcrumb}<h2>メッセージを編集</h2></div>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  return (
    <MessageForm
      oaId={oaId}
      workId={workId}
      workTitle={workTitle}
      initialForm={initialForm ?? EMPTY_MESSAGE_FORM}
      isNew={false}
      submitting={submitting}
      deleting={deleting}
      onSubmit={handleSubmit}
      onDelete={handleDelete}
    />
  );
}
