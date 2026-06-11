// src/__tests__/save-verify.test.ts
// メッセージ保存後の DB反映検証（verifyMessageSave）。
import { describe, it, expect } from "vitest";
import { verifyMessageSave, type SaveVerifyExpected, type SaveVerifyActual } from "@/app/oas/[id]/works/[workId]/messages/_save-verify";

const exp = (over: Partial<SaveVerifyExpected> = {}): SaveVerifyExpected => ({
  body: "head", characterId: null, quickRepliesJson: null, freeInputEnabled: false, freeInputNextMessageId: null,
  chainIds: ["H", "S1", "S2"], removedIds: [], ...over,
});
const act = (over: Partial<SaveVerifyActual> = {}): SaveVerifyActual => ({
  body: "head", characterId: null, quickRepliesJson: null, freeInputEnabled: false, freeInputNextMessageId: null,
  walkedChainIds: ["H", "S1", "S2"], existingIds: ["H", "S1", "S2"], ...over,
});

describe("verifyMessageSave", () => {
  it("完全一致なら ok", () => {
    expect(verifyMessageSave(exp(), act()).ok).toBe(true);
  });

  it("quickReplies が期待と違う → 不一致（成功扱いにしない）", () => {
    const qr = JSON.stringify([{ label: "もっと聞いてみる", action: "text", target_type: "message", target_message_id: "f45d9b8e" }]);
    const r = verifyMessageSave(exp({ quickRepliesJson: qr }), act({ quickRepliesJson: null })); // DB側はnull（保存されていない）
    expect(r.ok).toBe(false);
    expect(r.mismatches.join()).toContain("クイックリプライ");
  });

  it("quickReplies は value/enabled 差では誤検知しない", () => {
    const expJson = JSON.stringify([{ label: "A", action: "text", target_type: "phase", target_phase_id: "p1" }]);
    const actJson = JSON.stringify([{ label: "A", action: "text", value: "A", enabled: true, target_type: "phase", target_phase_id: "p1" }]);
    expect(verifyMessageSave(exp({ quickRepliesJson: expJson }), act({ quickRepliesJson: actJson })).ok).toBe(true);
  });

  it("削除したスロットが残存 → 不一致", () => {
    const r = verifyMessageSave(exp({ removedIds: ["DEL"] }), act({ existingIds: ["H", "S1", "S2", "DEL"] }));
    expect(r.ok).toBe(false);
    expect(r.mismatches.join()).toContain("削除したはず");
  });

  it("chain の並び（nextMessageId列）が期待と違う → 不一致", () => {
    const r = verifyMessageSave(exp({ chainIds: ["H", "S1", "S2"] }), act({ walkedChainIds: ["H", "S1"], existingIds: ["H", "S1", "S2"] }));
    expect(r.ok).toBe(false);
    expect(r.mismatches.join()).toContain("連続メッセージの並び");
  });

  it("期待 chain の messageId が存在しない（作成漏れ）→ 不一致", () => {
    const r = verifyMessageSave(exp({ chainIds: ["H", "S1", "NEW"] }), act({ walkedChainIds: ["H", "S1", "NEW"], existingIds: ["H", "S1"] }));
    expect(r.ok).toBe(false);
    expect(r.mismatches.join()).toContain("存在しない");
  });

  it("body / freeInput の不一致を検出", () => {
    expect(verifyMessageSave(exp({ body: "x" }), act({ body: "y" })).ok).toBe(false);
    expect(verifyMessageSave(exp({ freeInputEnabled: true }), act({ freeInputEnabled: false })).ok).toBe(false);
    expect(verifyMessageSave(exp({ freeInputNextMessageId: "n1" }), act({ freeInputNextMessageId: null })).ok).toBe(false);
  });
});
