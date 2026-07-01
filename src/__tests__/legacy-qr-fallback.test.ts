// src/__tests__/legacy-qr-fallback.test.ts
// legacy ラベル一致 fallback の候補収集純ロジック（挙動不変・先頭一致順 / 同名複数の検知）。
import { describe, it, expect } from "vitest";
import { collectLegacyQrMatches, collectLegacyHintMatches, type LegacyQrMsgRow } from "@/lib/legacy-qr-fallback";
import type { QuickReplyItem } from "@/types";

const NORM = { strict: (s: string) => s.trim().toLowerCase(), loose: (s: string) => s.trim().toLowerCase().replace(/\s+/g, "") };
const qr = (items: QuickReplyItem[]): string => JSON.stringify(items);
const dest = (label: string): QuickReplyItem => ({ label, action: "text", target_phase_id: "p-next" } as QuickReplyItem);
const hint = (label: string): QuickReplyItem => ({ label, action: "hint", hint_text: `${label} の本文` } as QuickReplyItem);

describe("collectLegacyQrMatches（送信先つき通常QRのラベル一致）", () => {
  it("同一スコープ内の同名QRを走査順で全件返す（先頭=既存return）", () => {
    const msgs: LegacyQrMsgRow[] = [
      { id: "A-a", quickReplies: qr([dest("次へ")]) },
      { id: "A-b", quickReplies: qr([dest("次へ")]) },
    ];
    const r = collectLegacyQrMatches(msgs, "次へ", NORM);
    expect(r.map((m) => m.messageId)).toEqual(["A-a", "A-b"]);
    expect(r.length).toBe(2);
    expect(r[0].messageId).toBe("A-a"); // 先頭一致（既存挙動）
    expect(r[0].matchKey).toBe("次へ");
  });

  it("単一一致は1件のみ（ambiguous ではない）", () => {
    const msgs: LegacyQrMsgRow[] = [
      { id: "A-a", quickReplies: qr([dest("進む")]) },
      { id: "A-b", quickReplies: qr([dest("戻る")]) },
    ];
    expect(collectLegacyQrMatches(msgs, "進む", NORM).map((m) => m.messageId)).toEqual(["A-a"]);
  });

  it("action=hint / disabled / 送信先なし は候補にしない", () => {
    const msgs: LegacyQrMsgRow[] = [
      { id: "h", quickReplies: qr([hint("次へ")]) },                                            // hint は対象外
      { id: "d", quickReplies: qr([{ label: "次へ", action: "text", target_phase_id: "p", enabled: false } as QuickReplyItem]) }, // disabled
      { id: "n", quickReplies: qr([{ label: "次へ", action: "text" } as QuickReplyItem]) },      // 送信先なし
    ];
    expect(collectLegacyQrMatches(msgs, "次へ", NORM)).toEqual([]);
  });

  it("不一致・壊れたJSON・quickReplies無し は空配列", () => {
    const msgs: LegacyQrMsgRow[] = [
      { id: "a", quickReplies: qr([dest("次へ")]) },
      { id: "b", quickReplies: "{壊れ" },
      { id: "c", quickReplies: null },
    ];
    expect(collectLegacyQrMatches(msgs, "存在しない", NORM)).toEqual([]);
  });
});

describe("collectLegacyHintMatches（ヒントQRのラベル一致）", () => {
  it("同一スコープ内の同名ヒントを走査順で全件返す（先頭=既存return）", () => {
    const msgs: LegacyQrMsgRow[] = [
      { id: "A-a", quickReplies: qr([hint("ヒントを見る")]) },
      { id: "A-b", quickReplies: qr([hint("ヒントを見る")]) },
    ];
    const r = collectLegacyHintMatches(msgs, "ヒントを見る", NORM);
    expect(r.map((m) => m.messageId)).toEqual(["A-a", "A-b"]);
    expect(r.length).toBe(2);
    expect(r[0].item.hint_text).toBe("ヒントを見る の本文");
    expect(r[0].qrItems.length).toBeGreaterThanOrEqual(1);
  });

  it("hintMode=hidden のメッセージはスキップ", () => {
    const msgs: LegacyQrMsgRow[] = [
      { id: "hidden", quickReplies: qr([hint("ヒントを見る")]), hintMode: "hidden" },
      { id: "shown",  quickReplies: qr([hint("ヒントを見る")]) },
    ];
    expect(collectLegacyHintMatches(msgs, "ヒントを見る", NORM).map((m) => m.messageId)).toEqual(["shown"]);
  });

  it("puzzle の incorrect_quick_replies のヒントも候補に含む", () => {
    const msgs: LegacyQrMsgRow[] = [
      { id: "p", kind: "puzzle", incorrectQuickReplies: qr([hint("ヒントを見る")]) },
    ];
    const r = collectLegacyHintMatches(msgs, "ヒントを見る", NORM);
    expect(r.length).toBe(1);
    expect(r[0].messageId).toBe("p");
  });

  it("非ヒント action は候補にしない", () => {
    const msgs: LegacyQrMsgRow[] = [{ id: "a", quickReplies: qr([dest("ヒントを見る")]) }];
    expect(collectLegacyHintMatches(msgs, "ヒントを見る", NORM)).toEqual([]);
  });
});
