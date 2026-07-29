import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendRegisterReport, REGISTER_REPORT_MESSAGE, type LiffLike } from "@/components/liff/register-report";

function mockLiff(over: Partial<LiffLike> & { sendThrows?: boolean } = {}): LiffLike & {
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

describe("register-report", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {}); // 技術エラーは console のみ・テスト出力を汚さない
  });

  it("固定メッセージは句読点含め不変（自動応答キーワード）", () => {
    expect(REGISTER_REPORT_MESSAGE).toBe("エージェント登録を完了しました。");
  });

  it("preview は LIFF を呼ばず sent", async () => {
    const load = vi.fn();
    expect(await sendRegisterReport({ preview: true, load })).toBe("sent");
    expect(load).not.toHaveBeenCalled();
  });

  it("LIFF 実機（isInClient=true）: 固定 text を送信し closeWindow して sent", async () => {
    const liff = mockLiff();
    const res = await sendRegisterReport({ load: async () => liff });
    expect(res).toBe("sent");
    expect(liff.sendMessages).toHaveBeenCalledTimes(1);
    expect(liff.sendMessages).toHaveBeenCalledWith([{ type: "text", text: "エージェント登録を完了しました。" }]);
    expect(liff.closeWindow).toHaveBeenCalledTimes(1);
  });

  it("LIFF 外（isInClient=false）: 送信せず unsupported", async () => {
    const liff = mockLiff({ isInClient: () => false });
    const res = await sendRegisterReport({ load: async () => liff });
    expect(res).toBe("unsupported");
    expect(liff.sendMessages).not.toHaveBeenCalled();
    expect(liff.closeWindow).not.toHaveBeenCalled();
  });

  it("sendMessages 例外: error を返し closeWindow しない（回答は保持済み・画面には技術詳細を出さない）", async () => {
    const liff = mockLiff({ sendThrows: true });
    const res = await sendRegisterReport({ load: async () => liff });
    expect(res).toBe("error");
    expect(liff.closeWindow).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("load 自体が失敗しても error（例外を握る）", async () => {
    const res = await sendRegisterReport({ load: async () => { throw new Error("import fail"); } });
    expect(res).toBe("error");
  });
});
