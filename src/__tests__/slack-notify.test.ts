// src/__tests__/slack-notify.test.ts
//
// notifySlack の挙動を検証する。
//
// 検証:
//   1. webhookUrl 未設定 (= undefined / null / "") → silent no-op
//   2. 成功時 (= 2xx) → throw しない / fetch に正しい URL + body を渡す
//   3. 失敗時 (= 非 2xx) → throw する (= 呼び出し側で catch するため)

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { notifySlack } from "@/lib/slack/notify";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notifySlack", () => {
  it("webhookUrl が undefined なら fetch を呼ばず no-op", async () => {
    await notifySlack({ text: "hi" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("webhookUrl が null なら fetch を呼ばず no-op", async () => {
    await notifySlack({ webhookUrl: null, text: "hi" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("webhookUrl が空文字なら fetch を呼ばず no-op", async () => {
    await notifySlack({ webhookUrl: "", text: "hi" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("webhookUrl 設定済 + 2xx 応答なら throw せず終了 + 正しい body で POST する", async () => {
    mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));
    await expect(
      notifySlack({
        webhookUrl: "https://hooks.slack.com/services/XXX",
        text:       "hello",
        blocks:     [{ type: "section", text: { type: "mrkdwn", text: "ok" } }],
      }),
    ).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/services/XXX");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body.text).toBe("hello");
    expect(body.blocks).toHaveLength(1);
  });

  it("非 2xx 応答なら throw する (= 呼び出し側で catch 想定)", async () => {
    mockFetch.mockResolvedValue(
      new Response("invalid_payload", { status: 400 }),
    );
    await expect(
      notifySlack({ webhookUrl: "https://hooks.slack.com/services/XXX", text: "hi" }),
    ).rejects.toThrow(/Slack webhook responded 400/);
  });

  it("throw されるエラーメッセージに webhook URL は含まれない (= secret 保護)", async () => {
    const secretUrl = "https://hooks.slack.com/services/SECRET_TOKEN";
    mockFetch.mockResolvedValue(new Response("err", { status: 500 }));
    try {
      await notifySlack({ webhookUrl: secretUrl, text: "hi" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as Error).message).not.toContain("SECRET_TOKEN");
    }
  });
});
