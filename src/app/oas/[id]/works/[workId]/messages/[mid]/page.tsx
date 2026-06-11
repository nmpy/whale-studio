"use client";

// src/app/oas/[id]/works/[workId]/messages/[mid]/page.tsx

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTesterRouter as useRouter } from "@/hooks/useTesterRouter";
import { workApi, messageApi, getDevToken } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import {
  MessageForm,
  msgToFormState,
  formStateToMsgBody,
  EMPTY_MESSAGE_FORM,
  type MessageFormState,
} from "../_form";
import { loadChainSplit, type ChainMsgRow } from "../_chain-edit";
import { submitChainSave, verifyFailedBanner } from "../_chain-submit";

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
  /** 保存後検証で不一致 / 保存失敗時に、フォーム上部へ目立つエラーを出す。 */
  const [saveError, setSaveError]       = useState<string | null>(null);

  // 保存時に使う load 時点のコンテキスト（楽観ロック・削除判定の基準）。
  const headUpdatedAtRef     = useRef<string | null>(null);
  const initialSendSlotIdsRef = useRef<string[]>([]);

  useEffect(() => {
    const token = getDevToken();
    Promise.all([
      workApi.get(token, workId),
      // GET /api/messages/:id で単件取得（リレーション込み）
      messageApi.get(token, messageId),
    ])
      .then(async ([w, msg]) => {
        setWorkTitle(w.title);
        headUpdatedAtRef.current = (msg.updated_at as string | null) ?? null;

        // chain を runtime 仕様で分割: head→sendSlots（freeInput プロンプト含む末尾で停止）+ 応答(別枠)。
        // legacy（freeInputEnabled=true / next=応答 / freeInputNext=null）も応答として読み替える。
        // work 全 message を 1 fetch して local walk（PR #163 と同方針・backend 追加なし）。
        let allMessages: ChainMsgRow[] = [];
        try {
          allMessages = (await messageApi.list(token, workId)) as unknown as ChainMsgRow[];
        } catch (err) {
          console.warn(`[EditMessagePage] messageApi.list 失敗 workId=${workId.slice(0, 8)}:`, err);
        }
        const split = loadChainSplit(msg as unknown as ChainMsgRow, allMessages);
        initialSendSlotIdsRef.current = split.initialSendSlotIds;

        const form = msgToFormState(msg);
        // head 自体が freeInput プロンプトの legacy（next=応答）では応答 id を select に復元。
        const freeInputNextOverride = split.headFreeInputResponseId ?? form.free_input_next_message_id;
        setInitialForm({
          ...form,
          free_input_next_message_id: freeInputNextOverride,
          additionalMessages: split.sendSlots,
        });
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [workId, messageId]);

  async function handleSubmit(form: MessageFormState) {
    setSubmitting(true);
    setSaveError(null);
    const token = getDevToken();
    const mainBody = formStateToMsgBody(form);
    console.info("[msg-save] start", JSON.stringify({
      mode:                   "edit",
      messageId:              messageId.slice(0, 8),
      phaseId:                mainBody.phase_id ? String(mainBody.phase_id).slice(0, 8) : null,
      sendSlotCount:          form.additionalMessages.length,
      quickRepliesCount:      form.quick_replies.length,
      freeInputEnabled:       form.free_input_enabled,
      freeInputNextMessageId: form.free_input_next_message_id ? form.free_input_next_message_id.slice(0, 8) : null,
    }));
    try {
      // edit/new 共通: chain spec 構築 → PUT /api/messages/chain 一括保存 → 保存後 verify。
      const result = await submitChainSave(token, {
        workId,
        headId:                     messageId,
        expectedHeadUpdatedAt:      headUpdatedAtRef.current,
        headBody:                   mainBody as Record<string, unknown>,
        headFreeInputEnabled:       !!form.free_input_enabled,
        headFreeInputNextMessageId: form.free_input_next_message_id,
        sendSlots:                  form.additionalMessages,
        slotMain: {
          work_id:      workId,
          phase_id:     mainBody.phase_id ?? null,
          character_id: mainBody.character_id ?? null,
          kind:         mainBody.kind,
          sort_order:   mainBody.sort_order,
          is_active:    mainBody.is_active,
        },
        initialSendSlotIds:         initialSendSlotIdsRef.current,
      });

      // 楽観ロック基準・削除基準を最新へ更新（verify 失敗→修正→再保存で誤判定しないように）。
      if (result.kind === "ok" || result.kind === "verify-failed") {
        if (result.headUpdatedAt) headUpdatedAtRef.current = result.headUpdatedAt;
        initialSendSlotIdsRef.current = result.sentChainIds.filter((id) => id !== messageId);
      }

      switch (result.kind) {
        case "ok":
          showToast("メッセージを保存しました", "success");
          router.push(`/oas/${oaId}/works/${workId}/messages`);
          return;
        case "verify-failed":
          setSaveError(verifyFailedBanner(result.mismatches));
          showToast("保存内容の DB 反映を確認できませんでした。再読み込みして確認してください。", "error");
          return;
        case "conflict":
          setSaveError(result.message);
          showToast("他の編集と競合しました。再読み込みしてください。", "error");
          return;
        case "unprocessable":
        case "error":
          setSaveError(result.message);
          showToast(result.message, "error");
          return;
      }
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
    <>
      {saveError && (
        <div style={{ maxWidth: 900, margin: "0 auto 12px" }}>
          <div className="alert alert-error" style={{ whiteSpace: "pre-wrap" }}>{saveError}</div>
        </div>
      )}
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
    </>
  );
}
