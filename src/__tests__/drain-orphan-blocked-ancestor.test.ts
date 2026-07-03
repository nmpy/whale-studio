// src/__tests__/drain-orphan-blocked-ancestor.test.ts
//
// 本番 hotfix: フェーズ入場/遷移時の drainAutoSendableItems で、
// **自動送信不可（kind=response/hint・triggerKeyword付き・QR分岐先・segment不一致）とされた
// head/祖先の配下 child が orphan(midChain) 補償で誤送信される**問題の回帰防止。
//
// 本番「なぞいち」遷移で、応答チェーンの子（text,text,image,text,image）が誤送信された事象に対応。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { drainAutoSendableItems } from "@/lib/runtime";
import { buildPhaseMessages } from "@/lib/line";
import type { RuntimePhase } from "@/types";

type PhaseMessage = Parameters<typeof drainAutoSendableItems>[0][number];

let _c = 0;
function makeMessage(overrides: Partial<PhaseMessage> = {}): PhaseMessage {
  _c++;
  const id = overrides.id ?? `msg-${_c}`;
  return {
    id, workId: "work-1", phaseId: "phase-1", characterId: null,
    messageType: "text", body: `メッセージ ${id}`, assetUrl: null, altText: null,
    flexPayloadJson: null, quickReplies: null, sortOrder: _c, isActive: true,
    createdAt: new Date("2024-01-01"), updatedAt: new Date("2024-01-01"),
    kind: "normal", triggerKeyword: null, targetSegment: null, notifyText: null,
    riddleId: null, answer: null, answerMatchType: '["exact"]', correctAction: null,
    correctNextPhaseId: null, correctText: null, incorrectText: null,
    incorrectQuickReplies: null, puzzleHintText: null, puzzleType: null,
    nextMessageId: null, lagMs: 0, hintMode: "always", readReceiptMode: null,
    readDelayMs: null, typingEnabled: null, typingMinMs: null, typingMaxMs: null,
    loadingEnabled: null, loadingThresholdMs: null, loadingMinSeconds: null,
    loadingMaxSeconds: null, tapDestinationId: null, tapUrl: null, character: null,
    ...overrides,
  } as PhaseMessage;
}
const ids = (r: { id: string }[]) => r.map((m) => m.id);

beforeEach(() => {
  _c = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("drainAutoSendableItems — 自動送信不可 head の child は orphan 補償で送らない", () => {
  it("Case 1: kind=response head の child(text,image) は送られない", () => {
    const msgs = [
      makeMessage({ id: "rHead", sortOrder: 1, kind: "response", messageType: "image", assetUrl: "https://x/i.jpg", nextMessageId: "c1" }),
      makeMessage({ id: "c1", sortOrder: 2, kind: "normal", messageType: "text", nextMessageId: "c2" }),
      makeMessage({ id: "c2", sortOrder: 3, kind: "normal", messageType: "image", assetUrl: "https://x/i2.jpg" }),
    ];
    const result = drainAutoSendableItems(msgs, "in_progress");
    expect(ids(result)).toEqual([]); // head も child も送られない
  });

  it("Case 2: triggerKeyword付き head の child(text,image) は送られない", () => {
    const msgs = [
      makeMessage({ id: "kHead", sortOrder: 1, kind: "normal", triggerKeyword: "なぞ", nextMessageId: "c1" }),
      makeMessage({ id: "c1", sortOrder: 2, kind: "normal", messageType: "text", nextMessageId: "c2" }),
      makeMessage({ id: "c2", sortOrder: 3, kind: "normal", messageType: "image", assetUrl: "https://x/i.jpg" }),
    ];
    const result = drainAutoSendableItems(msgs, "in_progress");
    expect(ids(result)).toEqual([]);
  });

  it("Case 3: QR分岐先(target_message_id) head の child は送られない", () => {
    const qr = JSON.stringify([{ label: "見る", action: "text", target_message_id: "qtHead" }]);
    const msgs = [
      // QR を定義する側は response（自動送信されない）にして orphan 補償経路まで到達させる
      makeMessage({ id: "menu", sortOrder: 1, kind: "response", quickReplies: qr }),
      makeMessage({ id: "qtHead", sortOrder: 2, kind: "normal", nextMessageId: "c1" }), // QR分岐先 = 自動送信不可
      makeMessage({ id: "c1", sortOrder: 3, kind: "normal", messageType: "text" }),
    ];
    const result = drainAutoSendableItems(msgs, "in_progress");
    expect(ids(result)).toEqual([]); // qtHead も c1 も送られない
  });

  it("Case 4: 通常 normal チェーン(head→text→image) は従来どおり送信される（壊さない）", () => {
    const msgs = [
      makeMessage({ id: "h", sortOrder: 1, kind: "normal", messageType: "text", nextMessageId: "c1" }),
      makeMessage({ id: "c1", sortOrder: 2, kind: "normal", messageType: "text", nextMessageId: "c2" }),
      makeMessage({ id: "c2", sortOrder: 3, kind: "normal", messageType: "image", assetUrl: "https://x/i.jpg" }),
    ];
    const result = drainAutoSendableItems(msgs, "in_progress");
    expect(ids(result)).toEqual(["h", "c1", "c2"]);
  });

  it("Case 5: 「なぞいち」再現 — skipped head 配下の 2チェーンが送られない（text,text,image,text,image にならない）", () => {
    const qr = JSON.stringify([{ label: "見る", action: "text", target_message_id: "headA" }]);
    const msgs = [
      makeMessage({ id: "menu", sortOrder: 1, kind: "response", quickReplies: qr }),
      // chain A: QR分岐先 head（自動送信不可）→ text → text → image
      makeMessage({ id: "headA", sortOrder: 2, kind: "normal", nextMessageId: "a1" }),
      makeMessage({ id: "a1", sortOrder: 3, kind: "normal", messageType: "text", nextMessageId: "a2" }),
      makeMessage({ id: "a2", sortOrder: 4, kind: "normal", messageType: "text", nextMessageId: "a3" }),
      makeMessage({ id: "a3", sortOrder: 5, kind: "normal", messageType: "image", assetUrl: "https://x/a.jpg" }),
      // chain B: triggerKeyword head（自動送信不可）→ text → image
      makeMessage({ id: "headB", sortOrder: 6, kind: "normal", triggerKeyword: "解く", nextMessageId: "b1" }),
      makeMessage({ id: "b1", sortOrder: 7, kind: "normal", messageType: "text", nextMessageId: "b2" }),
      makeMessage({ id: "b2", sortOrder: 8, kind: "normal", messageType: "image", assetUrl: "https://x/b.jpg" }),
    ];
    const result = drainAutoSendableItems(msgs, "in_progress");
    expect(ids(result)).toEqual([]); // 応答チェーンの子は一切送られない
  });

  it("Case 6: kind=normal の image は入場時に送信対象（image として build される）", () => {
    const msgs = [
      makeMessage({ id: "img", sortOrder: 1, kind: "normal", messageType: "image", assetUrl: "https://x/only.jpg" }),
    ];
    const result = drainAutoSendableItems(msgs, "in_progress");
    expect(ids(result)).toEqual(["img"]);
    expect(result[0].message_type).toBe("image");

    // buildPhaseMessages 経由でも LINE image message になる
    const phase: RuntimePhase = { id: "p", phase_type: "normal", name: "6問", description: null, messages: result, transitions: null };
    const line = buildPhaseMessages(phase, {});
    expect(line).toHaveLength(1);
    expect(line[0].type).toBe("image");
  });
});

describe("回帰: 自動送信可能な head が startAfterSortOrder でスキップされた child は従来どおり救済", () => {
  it("normal head(sort=2, startAfter でスキップ) → child(sort=3) は救済される", () => {
    const msgs = [
      makeMessage({ id: "puz", sortOrder: 1, kind: "puzzle", answer: "a" }),
      makeMessage({ id: "h", sortOrder: 2, kind: "normal", messageType: "text", nextMessageId: "c1" }),
      makeMessage({ id: "c1", sortOrder: 3, kind: "normal", messageType: "text" }),
    ];
    // startAfter=1: puz と h(sort<=1?) ... h は sort=2 なので walk 対象。c1 は midChain。
    // ここでは h(sort=2) が startAfter=2 でスキップされるケースを検証する。
    const result = drainAutoSendableItems(msgs, "in_progress", 2);
    // h(sort=2<=2)はスキップ、c1(sort=3)は自動送信可の祖先(h)しか持たないため救済される
    expect(ids(result)).toEqual(["c1"]);
  });
});
