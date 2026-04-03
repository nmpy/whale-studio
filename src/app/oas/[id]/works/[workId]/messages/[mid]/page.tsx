"use client";

// src/app/oas/[id]/works/[workId]/messages/[mid]/page.tsx

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTesterRouter as useRouter } from "@/hooks/useTesterRouter";
import { workApi, messageApi, getDevToken, ValidationError } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
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
      // GET /api/messages/:id で単件取得（リレーション込み）
      messageApi.get(token, messageId),
    ])
      .then(([w, msg]) => {
        setWorkTitle(w.title);
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

  // ローディング（MessageForm 内部でも breadcrumb・title を管理するため、
  // ここではシンプルなスケルトンのみ表示）
  if (!initialForm && !loadError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900, margin: "0 auto" }}>
        {/* ページヘッダースケルトン */}
        <div className="page-header">
          <div>
            <div className="skeleton" style={{ width: 320, height: 13, marginBottom: 6 }} />
            <div className="skeleton" style={{ width: 200, height: 22 }} />
          </div>
        </div>
        {/* フォームカードスケルトン */}
        <div className="card">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="form-group">
              <div className="skeleton" style={{ width: 120, height: 13, marginBottom: 6 }} />
              <div className="skeleton" style={{ height: 36, borderRadius: 6 }} />
            </div>
          ))}
        </div>
        <div className="card">
          {[1, 2].map((i) => (
            <div key={i} className="form-group">
              <div className="skeleton" style={{ width: 100, height: 13, marginBottom: 6 }} />
              <div className="skeleton" style={{ height: 80, borderRadius: 6 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div className="page-header">
          <div>
            <h2>メッセージを編集</h2>
          </div>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </div>
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
      messageId={messageId}
    />
  );
}
