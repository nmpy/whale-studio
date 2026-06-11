"use client";

// src/app/oas/[id]/works/[workId]/messages/new/page.tsx

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTesterRouter as useRouter } from "@/hooks/useTesterRouter";
import { workApi, messageApi, getDevToken, ValidationError } from "@/lib/api-client";
import { useToast } from "@/components/Toast";
import { MessageForm, EMPTY_MESSAGE_FORM, formStateToMsgBody, type MessageFormState } from "../_form";
import { submitChainSave, verifyFailedBanner } from "../_chain-submit";
import { sendSlotsForSave } from "../_chain-edit";

export default function NewMessagePage() {
  const params  = useParams<{ id: string; workId: string }>();
  const oaId    = params.id;
  const workId  = params.workId;
  const router  = useRouter();
  const { showToast } = useToast();

  const [workTitle, setWorkTitle]   = useState("");
  const [submitting, setSubmitting] = useState(false);
  /** 保存後検証で不一致 / 保存失敗時にフォーム上部へ目立つエラーを出す（edit page と同様）。 */
  const [saveError, setSaveError]   = useState<string | null>(null);

  // chain API は headId が必要なため「1通目を一度だけ作成 → 以降は edit と同じ saveChain 経路」に合流させる。
  // ── head 残存方針（chain save 失敗時）────────────────────────────────
  //   作成済みの 1通目は保持する（不正データではなく、作成中の通常メッセージ）。
  //   失敗時は同画面でエラー表示し、再保存すると保持した 1通目を更新する（= 重複作成しない / 危険な自動削除もしない）。
  //   ユーザーが中断した場合は 1通目だけが一覧に残る（編集画面から続きを足す/削除可能）。
  const createdHeadIdRef     = useRef<string | null>(null);
  const headUpdatedAtRef     = useRef<string | null>(null);
  const initialSendSlotIdsRef = useRef<string[]>([]);

  useEffect(() => {
    workApi.get(getDevToken(), workId)
      .then((w) => setWorkTitle(w.title))
      .catch(() => {});
  }, [workId]);

  async function handleSubmit(form: MessageFormState) {
    setSubmitting(true);
    setSaveError(null);
    const token = getDevToken();
    const mainBody = formStateToMsgBody(form);
    console.info("[msg-save] start", JSON.stringify({
      mode:                   createdHeadIdRef.current ? "new-retry" : "new",
      phaseId:                mainBody.phase_id ? String(mainBody.phase_id).slice(0, 8) : null,
      sendSlotCount:          form.additionalMessages.length,
      quickRepliesCount:      form.quick_replies.length,
      freeInputEnabled:       form.free_input_enabled,
      freeInputNextMessageId: form.free_input_next_message_id ? form.free_input_next_message_id.slice(0, 8) : null,
    }));
    try {
      // 1通目を一度だけ作成（失敗時の再保存では作成済み head を再利用＝重複作成しない）。
      let headId = createdHeadIdRef.current;
      if (!headId) {
        const created = await messageApi.create(token, { work_id: workId, ...mainBody });
        headId = created.id;
        createdHeadIdRef.current = headId;
        headUpdatedAtRef.current = (created.updated_at as string | null) ?? null;
      }

      // edit/new 共通: chain spec 構築 → PUT /api/messages/chain 一括保存 → 保存後 verify。
      const result = await submitChainSave(token, {
        workId,
        headId,
        expectedHeadUpdatedAt:      headUpdatedAtRef.current,
        headBody:                   mainBody as Record<string, unknown>,
        headFreeInputEnabled:       !!form.free_input_enabled,
        headFreeInputNextMessageId: form.free_input_next_message_id,
        // まとめ送信廃止: 新規作成は 1通目のみ保存（2通目以降が state に紛れ込んでも丸める保存ガード）。
        sendSlots:                  sendSlotsForSave(true, form.additionalMessages),
        slotMain: {
          work_id:      workId,
          phase_id:     mainBody.phase_id ?? null,
          character_id: mainBody.character_id ?? null,
          kind:         mainBody.kind,
          sort_order:   mainBody.sort_order,
          is_active:    mainBody.is_active,
        },
        initialSendSlotIds:         initialSendSlotIdsRef.current,
        detachedMessageIds:         form.detachedMessageIds ?? [],
      });

      // 楽観ロック基準・削除基準を最新へ更新（再保存で誤判定・二重削除しないように）。
      if (result.kind === "ok" || result.kind === "verify-failed") {
        if (result.headUpdatedAt) headUpdatedAtRef.current = result.headUpdatedAt;
        initialSendSlotIdsRef.current = result.sentChainIds.filter((id) => id !== headId);
      }

      switch (result.kind) {
        case "ok":
          showToast("メッセージを追加しました", "success");
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
          // 1通目は保持済み。修正して再保存すると同じ 1通目を更新する（重複作成しない）。
          setSaveError(
            result.message +
            "\n（1通目は作成済みです。内容を修正して再度保存すると、その1通目を更新します。）",
          );
          showToast(result.message, "error");
          return;
      }
    } catch (err) {
      // head 作成失敗（chain 保存前）。成功トーストは出さない。head は未作成なので残存しない。
      const msg = err instanceof ValidationError
        ? err.toDetailString()
        : err instanceof Error ? err.message : "追加に失敗しました";
      console.error("[msg-save] FAILED step=\"head create\":", msg, err);
      setSaveError(`メッセージの作成に失敗しました: ${msg}`);
      showToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
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
        initialForm={EMPTY_MESSAGE_FORM}
        isNew={true}
        submitting={submitting}
        onSubmit={handleSubmit}
      />
    </>
  );
}
