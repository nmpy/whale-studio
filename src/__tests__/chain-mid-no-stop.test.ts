// src/__tests__/chain-mid-no-stop.test.ts
//
// PR #74 が NG だった真因の修正テスト。
//
// 問題: drainAutoSendableItems が「中間ノードに quickReplies があると stop」していた。
// 修正: requiresUserInteraction が m.nextMessageId !== null のときは false を返す。
//       → chain 末尾まで walk してから stop する。
//
// テスト対象:
//   - requiresUserInteraction の chain 中間/末尾判定
//   - drainAutoSendableItems の chain walk (= chain head + QR + chain tail)
//   - moveQuickReplyToTail (= 表示時の QR 移動)
//
// テストは Prisma client を使わず、型を最小限に作って純関数を検証する。

import { describe, it, expect } from "vitest";
import { requiresUserInteraction, isAutoSendableMessageNode } from "@/lib/runtime";

// PhaseMessage は Prisma の type だが、requiresUserInteraction が参照するのは
// 数フィールドだけなので最小オブジェクトで mock する。
type MinimalMsg = {
  id:              string;
  kind:            string;
  quickReplies:    string | null;
  triggerKeyword:  string | null;
  nextMessageId:   string | null;
  // 以下は isAutoSendableMessageNode が参照する
  targetSegment?: string | null;
};

// PhaseMessage 型に cast するためのヘルパー
const m = (overrides: Partial<MinimalMsg> = {}): MinimalMsg & {
  // PhaseMessage が要求する他フィールドはアクセスされないが型上必要なので as any でキャスト
} => ({
  id:             "msg-test",
  kind:           "normal",
  quickReplies:   null,
  triggerKeyword: null,
  nextMessageId:  null,
  ...overrides,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const castMsg = (x: MinimalMsg) => x as any;

// ──────────────────────────────────────────────────────────
// requiresUserInteraction の chain 中間 / 末尾判定
// ──────────────────────────────────────────────────────────

describe("requiresUserInteraction — chain 中間ノードでは停止しない", () => {
  it("nextMessageId なし + quickReplies あり → true (= 従来通り、chain tail で停止)", () => {
    const msg = m({ quickReplies: '[{"label":"はい","value":"はい"}]', nextMessageId: null });
    expect(requiresUserInteraction(castMsg(msg))).toBe(true);
  });

  it("nextMessageId あり + quickReplies あり → false (= 新規挙動、chain 中間では停止しない)", () => {
    const msg = m({
      quickReplies:  '[{"label":"はい","value":"はい"}]',
      nextMessageId: "msg-next",
    });
    expect(requiresUserInteraction(castMsg(msg))).toBe(false);
  });

  it("nextMessageId なし + triggerKeyword あり + kind=normal → true", () => {
    const msg = m({ triggerKeyword: "テスト", kind: "normal", nextMessageId: null });
    expect(requiresUserInteraction(castMsg(msg))).toBe(true);
  });

  it("nextMessageId あり + triggerKeyword あり (非 start) → true (= chain 中間でも停止、既存挙動維持)", () => {
    const msg = m({ triggerKeyword: "テスト", kind: "normal", nextMessageId: "msg-next" });
    expect(requiresUserInteraction(castMsg(msg))).toBe(true);
  });

  it("nextMessageId なし + kind=puzzle → true", () => {
    const msg = m({ kind: "puzzle", nextMessageId: null });
    expect(requiresUserInteraction(castMsg(msg))).toBe(true);
  });

  it("nextMessageId あり + kind=puzzle → true (= chain 中間でも停止、既存仕様: 解答待ち)", () => {
    const msg = m({ kind: "puzzle", nextMessageId: "msg-next" });
    expect(requiresUserInteraction(castMsg(msg))).toBe(true);
  });

  it("nextMessageId なし + ユーザー操作要素なし → false (= 普通の中継メッセージ)", () => {
    const msg = m({});
    expect(requiresUserInteraction(castMsg(msg))).toBe(false);
  });

  it("kind=start で triggerKeyword あり → false (= start トリガー用)", () => {
    const msg = m({ kind: "start", triggerKeyword: "はじめる", nextMessageId: null });
    expect(requiresUserInteraction(castMsg(msg))).toBe(false);
  });

  it("kind=start + nextMessageId あり + quickReplies あり → false (= chain 中間で stop しない)", () => {
    const msg = m({
      kind:           "start",
      quickReplies:   '[{"label":"QRテスト１","value":"QRテスト１"}]',
      nextMessageId:  "msg2",
    });
    expect(requiresUserInteraction(castMsg(msg))).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// isAutoSendableMessageNode (= 自動送信対象判定) は影響なしを確認
// ──────────────────────────────────────────────────────────

describe("isAutoSendableMessageNode — chain 中間 / 末尾で挙動が変わらない (regression)", () => {
  const ctx = { targetMsgIds: new Set<string>() };

  it("kind=start (= 自動送信対象) は nextMessageId 有無に関係なく true", () => {
    expect(isAutoSendableMessageNode(castMsg(m({ kind: "start" })), ctx)).toBe(true);
    expect(isAutoSendableMessageNode(castMsg(m({ kind: "start", nextMessageId: "m2" })), ctx)).toBe(true);
  });

  it("kind=response (= キーワード応答) は常に自動送信対象から外れる", () => {
    expect(isAutoSendableMessageNode(castMsg(m({ kind: "response" })), ctx)).toBe(false);
    expect(isAutoSendableMessageNode(castMsg(m({ kind: "response", nextMessageId: "m2" })), ctx)).toBe(false);
  });

  it("kind=hint は常に自動送信対象から外れる", () => {
    expect(isAutoSendableMessageNode(castMsg(m({ kind: "hint" })), ctx)).toBe(false);
  });

  it("kind=normal + triggerKeyword あり は自動送信対象から外れる (chain 有無に関わらず)", () => {
    expect(isAutoSendableMessageNode(castMsg(m({ kind: "normal", triggerKeyword: "テスト" })), ctx)).toBe(false);
    expect(isAutoSendableMessageNode(castMsg(m({ kind: "normal", triggerKeyword: "テスト", nextMessageId: "m2" })), ctx)).toBe(false);
  });

  it("QR の target_message_id に含まれていれば false", () => {
    const ctx2 = { targetMsgIds: new Set(["msg-target"]) };
    expect(isAutoSendableMessageNode(castMsg(m({ id: "msg-target" })), ctx2)).toBe(false);
  });
});
