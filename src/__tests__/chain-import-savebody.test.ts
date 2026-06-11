// src/__tests__/chain-import-savebody.test.ts
// 取り込み（A→B）後の「保存 body 構築」経路を実関数で再現し、imported slot が
// chain save body に載るか / planChainSave が ok かを検証する（DB/deploy 不要・pure）。
//
// 本番で A d92b7d68 に B 2f084123(→812c01ac[FI→8bb8b47d]) を末尾取り込みして保存したのに
// 1f0e82d2.next=null のまま（B 未連結）だった事象の切り分け用。
import { describe, it, expect } from "vitest";
import {
  extractImportBlock, importBlockToSlots, insertImportedSlots, type ImportMessage,
} from "@/app/oas/[id]/works/[workId]/messages/_chain-import";
import { msgToAdditionalSlot } from "@/app/oas/[id]/works/[workId]/messages/_form-helpers";
import { buildChainSaveBody, type BuildChainBodyArgs } from "@/app/oas/[id]/works/[workId]/messages/_chain-edit";
import { planChainSave, type ChainSaveSpec, type WorkMessageRef } from "@/lib/chain-plan";

// ending phase の実構造を模した ImportMessage 群
const im = (o: Partial<ImportMessage> & { id: string }): ImportMessage =>
  ({ workId: "w", phaseId: "ending", isActive: true, body: o.id, message_type: "text", sort_order: 0, created_at: "2026-01-01T00:00:00Z", ...o });

const ALL: ImportMessage[] = [
  // A chain
  im({ id: "d92b7d68", next_message_id: "15744551" }),
  im({ id: "15744551", next_message_id: "1f0e82d2" }),
  im({ id: "1f0e82d2", next_message_id: null }),
  // B block（812c01ac は freeInput プロンプト、応答 8bb8b47d）
  im({ id: "2f084123", next_message_id: "812c01ac" }),
  im({ id: "812c01ac", next_message_id: "8bb8b47d", free_input_enabled: true, free_input_next_message_id: "8bb8b47d" }),
  im({ id: "8bb8b47d", next_message_id: null }), // 応答（ブロック外）
];

describe("A→B 取り込み後の保存 body 構築（本番事象の再現）", () => {
  it("imported slot (2f084123 / 812c01ac) が body.slots に existingId 付きで載る", () => {
    // A の load 時 sendSlots（head=d92b7d68 を除く継続 2通）
    const loadedSlots = [
      msgToAdditionalSlot({ id: "15744551", message_type: "text", body: "a2" }),
      msgToAdditionalSlot({ id: "1f0e82d2", message_type: "text", body: "a3" }),
    ];
    // B を末尾取り込み
    const block = extractImportBlock("2f084123", ALL);
    expect(block.blockIds).toEqual(["2f084123", "812c01ac"]);
    expect(block.freeInputResponseId).toBe("8bb8b47d");
    const { slots: importedSlots } = importBlockToSlots(block, ALL);
    expect(importedSlots.map((s) => s.existingId)).toEqual(["2f084123", "812c01ac"]);

    // 末尾 append（appendIndex = 2）
    const combined = insertImportedSlots(loadedSlots, 2, importedSlots);
    expect(combined.map((s) => s.existingId)).toEqual(["15744551", "1f0e82d2", "2f084123", "812c01ac"]);

    // 保存 body 構築
    const args: BuildChainBodyArgs = {
      workId:                     "w",
      headId:                     "d92b7d68",
      expectedHeadUpdatedAt:      null,
      headBody:                   { body: "head", phase_id: "ending" },
      headFreeInputEnabled:       false,
      headFreeInputNextMessageId: "",
      sendSlots:                  combined,
      slotMain: { work_id: "w", phase_id: "ending", character_id: null, kind: "normal", sort_order: 0, is_active: true },
      initialSendSlotIds:         ["15744551", "1f0e82d2"],
      detachedMessageIds:         [],
    };
    const body = buildChainSaveBody(args);

    // ★ ここが核心: body.slots に B の2スロットが existingId(=id) 付きで含まれるか
    expect(body.slots.map((s) => s.id)).toEqual(["15744551", "1f0e82d2", "2f084123", "812c01ac"]);
    expect(body.free_input_response_id).toBe("8bb8b47d");
    // imported 既存 id は removed に入らない
    expect(body.removed_message_ids).toEqual([]);

    // planChainSave が ok（5通・freeInput 末尾）か
    const spec: ChainSaveSpec = {
      headId:               body.head_id,
      headFreeInputEnabled: false,
      sendSlots:            body.slots.map((s) => ({ id: (s.id as string) ?? null, freeInputEnabled: !!s.free_input_enabled })),
      freeInputResponseId:  body.free_input_response_id,
      removedMessageIds:    body.removed_message_ids,
      detachedMessageIds:   body.detached_message_ids,
    };
    const workRefs: WorkMessageRef[] = ALL.map((m) => ({ id: m.id, nextMessageId: m.next_message_id, freeInputNextMessageId: m.free_input_next_message_id, quickReplies: null }));
    const plan = planChainSave(spec, workRefs);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.sendCount).toBe(5);
      expect(plan.freeInputAt).toBe(4); // head(0)+slots(1..4) の末尾
      expect(plan.freeInputResponseId).toBe("8bb8b47d");
    }
  });
});
