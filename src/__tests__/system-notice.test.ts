/**
 * src/__tests__/system-notice.test.ts
 *
 * kind="system_notice" の挙動を検証する。
 *
 * - buildPhaseMessages で通常テキストとして LINE 送信される
 *   （Pattern 1: LINE 上では中央寄せにできないため通常テキスト扱い）
 * - createMessageSchema が body 必須 / 他フィールド任意で受け付ける
 * - updateMessageSchema が body=null を拒否する
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildPhaseMessages } from "@/lib/line";
import { createMessageSchema, updateMessageSchema } from "@/lib/validations";
import type { RuntimePhase, RuntimePhaseMessage } from "@/types";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

function makeMsg(overrides: Partial<RuntimePhaseMessage> = {}): RuntimePhaseMessage {
  return {
    id:                 "msg-default",
    kind:               "normal",
    message_type:       "text",
    body:               "テスト",
    asset_url:          null,
    alt_text:           null,
    flex_payload_json:  null,
    quick_replies:      null,
    lag_ms:             0,
    hint_mode:          "always",
    sort_order:         0,
    timing:             null,
    tap_destination_id: null,
    tap_url:            null,
    character:          null,
    ...overrides,
  };
}

function makePhase(messages: RuntimePhaseMessage[]): RuntimePhase {
  return {
    id:          "phase-1",
    phase_type:  "normal",
    name:        "テストフェーズ",
    description: null,
    messages,
    transitions: null,
  };
}

describe("kind=system_notice → LINE 変換", () => {
  it("システム通知は通常テキストとして送信される", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({
        id: "sn1",
        kind: "system_notice",
        message_type: "text",
        body: "ミカさんが入室しました",
      }),
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect((result[0] as { text: string }).text).toBe("ミカさんが入室しました");
  });

  it("通常メッセージとシステム通知が並ぶケースでも順序を保つ", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "n1", kind: "normal",        message_type: "text", body: "前置き", sort_order: 0 }),
      makeMsg({ id: "s1", kind: "system_notice", message_type: "text", body: "ミカさんが入室しました", sort_order: 1 }),
      makeMsg({ id: "n2", kind: "normal",        message_type: "text", body: "やっと起きた？", sort_order: 2 }),
    ]));
    expect(result).toHaveLength(3);
    expect((result[0] as { text: string }).text).toBe("前置き");
    expect((result[1] as { text: string }).text).toBe("ミカさんが入室しました");
    expect((result[2] as { text: string }).text).toBe("やっと起きた？");
  });

  it("body が空のシステム通知はテキスト送信されない（通常 text と同じ挙動）", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "sn-empty", kind: "system_notice", message_type: "text", body: null }),
    ]));
    expect(result).toHaveLength(0);
  });
});

describe("kind=system_notice → Zod バリデーション", () => {
  const baseValid = {
    work_id: "00000000-0000-0000-0000-000000000001",
    message_type: "text" as const,
    kind: "system_notice" as const,
    body: "ミカさんが入室しました",
  };

  it("body あり → 受理される", () => {
    const result = createMessageSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
  });

  it("body なし → エラー", () => {
    const result = createMessageSchema.safeParse({ ...baseValid, body: undefined });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "body")).toBe(true);
    }
  });

  it("空白のみの body → エラー", () => {
    const result = createMessageSchema.safeParse({ ...baseValid, body: "   " });
    expect(result.success).toBe(false);
  });

  it("update スキーマで body=null は拒否", () => {
    const result = updateMessageSchema.safeParse({
      kind: "system_notice",
      body: null,
    });
    expect(result.success).toBe(false);
  });

  it("trigger_keyword / asset_url が空でも問題なし", () => {
    const result = createMessageSchema.safeParse({
      ...baseValid,
      trigger_keyword: null,
      asset_url: undefined,
    });
    expect(result.success).toBe(true);
  });
});
