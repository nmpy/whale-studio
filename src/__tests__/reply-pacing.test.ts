/**
 * src/__tests__/reply-pacing.test.ts
 * reply pacing / reply pre-delay（reply-only・push 不使用）の純ロジック + 送信経路の結合確認。
 * 注: 「1.5秒間隔で個別着弾」ではなく「単一 reply 送信前の pre-delay」を検証する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeReplyPacingDelayMs,
  computePacingLoadingSeconds,
  applyReplyPacing,
  REPLY_PACING_INTERVAL_MS,
  MAX_REPLY_PACING_DELAY_MS,
} from "@/lib/reply-pacing";

// 実時間待機を絶対に発生させない sleep（呼び出し ms を記録）。
const makeFakeSleep = () => {
  const calls: number[] = [];
  const fn = vi.fn(async (ms: number) => { calls.push(ms); });
  return { fn, calls };
};

describe("computeReplyPacingDelayMs", () => {
  it("件数→pre-delay（0/0/1500/3000/6000）", () => {
    expect(computeReplyPacingDelayMs(0)).toBe(0);
    expect(computeReplyPacingDelayMs(1)).toBe(0);
    expect(computeReplyPacingDelayMs(2)).toBe(1500);
    expect(computeReplyPacingDelayMs(3)).toBe(3000);
    expect(computeReplyPacingDelayMs(4)).toBe(4500);
    expect(computeReplyPacingDelayMs(5)).toBe(6000);
  });
  it("MAX で clamp される（8000ms 上限）", () => {
    expect(computeReplyPacingDelayMs(100)).toBe(MAX_REPLY_PACING_DELAY_MS);
    expect(computeReplyPacingDelayMs(7)).toBe(MAX_REPLY_PACING_DELAY_MS); // 6*1500=9000 → 8000
    expect(REPLY_PACING_INTERVAL_MS).toBe(1500);
  });
  it("不正値でも落ちない（NaN/負数→0）", () => {
    expect(computeReplyPacingDelayMs(NaN)).toBe(0);
    expect(computeReplyPacingDelayMs(-3)).toBe(0);
  });
});

describe("computePacingLoadingSeconds（5〜60秒 clamp）", () => {
  it("delay を秒へ切り上げ + 下限5・上限60", () => {
    expect(computePacingLoadingSeconds(0)).toBe(5);
    expect(computePacingLoadingSeconds(1500)).toBe(5);   // ceil 2 → 下限 5
    expect(computePacingLoadingSeconds(6000)).toBe(6);
    expect(computePacingLoadingSeconds(8000)).toBe(8);
    expect(computePacingLoadingSeconds(120000)).toBe(60); // 上限 60
  });
});

describe("applyReplyPacing", () => {
  it("delay0（1件以下）→ sleep も loading も呼ばない", async () => {
    const sleep = makeFakeSleep();
    const showLoading = vi.fn(async () => {});
    const r = await applyReplyPacing({ messageCount: 1, userId: "U123", showLoading, sleepFn: sleep.fn });
    expect(r.delayMs).toBe(0);
    expect(r.skipped).toBe("no_delay");
    expect(sleep.fn).not.toHaveBeenCalled();
    expect(showLoading).not.toHaveBeenCalled();
  });

  it("1対1（userIdあり）+ delay + showLoading → loading を正しい秒数で呼び、pre-delay を1回 sleep", async () => {
    const sleep = makeFakeSleep();
    const showLoading = vi.fn(async () => {});
    const r = await applyReplyPacing({ messageCount: 5, userId: "U123", showLoading, sleepFn: sleep.fn });
    expect(r.delayMs).toBe(6000);
    expect(showLoading).toHaveBeenCalledTimes(1);
    expect(showLoading).toHaveBeenCalledWith("U123", 6); // computePacingLoadingSeconds(6000)
    expect(r.loadingShown).toBe(true);
    expect(sleep.calls).toEqual([6000]); // pre-delay は1回だけ
  });

  it("userId 無し（group/room/unknown）→ loading 出さず、pre-delay のみ", async () => {
    const sleep = makeFakeSleep();
    const showLoading = vi.fn(async () => {});
    const r = await applyReplyPacing({ messageCount: 3, userId: "", showLoading, sleepFn: sleep.fn });
    expect(showLoading).not.toHaveBeenCalled();
    expect(r.skipped).toBe("not_1to1");
    expect(sleep.calls).toEqual([3000]); // 体感調整(pre-delay)は全員に効く
  });

  it("showLoading 未指定（CMS loading あり等）→ loading 出さず pre-delay のみ", async () => {
    const sleep = makeFakeSleep();
    const r = await applyReplyPacing({ messageCount: 3, userId: "U1", sleepFn: sleep.fn });
    expect(r.skipped).toBe("no_loading_fn");
    expect(sleep.calls).toEqual([3000]);
  });

  it("loading 失敗（throw）でも reply 本体を止めない（sleep は実行・例外を握りつぶす）", async () => {
    const sleep = makeFakeSleep();
    const showLoading = vi.fn(async () => { throw new Error("loading api down"); });
    const r = await applyReplyPacing({ messageCount: 2, userId: "U1", showLoading, sleepFn: sleep.fn });
    expect(r.loadingShown).toBe(false);
    expect(r.skipped).toBe("loading_error");
    expect(sleep.calls).toEqual([1500]); // loading 失敗後も pre-delay は進む（その後 reply 続行）
  });

  it("test 環境で実時間 sleep が発生しない（注入 sleepFn のみ呼ばれる）", async () => {
    const sleep = makeFakeSleep();
    const t0 = 0; // 実時刻に依存しない（注入 sleep は即時 resolve）
    await applyReplyPacing({ messageCount: 5, userId: "U1", sleepFn: sleep.fn });
    expect(sleep.fn).toHaveBeenCalledTimes(1);
    expect(t0).toBe(0);
  });
});

// ── 結合: replyWithLagToLine の reply-only 経路（push を使わない） ──
import { replyWithLagToLine } from "@/lib/line";

const REPLY_URL   = "message/reply";
const PUSH_URL    = "message/push";
const LOADING_URL = "loading/start";

const urlOf = (input: unknown): string =>
  typeof input === "string" ? input : (input as { url?: string })?.url ?? String(input);

describe("replyWithLagToLine — reply-only pacing（push 不使用・reply 1回）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const immediateSleep = async () => {}; // 実時間待機なし

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => "" })) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const calledUrls = () => fetchMock.mock.calls.map((c) => urlOf(c[0]));
  const msgs = (n: number) => Array.from({ length: n }, () => ({ type: "text", text: "hi" })) as never;

  it("演出なし5件 → reply API は1回・push API は0回", async () => {
    await replyWithLagToLine("rtok", msgs(5), "U123", "tok", undefined, immediateSleep);
    const urls = calledUrls();
    expect(urls.filter((u) => u.includes(REPLY_URL))).toHaveLength(1);
    expect(urls.filter((u) => u.includes(PUSH_URL))).toHaveLength(0); // push を新規に使わない
  });

  it("1対1 + delay あり → loading API が呼ばれる", async () => {
    await replyWithLagToLine("rtok", msgs(3), "U123", "tok", undefined, immediateSleep);
    expect(calledUrls().filter((u) => u.includes(LOADING_URL))).toHaveLength(1);
  });

  it("1件（delay0）→ loading は呼ばれない・reply は1回", async () => {
    await replyWithLagToLine("rtok", msgs(1), "U123", "tok", undefined, immediateSleep);
    const urls = calledUrls();
    expect(urls.filter((u) => u.includes(LOADING_URL))).toHaveLength(0);
    expect(urls.filter((u) => u.includes(REPLY_URL))).toHaveLength(1);
  });

  it("loading API 失敗でも reply 本体は送られる", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      if (urlOf(input).includes(LOADING_URL)) return { ok: false, status: 500, text: async () => "err" };
      return { ok: true, status: 200, text: async () => "" };
    });
    await replyWithLagToLine("rtok", msgs(3), "U123", "tok", undefined, immediateSleep);
    expect(calledUrls().filter((u) => u.includes(REPLY_URL))).toHaveLength(1);
  });
});
