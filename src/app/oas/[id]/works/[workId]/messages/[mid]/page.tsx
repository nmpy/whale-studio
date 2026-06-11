"use client";

// src/app/oas/[id]/works/[workId]/messages/[mid]/page.tsx

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTesterRouter as useRouter } from "@/hooks/useTesterRouter";
import { workApi, messageApi, getDevToken, ValidationError } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import {
  MessageForm,
  msgToFormState,
  formStateToMsgBody,
  msgToAdditionalSlot,
  additionalSlotToMsgBody,
  EMPTY_MESSAGE_FORM,
  type MessageFormState,
  type AdditionalMessageSlot,
} from "../_form";
import { verifyMessageSave } from "../_save-verify";

/** メッセージ ID から next_message_id チェーンを辿り、2 通目以降を AdditionalMessageSlot[] に詰める。
 *  上限 4 件 (= 合計 5 件 = LINE 返信上限) でループを止める。
 *  循環参照防止 + 失敗時はそこまでの結果を返す (= UI に最大限のデータを引き渡す)。
 *
 *  PR #163 (perf): 旧実装は messageApi.get を serial に最大 4 回 await していた
 *  (= chain 長 × ~1-2s の体感遅延)。messageApi.list(workId) で work の全 message を
 *  1 回取得して Map lookup で chain を walk するように変更。backend 追加なし、
 *  response shape 不変。期待短縮: chain 長 2 で ~700ms / chain 長 4 で ~3.7s。
 *
 *  注意: 別 work の id / 削除済み id を辿った場合 (= byId.get が undefined) は
 *  従来の messageApi.get 失敗時と同じく break する。
 */
async function loadAdditionalChain(
  token: string,
  workId: string,
  firstNextId: string | null,
): Promise<AdditionalMessageSlot[]> {
  if (!firstNextId) return [];

  // work 全 message を 1 fetch (with_relations は不要 = msgToAdditionalSlot は relation を使わない)
  let allMessages;
  try {
    allMessages = await messageApi.list(token, workId);
  } catch (err) {
    console.warn(`[EditMessagePage] messageApi.list 失敗 workId=${workId.slice(0, 8)}:`, err);
    return [];
  }
  const byId = new Map(allMessages.map((m) => [m.id, m]));

  const out: AdditionalMessageSlot[] = [];
  let currentId: string | null = firstNextId;
  const seen = new Set<string>();
  for (let i = 0; i < 4 && currentId; i++) {
    if (seen.has(currentId)) {
      console.warn(`[EditMessagePage] チェーン循環参照 (msgId=${currentId.slice(0, 8)}) — 中断`);
      break;
    }
    seen.add(currentId);
    const msg = byId.get(currentId);
    if (!msg) {
      console.warn(`[EditMessagePage] チェーン継続不可 (msgId=${currentId.slice(0, 8)} not found in work ${workId.slice(0, 8)}) — 中断`);
      break;
    }
    out.push(msgToAdditionalSlot(msg));
    currentId = (msg.next_message_id as string | null) ?? null;
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
  /** 保存後検証で不一致 / 保存失敗時に、フォーム上部へ目立つエラーを出す。 */
  const [saveError, setSaveError]       = useState<string | null>(null);

  useEffect(() => {
    const token = getDevToken();
    Promise.all([
      workApi.get(token, workId),
      // GET /api/messages/:id で単件取得（リレーション込み）
      messageApi.get(token, messageId),
    ])
      .then(async ([w, msg]) => {
        setWorkTitle(w.title);
        // 2 通目以降 (next_message_id chain) も並行して読み込む。
        // PR #163: serial messageApi.get → messageApi.list + local walk に変更 (workId 追加)。
        // 失敗しても 1 通目だけで UI を出す (= load 失敗時の degrade)。
        const additional = (msg.next_message_id as string | null)
          ? await loadAdditionalChain(token, workId, msg.next_message_id as string)
          : [];
        const form = msgToFormState(msg);
        setInitialForm({ ...form, additionalMessages: additional });
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [workId, messageId]);

  async function handleSubmit(form: MessageFormState) {
    setSubmitting(true);
    setSaveError(null);
    const token = getDevToken();
    const mainBody = formStateToMsgBody(form);
    let step = "head update";
    // 保存中に「期待 chain（head 含む送信順 messageId 列）」を構築し、保存後検証に使う。
    const expectedChainIds: string[] = [messageId];
    let removedIds: string[] = [];
    console.info("[msg-save] start", JSON.stringify({
      messageId:              messageId.slice(0, 8),
      phaseId:                mainBody.phase_id ? String(mainBody.phase_id).slice(0, 8) : null,
      additionalCount:        form.additionalMessages.length,
      quickRepliesCount:      form.quick_replies.length,
      freeInputEnabled:       form.free_input_enabled,
      freeInputNextMessageId: form.free_input_next_message_id ? form.free_input_next_message_id.slice(0, 8) : null,
    }));
    try {
      await messageApi.update(token, messageId, mainBody);

      // 編集前のチェーン継続 ID 一覧。ループ後に「今回 form から消えた」継続を特定して削除する。
      const oldExistingIds: string[] = (initialForm?.additionalMessages ?? [])
        .map((s) => s.existingId)
        .filter((id): id is string => !!id);

      // 2通目以降のメッセージを作成/更新してチェーン (= 演出設定込みで送る)
      let prevId: string = messageId;
      const keptExistingIds: string[] = [];
      for (let i = 0; i < form.additionalMessages.length; i++) {
        const slot = form.additionalMessages[i];
        const additionalBody = additionalSlotToMsgBody(slot, {
          work_id:      workId,
          phase_id:     mainBody.phase_id ?? null,
          character_id: mainBody.character_id ?? null,
          kind:         mainBody.kind,
          sort_order:   mainBody.sort_order,
          is_active:    mainBody.is_active,
        });
        if (slot.existingId) {
          step = `additional ${i + 1} update`;
          await messageApi.update(token, slot.existingId, additionalBody);
          await messageApi.update(token, prevId, { next_message_id: slot.existingId });
          prevId = slot.existingId;
          keptExistingIds.push(slot.existingId);
          expectedChainIds.push(slot.existingId);
        } else {
          step = `additional ${i + 1} create`;
          const additionalCreated = await messageApi.create(token, additionalBody);
          await messageApi.update(token, prevId, { next_message_id: additionalCreated.id });
          prevId = additionalCreated.id;
          expectedChainIds.push(additionalCreated.id);
        }
      }

      // 新しいチェーンの末尾を null で終端（旧 chain link の残留防止）。
      step = "terminate chain";
      await messageApi.update(token, prevId, { next_message_id: null });

      // 今回 form から取り除かれた継続メッセージを削除（owner 権限必須・失敗しても切り離し済み）。
      step = "delete removed slots";
      removedIds = oldExistingIds.filter((id) => !keptExistingIds.includes(id));
      for (const id of removedIds) {
        try {
          await messageApi.delete(token, id);
        } catch (err) {
          console.warn(`[msg-save] removed slot delete failed (権限不足の可能性): id=${id.slice(0, 8)}`, err);
        }
      }

      // ── 保存後の DB 反映検証（再fetch）── no-op/途中失敗/反映漏れを検知し成功扱いにしない
      step = "post-save verify";
      const all = await messageApi.list(token, workId);
      const byId = new Map(all.map((m) => [m.id, m]));
      const headActual = byId.get(messageId);
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
