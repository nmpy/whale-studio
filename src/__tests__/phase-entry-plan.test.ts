// src/__tests__/phase-entry-plan.test.ts
// フェーズ入場送信プレビューの純関数（computePhaseEntryPlan・PR1）。
import { describe, it, expect } from "vitest";
import { computePhaseEntryPlan, type EntryPlanMessage } from "@/app/oas/[id]/works/[workId]/messages/_phase-entry-plan";

const m = (o: Partial<EntryPlanMessage> & { id: string }): EntryPlanMessage =>
  ({ body: o.id, message_type: "text", sort_order: 0, created_at: "2026-01-01T00:00:00Z", ...o });

describe("computePhaseEntryPlan", () => {
  it("single head の通常 chain: 1 head・順に送信・警告なし", () => {
    const msgs = [
      m({ id: "h", next_message_id: "a", created_at: "t1" }),
      m({ id: "a", next_message_id: "b", created_at: "t2" }),
      m({ id: "b", next_message_id: null, created_at: "t3" }),
    ];
    const p = computePhaseEntryPlan(msgs);
    expect(p.sendItems.map((s) => s.messageId)).toEqual(["h", "a", "b"]);
    expect(p.total).toBe(3);
    expect(p.multipleHeads).toBe(false);
    expect(p.overLimit).toBe(false);
    expect(p.sortOrderUnstable).toBe(false);
    expect(p.heads).toHaveLength(1);
  });

  it("multiple head: 複数系列を入場で一斉送信（順序は sortOrder→head）", () => {
    const msgs = [
      m({ id: "h1", sort_order: 1, next_message_id: "h1b" }),
      m({ id: "h1b", sort_order: 1, next_message_id: null }),
      m({ id: "h2", sort_order: 2, next_message_id: null }),
    ];
    const p = computePhaseEntryPlan(msgs);
    expect(p.multipleHeads).toBe(true);
    expect(p.sendItems.map((s) => s.messageId)).toEqual(["h1", "h1b", "h2"]);
    expect(p.heads.map((h) => h.entryHeadIndex)).toEqual([1, 2]);
    expect(p.sortOrderUnstable).toBe(false); // sort 1,2 で確定
  });

  it("QR target でも entry head（next 参照なし）→ reachedViaNonNext=true（二重送信候補）", () => {
    const msgs = [
      m({ id: "h1", sort_order: 1, next_message_id: null, quick_replies: [{ label: "見る", action: "next", target_type: "message", target_message_id: "qonly" }] }),
      m({ id: "qonly", sort_order: 2, next_message_id: null }), // QR で辿る想定だが next 参照なし → entry head
    ];
    const p = computePhaseEntryPlan(msgs);
    expect(p.multipleHeads).toBe(true);
    const qonly = p.heads.find((h) => h.id === "qonly")!;
    expect(qonly.reachedViaNonNext).toBe(true);
    expect(qonly.referrerKinds).toContain("qr_target");
    // 入場でも送られる（sendItems に含まれる）
    expect(p.sendItems.some((s) => s.messageId === "qonly")).toBe(true);
  });

  it("freeInputNext で参照されているのに entry head → reachedViaNonNext=true", () => {
    const msgs = [
      m({ id: "prompt", sort_order: 1, free_input_enabled: true, free_input_next_message_id: "resp", next_message_id: null }),
      m({ id: "resp", sort_order: 2, next_message_id: null }), // freeInputNext で辿る想定だが next 参照なし
    ];
    const p = computePhaseEntryPlan(msgs);
    const resp = p.heads.find((h) => h.id === "resp")!;
    expect(resp.reachedViaNonNext).toBe(true);
    expect(resp.referrerKinds).toContain("freeInputNext");
  });

  it("freeInput 到達で phase 入場送信が全停止し、以降の head は送られない", () => {
    const msgs = [
      m({ id: "A", sort_order: 1, next_message_id: "A2" }),
      m({ id: "A2", sort_order: 1, free_input_enabled: true, next_message_id: null }),
      m({ id: "B", sort_order: 2, next_message_id: null }), // freeInput より後の head → 入場では送られない
    ];
    const p = computePhaseEntryPlan(msgs);
    expect(p.stoppedAtFreeInputId).toBe("A2");
    expect(p.sendItems.map((s) => s.messageId)).toEqual(["A", "A2"]); // B は送られない
    const B = p.heads.find((h) => h.id === "B")!;
    expect(B.sentOnEntry).toBe(false);
    const A = p.heads.find((h) => h.id === "A")!;
    expect(A.sentOnEntry).toBe(true);
  });

  it("5通超え: overLimit=true", () => {
    const msgs = [
      m({ id: "h1", sort_order: 1, next_message_id: "c2" }),
      m({ id: "c2", sort_order: 1, next_message_id: "c3" }),
      m({ id: "c3", sort_order: 1, next_message_id: null }),
      m({ id: "h2", sort_order: 2, next_message_id: "d2" }),
      m({ id: "d2", sort_order: 2, next_message_id: "d3" }),
      m({ id: "d3", sort_order: 2, next_message_id: null }),
    ];
    const p = computePhaseEntryPlan(msgs);
    expect(p.total).toBe(6);
    expect(p.overLimit).toBe(true);
  });

  it("sortOrder 重複（全0で複数 head）→ 順序不安定警告", () => {
    const msgs = [
      m({ id: "x", sort_order: 0, next_message_id: null }),
      m({ id: "y", sort_order: 0, next_message_id: null }),
      m({ id: "z", sort_order: 0, next_message_id: null }),
    ];
    const p = computePhaseEntryPlan(msgs);
    expect(p.multipleHeads).toBe(true);
    expect(p.sortOrderUnstable).toBe(true);
  });

  it("壊れた quick_replies でも落ちない", () => {
    const msgs = [
      m({ id: "h", sort_order: 1, next_message_id: null, quick_replies: "{{broken" }),
      m({ id: "t", sort_order: 2, next_message_id: null, quick_replies: 12345 }),
    ];
    expect(() => computePhaseEntryPlan(msgs)).not.toThrow();
  });
});
