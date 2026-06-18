/**
 * src/__tests__/phase-send-unit-boundary.test.ts
 *
 * buildPhaseMessages の送信単位境界の検証（実機の送信順 / QuickReply 表示が壊れた回帰）。
 *
 * 背景: buildPhaseMessages は phase 内の全 head を sortOrder 順に連結して送るが、停止境界が
 *   free_input のみだった。開始メッセージ(sortOrder0)が QuickReply で終端していても停止せず、
 *   後続 head(sortOrder1/2) まで一括送信していた。LINE は最後のメッセージの quickReply しか
 *   表示しないため、開始メッセージの QR が出ず、順序も崩れていた。
 *   修正: QuickReply（ユーザー選択待ち）も free_input と同じ送信単位境界とし、そこで停止する。
 *   (= CMS 側 estimateMaxSendUnit / isWaitNode と同じ「QR 末尾で停止」セマンティクスに揃える)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildPhaseMessages } from "@/lib/line";
import type { RuntimePhase, RuntimePhaseMessage } from "@/types";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function m(over: Partial<RuntimePhaseMessage> & { id: string }): RuntimePhaseMessage {
  return {
    kind: "normal", message_type: "text", body: `body-${over.id}`, asset_url: null,
    alt_text: null, flex_payload_json: null, quick_replies: null, lag_ms: 0,
    hint_mode: "always", sort_order: 0, timing: null,
    tap_destination_id: null, tap_url: null, character: null, next_message_id: null,
    ...over,
  } as RuntimePhaseMessage;
}
function phase(msgs: RuntimePhaseMessage[]): RuntimePhase {
  return { id: "p1", phase_type: "normal", name: "出会い", description: null, messages: msgs, transitions: null };
}
const QR = [
  { label: "聞こえてるよ", action: "text", value: "聞こえてるよ" },
  { label: "もしもし",     action: "text", value: "もしもし" },
  { label: "ここにいるよ", action: "text", value: "ここにいるよ" },
  { label: "どうしたの？", action: "text", value: "どうしたの？" },
] as NonNullable<RuntimePhaseMessage["quick_replies"]>;
const bodies = (msgs: ReturnType<typeof buildPhaseMessages>) =>
  msgs.map((x) => (x as { text?: string }).text);
const lastQr = (msgs: ReturnType<typeof buildPhaseMessages>) =>
  (msgs[msgs.length - 1] as { quickReply?: { items: unknown[] } }).quickReply;

describe("buildPhaseMessages — QuickReply 送信単位境界（実機 出会い 事例）", () => {
  it("開始chain(2通,末尾QR)で停止し、後続 head(sortOrder1/2)は送らない", () => {
    const p = phase([
      m({ id: "s0a", kind: "start", sort_order: 0, body: "深い深い海の底。", next_message_id: "s0b" }),
      m({ id: "s0b", sort_order: 0, body: "……もしもし。 だれか、聞こえる？", quick_replies: QR }),
      m({ id: "s1a", sort_order: 1, body: "ワァ…!", free_input_enabled: true, next_message_id: "s1b" }),
      m({ id: "s1b", sort_order: 1, body: "ワァ続き" }),
      m({ id: "s2a", sort_order: 2, body: "ありがとう。声が届いて...", quick_replies: QR }),
    ]);
    const msgs = buildPhaseMessages(p);

    // 開始chainの2通だけ。sortOrder1/2 は含めない。
    expect(bodies(msgs)).toEqual(["深い深い海の底。", "……もしもし。 だれか、聞こえる？"]);
    // QR は開始chainの2通目（末尾）に付く。
    expect(lastQr(msgs)).toBeDefined();
    expect(lastQr(msgs)!.items).toHaveLength(4);
    // 後続メッセージは送信対象に含まれない。
    expect(bodies(msgs).some((b) => b?.includes("ワァ"))).toBe(false);
    expect(bodies(msgs).some((b) => b?.includes("ありがとう"))).toBe(false);
  });

  it("QR の無い連続 head は従来どおり自動連結して送る（auto-send 維持）", () => {
    const p = phase([
      m({ id: "a", sort_order: 0, body: "ナレ1" }),
      m({ id: "b", sort_order: 1, body: "ナレ2" }),
    ]);
    expect(bodies(buildPhaseMessages(p))).toEqual(["ナレ1", "ナレ2"]);
  });

  it("auto-send head を連結し、QR を持つ chain に達したらそこで停止する", () => {
    const p = phase([
      m({ id: "a", sort_order: 0, body: "ナレ1" }),                          // QRなし → 継続
      m({ id: "b", sort_order: 1, body: "選んでね", quick_replies: QR }),     // QR → ここで停止
      m({ id: "c", sort_order: 2, body: "選択後に送るやつ" }),                 // 送らない
    ]);
    const msgs = buildPhaseMessages(p);
    expect(bodies(msgs)).toEqual(["ナレ1", "選んでね"]);
    expect(lastQr(msgs)).toBeDefined();
  });

  it("free_input 境界は従来どおり維持（回帰防止）", () => {
    const p = phase([
      m({ id: "a", sort_order: 0, body: "ナレ1" }),
      m({ id: "b", sort_order: 1, body: "お名前は？", free_input_enabled: true }),
      m({ id: "c", sort_order: 2, body: "入力後に送るやつ" }),
    ]);
    expect(bodies(buildPhaseMessages(p))).toEqual(["ナレ1", "お名前は？"]);
  });
});
