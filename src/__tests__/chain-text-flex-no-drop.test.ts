/**
 * src/__tests__/chain-text-flex-no-drop.test.ts
 *
 * ★ regression: 同一チェーン text → text(`{anyName}`) → flex で、中間の通常 text（2通目）が
 *   送信対象から落ちる不具合（実機で 1→3 のみ送られる）。
 *
 * 原因: 2通目 body の `{anyName}`（未定義変数）が、userVariables 未設定時に interpolate を
 *   通らず literal のまま残り、buildPhaseMessages の「未置換 placeholder safety guard」が
 *   メッセージごと送信対象から除外していた。
 * 修正: replacePlaceholders が userVariables の有無に関わらず必ず interpolate を通し、未解決の
 *   `{key}` を空文字へ統一する → literal が残らず guard に落とされない。
 *
 * buildPhaseMessages の戻り値が、実機 replyToLine に渡る messages 配列そのもの。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildPhaseMessages } from "@/lib/line";
import type { RuntimePhase, RuntimePhaseMessage } from "@/types";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const mk = (o: Partial<RuntimePhaseMessage> = {}): RuntimePhaseMessage => ({
  id: "m", kind: "normal", message_type: "text", body: "b", asset_url: null, alt_text: null,
  flex_payload_json: null, quick_replies: null, lag_ms: 0, hint_mode: "always", sort_order: 0,
  timing: null, tap_destination_id: null, tap_url: null, character: null, ...o,
} as RuntimePhaseMessage);
const phase = (messages: RuntimePhaseMessage[]): RuntimePhase => ({
  id: "p1", phase_type: "normal", name: "P", description: null, messages, transitions: null,
});
const FLEX = JSON.stringify({
  type: "bubble",
  body: { type: "box", layout: "vertical", contents: [{ type: "text", text: "フレックス本文" }] },
});
// 1→2→3 チェーン（2通目に未定義変数 {anyName}・3通目 Flex）。userVariables は未設定で呼ぶ＝本不具合の条件。
const chain = (): RuntimePhaseMessage[] => [
  mk({ id: "m1", sort_order: 0, body: "そうなの...かな...", next_message_id: "m2" }),
  mk({ id: "m2", sort_order: 1, body: "ねえ、{anyName}も一緒に海の仲間たちに聞いてみない？", next_message_id: "m3" }),
  mk({ id: "m3", sort_order: 2, message_type: "flex", body: null, flex_payload_json: FLEX, alt_text: "Flex代替", next_message_id: null }),
];
const txt = (m: unknown) => (m as { text?: string }).text ?? "";

describe("text → text({anyName}) → flex チェーンで中間 text が落ちない", () => {
  it("送信対象は3件・順序 text/text/flex（2通目が欠落しない）", () => {
    const r = buildPhaseMessages(phase(chain()), { vars: {} }); // userVariables 未設定
    expect(r).toHaveLength(3);
    expect(r[0].type).toBe("text");
    expect(txt(r[0])).toBe("そうなの...かな...");
    expect(r[1].type).toBe("text");                              // ← 2通目が残る（旧: 落ちていた）
    expect(txt(r[1])).toContain("海の仲間たちに聞いてみない？");
    expect(r[2].type).toBe("flex");                              // 3通目 Flex
  });

  it("{anyName} は空文字へ統一され、メッセージ自体は落ちない", () => {
    const r = buildPhaseMessages(phase(chain()), { vars: {} });
    expect(r).toHaveLength(3);
    expect(txt(r[1])).toBe("ねえ、も一緒に海の仲間たちに聞いてみない？"); // {anyName} → ""
    expect(txt(r[1])).not.toContain("{anyName}");
  });

  it("2通目に timing 未設定でも送信配列に残る（PR#433: loading 有無と送信対象は独立）", () => {
    const msgs = chain();
    msgs[0].timing = { loading_enabled: true } as unknown as RuntimePhaseMessage["timing"]; // 1通目 timing あり
    msgs[1].timing = null;                                                                   // 2通目 timing 未設定
    const r = buildPhaseMessages(phase(msgs), { vars: {} });
    expect(r).toHaveLength(3);
    expect(txt(r[1])).toContain("海の仲間たち");
  });

  it("Flex 直前の通常 text が消えない（message_type 境界 text→flex）", () => {
    const r = buildPhaseMessages(phase([
      mk({ id: "a", body: "直前テキスト", next_message_id: "b" }),
      mk({ id: "b", message_type: "flex", body: null, flex_payload_json: FLEX, alt_text: "alt", next_message_id: null }),
    ]), { vars: {} });
    expect(r).toHaveLength(2);
    expect(r[0].type).toBe("text");
    expect(txt(r[0])).toBe("直前テキスト");
    expect(r[1].type).toBe("flex");
  });

  it("{{user_name}} など二重括弧の既知変数は従来どおり置換（interpolate 対象外で壊れない）", () => {
    const r = buildPhaseMessages(phase([
      mk({ id: "a", body: "こんにちは {{user_name}} さん、{nick} です", next_message_id: "b" }),
      mk({ id: "b", body: "つづき", next_message_id: null }),
    ]), { vars: { userName: "なみ", userVariables: { nick: "ぽよ" } } });
    expect(r).toHaveLength(2);
    expect(txt(r[0])).toBe("こんにちは なみ さん、ぽよ です");
  });
});
