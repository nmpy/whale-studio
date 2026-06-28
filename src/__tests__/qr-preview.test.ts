// src/__tests__/qr-preview.test.ts
// QR の配信単位プレビュー（実送信規則と一致するか）。
import { describe, it, expect } from "vitest";
import { previewQrSend, phaseEntryMessages, type QrPreviewMessage } from "@/app/oas/[id]/works/[workId]/messages/_qr-preview";

const m = (id: string, over: Partial<QrPreviewMessage> = {}): QrPreviewMessage => ({
  id, body: id, message_type: "text", next_message_id: null, free_input_enabled: false, phase_id: "P1", sort_order: 0, ...over,
});
const chain = (ids: string[], phase = "P1"): QrPreviewMessage[] =>
  ids.map((id, i) => m(id, { phase_id: phase, next_message_id: i < ids.length - 1 ? ids[i + 1] : null }));

describe("previewQrSend — target_message_id（指定chainのみ）", () => {
  it("4通chainは4通プレビュー・警告なし・同phaseの他headは含まない", () => {
    const msgs = [...chain(["T1", "T2", "T3", "T4"]), m("OTHER", { id: "OTHER" })]; // OTHER は別head
    const r = previewQrSend({ target_type: "message", target_message_id: "T1" }, msgs);
    expect(r.mode).toBe("message_chain");
    expect(r.messages.map((x) => x.id)).toEqual(["T1", "T2", "T3", "T4"]);
    expect(r.total).toBe(4);
    expect(r.overLimit).toBe(false);
    expect(r.messages.some((x) => x.id === "OTHER")).toBe(false); // 後続headは送られない
  });

  it("6通chainは5通だけ届き、6通目以降は dropped 警告", () => {
    const r = previewQrSend({ target_type: "message", target_message_id: "T1" }, chain(["T1", "T2", "T3", "T4", "T5", "T6"]));
    expect(r.total).toBe(5);            // 届くのは5通
    expect(r.fullTotal).toBe(6);        // chain実長は6
    expect(r.overLimit).toBe(true);
    expect(r.overflowKind).toBe("dropped");
  });

  it("freeInput で停止（含む）", () => {
    const msgs = chain(["T1", "T2", "T3"]);
    msgs[1].free_input_enabled = true; // T2 が freeInput
    const r = previewQrSend({ target_type: "message", target_message_id: "T1" }, msgs);
    expect(r.messages.map((x) => x.id)).toEqual(["T1", "T2"]); // T2 含めて停止、T3 は出ない
  });
});

describe("previewQrSend — target_phase_id（フェーズ入場送信）", () => {
  it("head1=3通 + head2=2通 = 5通 → 警告なし", () => {
    const msgs = [
      ...chain(["h1", "c1", "c2"], "PX"),            // head1: 3通
      ...chain(["h2", "d1"], "PX"),                  // head2: 2通
    ].map((x) => ({ ...x, sort_order: x.id.startsWith("h2") || x.id === "d1" ? 1 : 0 }));
    const r = previewQrSend({ target_phase_id: "PX" }, msgs);
    expect(r.mode).toBe("phase_entry");
    expect(r.total).toBe(5);
    expect(r.overLimit).toBe(false);
  });

  it("head1=4通 + head2=2通 = 6通 → push 警告", () => {
    const msgs = [
      ...chain(["h1", "c1", "c2", "c3"], "PX"),       // head1: 4通 (sort 0)
      ...chain(["h2", "d1"], "PX").map((x) => ({ ...x, sort_order: 1 })), // head2: 2通 (sort 1)
    ];
    const r = previewQrSend({ target_phase_id: "PX" }, msgs);
    expect(r.total).toBe(6);
    expect(r.overLimit).toBe(true);
    expect(r.overflowKind).toBe("push");
  });

  it("freeInput に達したら、それ以降の head はカウントしない", () => {
    const msgs = [
      ...chain(["h1", "c1"], "PX"),                    // head1: 2通、c1 が freeInput
      ...chain(["h2", "d1"], "PX").map((x) => ({ ...x, sort_order: 1 })),
    ];
    msgs[1].free_input_enabled = true; // c1 = freeInput
    const r = previewQrSend({ target_phase_id: "PX" }, msgs);
    expect(r.messages.map((x) => x.id)).toEqual(["h1", "c1"]); // freeInput で全停止、h2 は出ない
    expect(r.total).toBe(2);
  });
});

describe("previewQrSend — その他", () => {
  it("遷移先なしは none", () => {
    expect(previewQrSend({}, []).mode).toBe("none");
  });
  it("none は destinationTailQr が空", () => {
    expect(previewQrSend({}, []).destinationTailQr).toEqual([]);
  });
});

// ── destinationTailQr: 送信先メッセージに付く「次のクイックリプライ」（タップ後に実機で出る QR）──
//   実機: 現在QRタップ → 送信先メッセージ送信 → その末尾に送信先のQRが表示される。
//   CMSプレビューのこの値で「次の『次へ』は送信先メッセージ側のもの」と示す。
describe("previewQrSend — destinationTailQr（送信先メッセージのQR）", () => {
  const nextQr = (label: string, target: string) =>
    [{ action: "text", label, target_type: "message", target_message_id: target }] as QrPreviewMessage["quick_replies"];

  it("★ A『次へ』→ B（B に『次へ』）: B の送信先QR『次へ』が destinationTailQr に出る（B が再送扱いにならない構造を可視化）", () => {
    // 「……」(A) の QR は B(=ーーこの春…) を送る。B 自身に次の「次へ」が付いている。
    const msgs: QrPreviewMessage[] = [
      m("A", { body: "……", quick_replies: nextQr("次へ", "B") }),
      m("B", { body: "ーーこの春、受験を終えて…", quick_replies: nextQr("次へ", "C") }),
      m("C", { body: "次のシーン" }),
    ];
    const r = previewQrSend({ target_type: "message", target_message_id: "B" }, msgs);
    expect(r.mode).toBe("message_chain");
    expect(r.messages.map((x) => x.id)).toEqual(["B"]);          // 送られるのは B のみ
    expect(r.destinationTailQr.map((q) => q.label)).toEqual(["次へ"]); // B 付属の「次へ」
  });

  it("送信先メッセージに QR が無ければ destinationTailQr は空", () => {
    const msgs: QrPreviewMessage[] = [m("A", { quick_replies: nextQr("次へ", "B") }), m("B", { body: "終端" })];
    const r = previewQrSend({ target_type: "message", target_message_id: "B" }, msgs);
    expect(r.destinationTailQr).toEqual([]);
  });

  it("chain 末尾（複数通）の QR を採用する（moveQuickReplyToTail 相当・後方走査）", () => {
    const msgs: QrPreviewMessage[] = [
      m("T1", { next_message_id: "T2" }),
      m("T2", { next_message_id: "T3" }),
      m("T3", { quick_replies: nextQr("進む", "X") }),
    ];
    const r = previewQrSend({ target_type: "message", target_message_id: "T1" }, msgs);
    expect(r.messages.map((x) => x.id)).toEqual(["T1", "T2", "T3"]);
    expect(r.destinationTailQr.map((q) => q.label)).toEqual(["進む"]);
  });

  it("enabled=false の QR は destinationTailQr から除外", () => {
    const msgs: QrPreviewMessage[] = [
      m("A", { quick_replies: nextQr("次へ", "B") }),
      m("B", { quick_replies: [{ action: "text", label: "無効", target_type: "message", target_message_id: "C", enabled: false }] as QrPreviewMessage["quick_replies"] }),
    ];
    const r = previewQrSend({ target_type: "message", target_message_id: "B" }, msgs);
    expect(r.destinationTailQr).toEqual([]);
  });

  it("response_chain モードでも送信先末尾の QR を返す", () => {
    const msgs: QrPreviewMessage[] = [
      m("R1", { next_message_id: "R2" }),
      m("R2", { quick_replies: nextQr("続き", "Z") }),
    ];
    const r = previewQrSend({ response_message_id: "R1" }, msgs);
    expect(r.mode).toBe("response_chain");
    expect(r.destinationTailQr.map((q) => q.label)).toEqual(["続き"]);
  });

  it("phase_entry モードでも入場フェーズ末尾の QR を返す", () => {
    const msgs: QrPreviewMessage[] = [
      m("H1", { phase_id: "PX", has_quick_reply: true, quick_replies: nextQr("はじめる", "K") }),
    ];
    const r = previewQrSend({ target_phase_id: "PX" }, msgs);
    expect(r.mode).toBe("phase_entry");
    expect(r.destinationTailQr.map((q) => q.label)).toEqual(["はじめる"]);
  });
});
