/**
 * src/__tests__/qr-preview-phase-entry.test.ts
 * フェーズ入場プレビュー（phaseEntryMessages / previewQrSend phase_entry）の停止条件を
 * 実送信 buildPhaseMessages（QR / free_input で停止）に揃えたことを検証する。
 */
import { describe, it, expect } from "vitest";
import { phaseEntryMessages, previewQrSend, type QrPreviewMessage } from "@/app/oas/[id]/works/[workId]/messages/_qr-preview";

/** sort_order 順の単独 head 群（chain 無し）を作るヘルパー。 */
const heads = (specs: Array<Partial<QrPreviewMessage> & { id: string }>): QrPreviewMessage[] =>
  specs.map((s, i) => ({ sort_order: (i + 1) * 10, phase_id: "P", ...s }));

describe("phaseEntryMessages 停止条件（実送信に一致）", () => {
  it("1/2. 最初のQR付きchainまでを含めて停止し、QRより後ろのheadは数えない", () => {
    const msgs = heads([
      { id: "a" },
      { id: "b", has_quick_reply: true }, // ここでQR → 以降の head は送らない
      { id: "c" },
      { id: "d" },
    ]);
    expect(phaseEntryMessages(msgs).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("3. free_input で停止する（その message は含む）", () => {
    const msgs = heads([
      { id: "a" },
      { id: "b", free_input_enabled: true },
      { id: "c" },
    ]);
    expect(phaseEntryMessages(msgs).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("4. QRもfree_inputも無ければ、フェーズ内 head を順にカウント", () => {
    const msgs = heads([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(phaseEntryMessages(msgs).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("5. chain の tail にQRがある場合、その chain を含めて停止", () => {
    // a→a2(QR) は1 chain（a が head, a2 が continuation）。その後の独立 head b は送らない。
    const msgs: QrPreviewMessage[] = [
      { id: "a",  sort_order: 10, phase_id: "P", next_message_id: "a2" },
      { id: "a2", sort_order: 10, phase_id: "P", has_quick_reply: true },
      { id: "b",  sort_order: 20, phase_id: "P" },
    ];
    expect(phaseEntryMessages(msgs).map((m) => m.id)).toEqual(["a", "a2"]);
  });

  it("9. has_quick_reply 未定義でも落ちない（QR無し扱い）", () => {
    const msgs = heads([{ id: "a" }, { id: "b" }]); // has_quick_reply 無し
    expect(phaseEntryMessages(msgs).map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("previewQrSend（phase_entry の overLimit）", () => {
  const phaseEntry = (target_phase_id: string, all: QrPreviewMessage[]) =>
    previewQrSend({ target_phase_id }, all);

  it("6. フェーズ総数が22通でも、入場送信がQRで5通以内に収まれば overLimit=false", () => {
    // a..e(5通) の後に f が QR を持ち、その後に大量の head（入場では送られない）。
    const big: QrPreviewMessage[] = [
      ...heads([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e", has_quick_reply: true }]),
      ...Array.from({ length: 17 }, (_, i) => ({ id: `x${i}`, sort_order: 1000 + i, phase_id: "P" })),
    ];
    const pv = phaseEntry("P", big);
    expect(pv.mode).toBe("phase_entry");
    expect(pv.total).toBe(5);
    expect(pv.overLimit).toBe(false);
  });

  it("7. 入場送信自体が6通以上なら overLimit=true（QR/free_input が6通目以降に無い場合）", () => {
    const six = heads([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }, { id: "f" }]);
    const pv = phaseEntry("P", six);
    expect(pv.total).toBe(6);
    expect(pv.overLimit).toBe(true);
    expect(pv.overflowKind).toBe("push");
  });

  it("8. 該当フェーズのメッセージが無くても落ちず 0通", () => {
    const pv = phaseEntry("P_none", heads([{ id: "a", phase_id: "P_other" }]));
    expect(pv.total).toBe(0);
    expect(pv.overLimit).toBe(false);
  });
});
