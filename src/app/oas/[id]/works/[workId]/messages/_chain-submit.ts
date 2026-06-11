// src/app/oas/[id]/works/[workId]/messages/_chain-submit.ts
//
// edit / new ページ共通の「chain spec 構築 → PUT /api/messages/chain → 保存後 verify」フロー。
// 保存ロジックの重複（#6-2b/#6-2c）を解消し、edit/new で spec 生成・freeInput 扱い・
// 409/422 マッピング・保存後 verify をズレなく共有する。
//
// I/O を含むため pure ではない（buildChainSaveBody は _chain-edit.ts 側で単体テスト済み）。

import { messageApi, ConflictError, UnprocessableError, ValidationError } from "@/lib/api-client";
import { verifyMessageSave } from "./_save-verify";
import { buildChainSaveBody, chainErrorToMessage, type BuildChainBodyArgs } from "./_chain-edit";

export type ChainSubmitResult =
  | { kind: "ok"; sentChainIds: string[]; headUpdatedAt: string | null; sendCount: number; exceedsReplyLimit: boolean }
  | { kind: "verify-failed"; mismatches: string[]; sentChainIds: string[]; headUpdatedAt: string | null }
  | { kind: "conflict"; message: string }
  | { kind: "unprocessable"; message: string; code: string }
  | { kind: "error"; message: string };

const WALK_CAP = 12;

/**
 * chain spec を構築して 1 リクエスト保存し、再 fetch で DB 反映を検証する（PR #246 維持）。
 * 例外（409/422/400/その他）は typed result に変換して返す（呼び出し側で UI 反応をマッピング）。
 */
export async function submitChainSave(token: string, buildArgs: BuildChainBodyArgs): Promise<ChainSubmitResult> {
  const headId = buildArgs.headId;
  const workId = buildArgs.workId;
  const headBody = buildArgs.headBody;
  const body = buildChainSaveBody(buildArgs);

  try {
    const result = await messageApi.saveChain(token, body);
    const sentChainIds = result.chain.map((c) => c.id);
    const removedIds = body.removed_message_ids;

    // 保存後の DB 反映検証（再fetch・walk）
    const all = await messageApi.list(token, workId);
    const byId = new Map(all.map((m) => [m.id, m]));
    const headActual = byId.get(headId);
    const headUpdatedAt = (headActual?.updated_at as string | null) ?? null;
    const walked: string[] = [headId];
    {
      const seen = new Set(walked);
      let cur: string | null = (headActual?.next_message_id as string | null) ?? null;
      while (cur && !seen.has(cur) && walked.length < WALK_CAP) {
        seen.add(cur);
        walked.push(cur);
        cur = (byId.get(cur)?.next_message_id as string | null) ?? null;
      }
    }
    const verify = verifyMessageSave(
      {
        body:                   (headBody.body as string | null) ?? null,
        characterId:            (headBody.character_id as string | null) ?? null,
        quickRepliesJson:       headBody.quick_replies ? JSON.stringify(headBody.quick_replies) : null,
        freeInputEnabled:       !!headBody.free_input_enabled,
        // head 自身の freeInputNext（head が prompt のときのみ応答 id、それ以外は null）。
        freeInputNextMessageId: (headBody.free_input_next_message_id as string | null) ?? null,
        chainIds:               sentChainIds,
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
      sentChain: sentChainIds.length, walkedChain: walked.length, removed: removedIds.length,
    }));
    if (!verify.ok) {
      return { kind: "verify-failed", mismatches: verify.mismatches, sentChainIds, headUpdatedAt };
    }
    return { kind: "ok", sentChainIds, headUpdatedAt, sendCount: result.sendCount, exceedsReplyLimit: result.exceedsReplyLimit };
  } catch (err) {
    if (err instanceof ConflictError) {
      console.warn("[msg-save] CONFLICT(409):", err.message);
      return { kind: "conflict", message: chainErrorToMessage("CONFLICT", err.message) };
    }
    if (err instanceof UnprocessableError) {
      console.warn(`[msg-save] UNPROCESSABLE(422) code=${err.code}:`, err.message);
      return { kind: "unprocessable", message: chainErrorToMessage(err.code, err.message), code: err.code };
    }
    const message = err instanceof ValidationError
      ? err.toDetailString()
      : err instanceof Error ? err.message : "保存に失敗しました";
    console.error("[msg-save] FAILED:", message, err);
    return { kind: "error", message };
  }
}

/** 保存後検証の不一致用バナー文言。 */
export function verifyFailedBanner(mismatches: string[]): string {
  return (
    "保存処理は完了しましたが、内容が DB に反映されているか確認できませんでした。\n" +
    `不一致: ${mismatches.join(" / ")}\n` +
    "お手数ですが、画面を再読み込みして内容をご確認ください（必要なら再保存してください）。"
  );
}
