"use client";

// src/app/oas/[id]/works/[workId]/messages/[mid]/page.tsx

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTesterRouter as useRouter } from "@/hooks/useTesterRouter";
import { workApi, messageApi, getDevToken, ValidationError, ConflictError, UnprocessableError } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import {
  MessageForm,
  msgToFormState,
  formStateToMsgBody,
  EMPTY_MESSAGE_FORM,
  type MessageFormState,
} from "../_form";
import { verifyMessageSave } from "../_save-verify";
import { loadChainSplit, buildChainSaveBody, chainErrorToMessage, type ChainMsgRow } from "../_chain-edit";

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
    let step = "build spec";
    console.info("[msg-save] start", JSON.stringify({
      messageId:              messageId.slice(0, 8),
      phaseId:                mainBody.phase_id ? String(mainBody.phase_id).slice(0, 8) : null,
      sendSlotCount:          form.additionalMessages.length,
      quickRepliesCount:      form.quick_replies.length,
      freeInputEnabled:       form.free_input_enabled,
      freeInputNextMessageId: form.free_input_next_message_id ? form.free_input_next_message_id.slice(0, 8) : null,
    }));
    try {
      // chain spec を構築 → PUT /api/messages/chain で transaction 一括保存（部分反映なし）。
      const body = buildChainSaveBody({
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

      step = "saveChain";
      const result = await messageApi.saveChain(token, body);
      const expectedChainIds = result.chain.map((c) => c.id);
      const removedIds = body.removed_message_ids;

      // ── 保存後の DB 反映検証（再fetch）── no-op/反映漏れを検知し成功扱いにしない（PR #246 維持）
      step = "post-save verify";
      const all = await messageApi.list(token, workId);
      const byId = new Map(all.map((m) => [m.id, m]));
      const headActual = byId.get(messageId);
      // 楽観ロック基準を最新へ更新（verify 失敗→修正→再保存で誤って 409 にならないように）。
      if (headActual?.updated_at) headUpdatedAtRef.current = headActual.updated_at as string;
      // 削除済みスロットは sendSlot 基準から除外（再保存時の二重削除/誤判定防止）。
      initialSendSlotIdsRef.current = expectedChainIds.filter((id) => id !== messageId);
      const walked: string[] = [messageId];
      {
        const seen = new Set(walked);
        let cur: string | null = (headActual?.next_message_id as string | null) ?? null;
        while (cur && !seen.has(cur) && walked.length < 12) {
          seen.add(cur);
          walked.push(cur);
          cur = (byId.get(cur)?.next_message_id as string | null) ?? null;
        }
      }
      const verify = verifyMessageSave(
        {
          body:                   mainBody.body ?? null,
          characterId:            mainBody.character_id ?? null,
          quickRepliesJson:       mainBody.quick_replies ? JSON.stringify(mainBody.quick_replies) : null,
          freeInputEnabled:       !!mainBody.free_input_enabled,
          // head 自身の freeInputNext（head が prompt のときのみ応答 id、それ以外は null）。
          // slot が prompt の場合 result.freeInputResponseId は slot 側の応答なので head には使わない。
          freeInputNextMessageId: mainBody.free_input_next_message_id ?? null,
          chainIds:               expectedChainIds,
          removedIds,
        },
        {
          body:                   (headActual?.body as string | null) ?? null,
          characterId:            (headActual?.character_id as string | null) ?? null,
          quickRepliesJson:       headActual?.quick_replies ? JSON.stringify(headActual.quick_replies) : null,
          freeInputEnabled:       !!headActual?.free_input_enabled,
          freeInputNextMessageId: (headActual?.free_input_next_message_id as string | null) ?? null,
          walkedChainIds:         walked,
          existingIds:            all.map((m) => m.id),
        },
      );
      console.info("[msg-save] verify", JSON.stringify({
        ok: verify.ok, mismatches: verify.mismatches,
        sendCount: result.sendCount, exceedsReplyLimit: result.exceedsReplyLimit,
        expectedChain: expectedChainIds.length, walkedChain: walked.length, removed: removedIds.length,
      }));
      if (!verify.ok) {
        setSaveError(
          "保存処理は完了しましたが、内容が DB に反映されているか確認できませんでした。\n" +
          `不一致: ${verify.mismatches.join(" / ")}\n` +
          "お手数ですが、画面を再読み込みして内容をご確認ください（必要なら再保存してください）。",
        );
        showToast("保存内容の DB 反映を確認できませんでした。再読み込みして確認してください。", "error");
        return; // 成功扱いにしない・一覧へ遷移しない
      }

      showToast("メッセージを保存しました", "success");
      router.push(`/oas/${oaId}/works/${workId}/messages`);
    } catch (err) {
      // 409（楽観ロック競合）/ 422（ドメイン違反）は専用文言でバナー表示。成功トースト・遷移はしない。
      if (err instanceof ConflictError) {
        const m = chainErrorToMessage("CONFLICT", err.message);
        console.warn("[msg-save] CONFLICT(409):", err.message);
        setSaveError(m);
        showToast("他の編集と競合しました。再読み込みしてください。", "error");
        return;
      }
      if (err instanceof UnprocessableError) {
        const m = chainErrorToMessage(err.code, err.message);
        console.warn(`[msg-save] UNPROCESSABLE(422) code=${err.code}:`, err.message);
        setSaveError(m);
        showToast(m, "error");
        return;
      }
      const msg = err instanceof ValidationError
        ? err.toDetailString()
        : err instanceof Error ? err.message : "保存に失敗しました";
      console.error(`[msg-save] FAILED step="${step}":`, msg, err);
      setSaveError(`保存に失敗しました（処理: ${step}）: ${msg}`);
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
