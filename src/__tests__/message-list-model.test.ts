/**
 * src/__tests__/message-list-model.test.ts
 *
 * メッセージ一覧 再設計の **表示専用** 分類/警告ロジック。
 * 分類は確実な信号のみ・推測しない（不明は other）。送信/保存/遷移ロジックには非影響。
 */
import { describe, it, expect } from "vitest";
import {
  buildTriggerIndexes, classifyTrigger, getMessageWarnings, isHardWarning,
  TRIGGER_GROUP_ORDER, type TriggerGroupKey,
} from "@/app/oas/[id]/works/[workId]/messages/_message-list-model";
import type { MessageWithRelations } from "@/types";

const mk = (o: Partial<MessageWithRelations> & { id: string }): MessageWithRelations => ({
  kind: "normal", trigger_keyword: null, quick_replies: null,
  ...o,
} as MessageWithRelations);

describe("buildTriggerIndexes — 到達側の逆引き", () => {
  it("QR target_message_id と checkin_trigger_next_message_id を集める（enabled=false の QR は除外）", () => {
    const msgs = [
      mk({ id: "src", quick_replies: [
        { action: "text", label: "A", value: "A", target_message_id: "qrTarget" },
        { action: "text", label: "B", value: "B", target_message_id: "disabledTarget", enabled: false },
      ] as MessageWithRelations["quick_replies"] }),
      mk({ id: "ck-src", checkin_trigger_next_message_id: "ckTarget" } as Partial<MessageWithRelations> & { id: string }),
    ];
    const idx = buildTriggerIndexes(msgs);
    expect(idx.qrTargetIds.has("qrTarget")).toBe(true);
    expect(idx.qrTargetIds.has("disabledTarget")).toBe(false);
    expect(idx.checkinTargetIds.has("ckTarget")).toBe(true);
  });
});

describe("classifyTrigger — 確実な信号のみ・優先順", () => {
  const empty = { qrTargetIds: new Set<string>(), checkinTargetIds: new Set<string>() };

  it("応答: kind=response", () => {
    expect(classifyTrigger(mk({ id: "m", kind: "response" }), empty)).toBe("response");
  });
  it("応答: trigger_keyword あり（kind!=start）", () => {
    expect(classifyTrigger(mk({ id: "m", kind: "normal", trigger_keyword: "ヘルプ" }), empty)).toBe("response");
  });
  it("チェックイン: 到達側（checkinTargetIds）", () => {
    const idx = { qrTargetIds: new Set<string>(), checkinTargetIds: new Set(["m"]) };
    expect(classifyTrigger(mk({ id: "m", kind: "normal" }), idx)).toBe("checkin");
  });
  it("クイックリプライ: 到達側（qrTargetIds）", () => {
    const idx = { qrTargetIds: new Set(["m"]), checkinTargetIds: new Set<string>() };
    expect(classifyTrigger(mk({ id: "m", kind: "normal" }), idx)).toBe("quick_reply");
  });
  it("順送り: 通常メッセージ", () => {
    expect(classifyTrigger(mk({ id: "m", kind: "normal" }), empty)).toBe("sequential");
  });
  it("順送り: 謎(puzzle) も v1 は順送り", () => {
    expect(classifyTrigger(mk({ id: "m", kind: "puzzle" }), empty)).toBe("sequential");
  });
  it("順送り: 開始(start) はキーワードがあっても順送り（応答に倒さない）", () => {
    expect(classifyTrigger(mk({ id: "m", kind: "start", trigger_keyword: "はじめる" }), empty)).toBe("sequential");
  });
  it("その他/未分類: hint / system_notice が head のとき", () => {
    expect(classifyTrigger(mk({ id: "m", kind: "hint" }), empty)).toBe("other");
    expect(classifyTrigger(mk({ id: "m", kind: "system_notice" }), empty)).toBe("other");
  });
  it("優先順: 応答 > チェックイン到達 > QR到達（response が最優先）", () => {
    const idx = { qrTargetIds: new Set(["m"]), checkinTargetIds: new Set(["m"]) };
    expect(classifyTrigger(mk({ id: "m", kind: "response" }), idx)).toBe("response");
  });
  it("チェックイン設定『元』の通常メッセージは（他信号なしなら）順送り", () => {
    // 元メッセージ自身は checkinTargetIds に入らない（対象は next 側）→ sequential
    const idx = { qrTargetIds: new Set<string>(), checkinTargetIds: new Set(["next"]) };
    expect(classifyTrigger(mk({ id: "src", kind: "normal" }), idx)).toBe("sequential");
  });
});

describe("getMessageWarnings — 既存5警告を1つも落とさない", () => {
  it("全条件 → 5警告すべて", () => {
    const w = getMessageWarnings({ missingKeyword: true, hasBrokenLink: true, unreferenced: true, chainLen: 6, chainLimit: 5, hasFlexIssue: true });
    expect(w).toEqual(["キーワード未設定", "遷移先未設定", "未接続", "連続5通超", "Flexキーワード警告"]);
  });
  it("連続5通は警告にならない（>5 のみ）", () => {
    expect(getMessageWarnings({ chainLen: 5, chainLimit: 5 })).toEqual([]);
    expect(getMessageWarnings({ chainLen: 6, chainLimit: 5 })).toEqual(["連続5通超"]);
  });
  it("hard/soft 区別: 未接続・連続5通超 は hard", () => {
    expect(isHardWarning("未接続")).toBe(true);
    expect(isHardWarning("連続5通超")).toBe(true);
    expect(isHardWarning("キーワード未設定")).toBe(false);
  });
});

describe("グループ順", () => {
  it("条件なし→QR→応答→チェックイン→その他", () => {
    expect(TRIGGER_GROUP_ORDER).toEqual<TriggerGroupKey[]>(["sequential", "quick_reply", "response", "checkin", "other"]);
  });
});
