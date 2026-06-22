/**
 * src/__tests__/line-quota.test.ts
 * LINE 月間メッセージ使用状況のレベル判定（70%注意 / 90%警告 / 100%送信失敗リスク）と
 * 使用状況サマリ集約（getOaQuotaUsage）の純ロジック。実 LINE API 呼び出しは fetch をモックして検証。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveQuotaLevel, getOaQuotaUsage } from "@/lib/line-quota";

describe("resolveQuotaLevel — しきい値 70/90/100%", () => {
  it("上限なし（type=none）→ unlimited", () => {
    expect(resolveQuotaLevel({ type: "none", ratio: null })).toBe("unlimited");
  });
  it("取得失敗（type=unknown / ratio=null）→ unknown", () => {
    expect(resolveQuotaLevel({ type: "unknown", ratio: null })).toBe("unknown");
    expect(resolveQuotaLevel({ type: "limited", ratio: null })).toBe("unknown");
    expect(resolveQuotaLevel({ type: "limited", ratio: NaN })).toBe("unknown");
  });
  it("70%未満 → ok", () => {
    expect(resolveQuotaLevel({ type: "limited", ratio: 0 })).toBe("ok");
    expect(resolveQuotaLevel({ type: "limited", ratio: 0.69 })).toBe("ok");
  });
  it("70%以上 → notice", () => {
    expect(resolveQuotaLevel({ type: "limited", ratio: 0.7 })).toBe("notice");
    expect(resolveQuotaLevel({ type: "limited", ratio: 0.89 })).toBe("notice");
  });
  it("90%以上 → warn", () => {
    expect(resolveQuotaLevel({ type: "limited", ratio: 0.9 })).toBe("warn");
    expect(resolveQuotaLevel({ type: "limited", ratio: 0.99 })).toBe("warn");
  });
  it("100%以上 → over", () => {
    expect(resolveQuotaLevel({ type: "limited", ratio: 1 })).toBe("over");
    expect(resolveQuotaLevel({ type: "limited", ratio: 1.5 })).toBe("over");
  });
});

describe("getOaQuotaUsage — quota + consumption の集約", () => {
  afterEach(() => vi.unstubAllGlobals());

  const mockFetch = (quota: unknown, consumption: unknown) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = String(url).includes("consumption") ? consumption : quota;
      return { ok: true, json: async () => body } as Response;
    }));
  };

  it("コミュニケーションプラン想定: 200通中120通 → remaining 80 / ratio 0.6 / ok", async () => {
    mockFetch({ type: "limited", value: 200 }, { totalUsage: 120 });
    const u = await getOaQuotaUsage("token");
    expect(u).toMatchObject({ type: "limited", limit: 200, used: 120, remaining: 80, level: "ok" });
    expect(u.ratio).toBeCloseTo(0.6);
  });

  it("200通中180通 → 90% warn", async () => {
    mockFetch({ type: "limited", value: 200 }, { totalUsage: 180 });
    expect((await getOaQuotaUsage("token")).level).toBe("warn");
  });

  it("200通中200通 → over・remaining 0", async () => {
    mockFetch({ type: "limited", value: 200 }, { totalUsage: 200 });
    const u = await getOaQuotaUsage("token");
    expect(u.level).toBe("over");
    expect(u.remaining).toBe(0);
  });

  it("上限なし（type=none）→ unlimited・used は表示", async () => {
    mockFetch({ type: "none" }, { totalUsage: 500 });
    expect(await getOaQuotaUsage("token")).toMatchObject({ type: "none", level: "unlimited", used: 500, limit: null });
  });

  it("quota 取得失敗（fetch 非ok）→ unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "{}" } as Response)));
    expect((await getOaQuotaUsage("token")).level).toBe("unknown");
  });

  it("channelAccessToken 空 → unknown（API を叩かない）", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await getOaQuotaUsage("")).level).toBe("unknown");
    expect(f).not.toHaveBeenCalled();
  });
});
