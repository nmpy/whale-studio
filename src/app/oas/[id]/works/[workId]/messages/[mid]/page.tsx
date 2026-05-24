"use client";

// src/app/oas/[id]/works/[workId]/messages/[mid]/page.tsx

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTesterRouter as useRouter } from "@/hooks/useTesterRouter";
import { workApi, messageApi, getDevToken, ValidationError } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { MessageForm, msgToFormState, formStateToMsgBody, msgToAdditionalSlot, additionalSlotToMsgBody, EMPTY_MESSAGE_FORM, type MessageFormState, type AdditionalMessageSlot } from "../_form";

/** メッセージ ID から next_message_id チェーンを辿り、2 通目以降を AdditionalMessageSlot[] に詰める。
 *  上限 4 件 (= 合計 5 件 = LINE 返信上限) でループを止める。
 *  失敗時はそこまでの結果を返す (= 編集 UI に出すデータを最大限引き渡す) 。 */
async function loadAdditionalChain(
  token: string,
  firstNextId: string | null,
): Promise<AdditionalMessageSlot[]> {
  const out: AdditionalMessageSlot[] = [];
  let currentId: string | null = firstNextId;
  const seen = new Set<string>();
  for (let i = 0; i < 4 && currentId; i++) {
    if (seen.has(currentId)) {
      console.warn(`[EditMessagePage] チェーンに循環参照 (msgId=${currentId.slice(0, 8)}) — 中断`);
      break;
    }
    const fetchingId = currentId;
    seen.add(fetchingId);
    try {
      const msg = await messageApi.get(token, fetchingId);
      out.push(msgToAdditionalSlot(msg));
      currentId = (msg.next_message_id as string | null) ?? null;
    } catch (err) {
      console.warn(`[EditMessagePage] チェーン取得失敗 msgId=${fetchingId.slice(0, 8)}:`, err);
      break;
    }
  }
  return out;
}

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
      .then(async ([w, msg]) => {
        setWorkTitle(w.title);
        // 2 通目以降 (next_message_id チェーン) も並行して読み込む。
        // 失敗しても 1 通目だけで UI を出す。
        const additional = (msg.next_message_id as string | null)
          ? await loadAdditionalChain(token, msg.next_message_id as string)
          : [];
        const form = msgToFormState(msg);
        setInitialForm({ ...form, additionalMessages: additional });
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [workId, messageId]);

  async function handleSubmit(form: MessageFormState) {
    setSubmitting(true);
    try {
      const mainBody = formStateToMsgBody(form);
      await messageApi.update(getDevToken(), messageId, mainBody);

      // 2通目以降のメッセージを作成してチェーン (演出設定込み)
      console.log(`[diag][save] start head=${messageId.slice(0, 8)} additional=${form.additionalMessages.length}`);
      let prevId: string = messageId;
      for (const slot of form.additionalMessages) {
        const additionalBody = additionalSlotToMsgBody(slot, {
          work_id:      workId,
          phase_id:     mainBody.phase_id ?? null,
          character_id: mainBody.character_id ?? null,
          kind:         mainBody.kind,
          sort_order:   mainBody.sort_order,
          is_active:    mainBody.is_active,
        });
        if (slot.existingId) {
          // 既存の追加メッセージを更新
          await messageApi.update(getDevToken(), slot.existingId, additionalBody);
          await messageApi.update(getDevToken(), prevId, { next_message_id: slot.existingId });
          console.log(`[diag][save] linked prev=${prevId.slice(0, 8)} → next=${slot.existingId.slice(0, 8)} (existing)`);
          prevId = slot.existingId;
        } else {
          // 新規追加メッセージを作成
          const additionalCreated = await messageApi.create(getDevToken(), additionalBody);
          await messageApi.update(getDevToken(), prevId, { next_message_id: additionalCreated.id });
          console.log(`[diag][save] linked prev=${prevId.slice(0, 8)} → next=${additionalCreated.id.slice(0, 8)} (newly created)`);
          prevId = additionalCreated.id;
        }
      }
      console.log(`[diag][save] complete chainTail=${prevId.slice(0, 8)}`);

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
