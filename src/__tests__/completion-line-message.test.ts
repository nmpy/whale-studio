// src/__tests__/completion-line-message.test.ts
// 完了後ボタン action="send_line_message" の送信処理。
// 最重要: 送信されるのは「送信文言(message)」だけで、「ボタン文言(label)」は絶対に送らない。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendCompletionLineMessage, type LiffLike } from "@/components/liff/completion-line-message";
import { resolveCompletionButton } from "@/lib/liff/survey-completion";
import type { LiffPageConfigSettings } from "@/types";

const S = (o: Partial<LiffPageConfigSettings>): LiffPageConfigSettings => o as LiffPageConfigSettings;

function mockLiff(over: { isInClient?: () => boolean; sendThrows?: boolean } = {}): LiffLike & {
  sendMessages: ReturnType<typeof vi.fn>;
  closeWindow: ReturnType<typeof vi.fn>;
  isInClient: ReturnType<typeof vi.fn>;
} {
  return {
    isInClient: vi.fn(() => over.isInClient?.() ?? true),
    sendMessages: vi.fn(async () => {
      if (over.sendThrows) throw new Error("boom");
      return undefined;
    }),
    closeWindow: vi.fn(() => {}),
  } as never;
}

describe("sendCompletionLineMessage", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {}); // 技術エラーは console のみ
  });

  it("LIFF 実機: 設定した送信文言を text として送り closeWindow して sent", async () => {
    const liff = mockLiff();
    const res = await sendCompletionLineMessage({ message: "参加を申し込みます", load: async () => liff });
    expect(res).toBe("sent");
    expect(liff.sendMessages).toHaveBeenCalledTimes(1);
    expect(liff.sendMessages).toHaveBeenCalledWith([{ type: "text", text: "参加を申し込みます" }]);
    expect(liff.closeWindow).toHaveBeenCalledTimes(1);
  });

  it("送信文言は trim して送る", async () => {
    const liff = mockLiff();
    await sendCompletionLineMessage({ message: "  申し込みます  ", load: async () => liff });
    expect(liff.sendMessages).toHaveBeenCalledWith([{ type: "text", text: "申し込みます" }]);
  });

  it("送信文言が未設定 / 空白のみ: 何も送らず skipped（空メッセージを送らない）", async () => {
    const load = vi.fn();
    expect(await sendCompletionLineMessage({ message: undefined, load })).toBe("skipped");
    expect(await sendCompletionLineMessage({ message: null, load })).toBe("skipped");
    expect(await sendCompletionLineMessage({ message: "   ", load })).toBe("skipped");
    expect(load).not.toHaveBeenCalled();
  });

  it("preview: LIFF を呼ばず sent（実送信・close をしない）", async () => {
    const load = vi.fn();
    expect(await sendCompletionLineMessage({ message: "送るよ", preview: true, load })).toBe("sent");
    expect(load).not.toHaveBeenCalled();
  });

  it("LIFF 外（isInClient=false）: 送信せず unsupported", async () => {
    const liff = mockLiff({ isInClient: () => false });
    expect(await sendCompletionLineMessage({ message: "x", load: async () => liff })).toBe("unsupported");
    expect(liff.sendMessages).not.toHaveBeenCalled();
    expect(liff.closeWindow).not.toHaveBeenCalled();
  });

  it("sendMessages 例外: error を返し closeWindow しない", async () => {
    const liff = mockLiff({ sendThrows: true });
    expect(await sendCompletionLineMessage({ message: "x", load: async () => liff })).toBe("error");
    expect(liff.closeWindow).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("load 自体が失敗しても error（例外を握る）", async () => {
    const res = await sendCompletionLineMessage({ message: "x", load: async () => { throw new Error("import fail"); } });
    expect(res).toBe("error");
  });

  // ── label と message の分離（本機能の中核） ──────────────────
  it("ボタン文言(label)は LINE へ送られない — 送られるのは送信文言(message)のみ", async () => {
    const settings = S({
      survey_completion_button_enabled: true,
      survey_completion_button_action:  "send_line_message",
      survey_completion_button_label:   "参加する",       // 画面表示用
      survey_completion_button_message: "参加を申し込みます", // 実送信用
    });
    const btn = resolveCompletionButton(settings);
    expect(btn.label).toBe("参加する");
    expect(btn.message).toBe("参加を申し込みます");

    const liff = mockLiff();
    await sendCompletionLineMessage({ message: btn.message, load: async () => liff });

    const sentText = liff.sendMessages.mock.calls[0][0][0].text;
    expect(sentText).toBe("参加を申し込みます");
    expect(sentText).not.toBe(btn.label);
    expect(sentText).not.toContain("参加する");
  });
});
