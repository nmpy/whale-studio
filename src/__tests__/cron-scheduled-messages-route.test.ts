/**
 * src/__tests__/cron-scheduled-messages-route.test.ts
 * Cron route POST /api/cron/scheduled-messages の認証ゲートと「件数のみ返す（PII なし）」を検証。
 * prisma は最小モック（findMany→[]）。実 push は呼ばれない（no-op sender）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// prisma を最小モック（worker が触る範囲だけ）。findMany は due/stuck の両方で呼ばれるため [] を返す。
vi.mock("@/lib/prisma", () => ({
  prisma: {
    scheduledLineMessage: {
      findMany:   vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
      update:     vi.fn(async () => ({})),
    },
    userProgress: { findUnique: vi.fn(async () => null) },
    oa:           { findUnique: vi.fn(async () => null) },
    character:    { findUnique: vi.fn(async () => null) },
  },
}));

import { POST } from "@/app/api/cron/scheduled-messages/route";
import { prisma } from "@/lib/prisma";

const SECRET = "test-cron-secret";

function reqWith(authHeader?: string) {
  return { headers: { get: (k: string) => (k.toLowerCase() === "authorization" ? (authHeader ?? null) : null) } } as never;
}

describe("POST /api/cron/scheduled-messages — 認証", () => {
  const orig = process.env.CRON_SECRET;
  const origFlag = process.env.ENABLE_SCHEDULED_MESSAGE_WORKER;
  beforeEach(() => { process.env.CRON_SECRET = SECRET; delete process.env.ENABLE_SCHEDULED_MESSAGE_WORKER; vi.clearAllMocks(); });
  afterEach(() => { process.env.CRON_SECRET = orig; process.env.ENABLE_SCHEDULED_MESSAGE_WORKER = origFlag; });

  it("CRON_SECRET 未設定 → 401（外部から実行不可）", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(reqWith(`Bearer ${SECRET}`));
    expect(res.status).toBe(401);
    expect((prisma.scheduledLineMessage.findMany as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("Authorization ヘッダなし → 401", async () => {
    const res = await POST(reqWith(undefined));
    expect(res.status).toBe(401);
  });

  it("Bearer 不一致 → 401（worker は呼ばれない）", async () => {
    const res = await POST(reqWith("Bearer wrong"));
    expect(res.status).toBe(401);
    expect((prisma.scheduledLineMessage.findMany as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("正しい Bearer（flag 未設定）→ 200・dryRun・worker 実行（findMany 呼出）・件数のみ返す（PII/token なし）", async () => {
    const res = await POST(reqWith(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect((prisma.scheduledLineMessage.findMany as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    const json = await res.json();
    expect(json).toEqual({ success: true, data: { claimed: 0, canceled: 0, skipped: 0, sent: 0, failed: 0, retried: 0, recovered: 0, errors: 0, dryRun: true } });
    // レスポンスに PII/token を示すキーが無いこと。
    const keys = Object.keys(json.data);
    expect(keys).not.toContain("lineUserId");
    expect(keys).not.toContain("payload");
    expect(JSON.stringify(json)).not.toContain(SECRET);
  });

  it("ENABLE_SCHEDULED_MESSAGE_WORKER 未設定 → dryRun: DB を変更しない（updateMany/update を呼ばない）", async () => {
    await POST(reqWith(`Bearer ${SECRET}`));
    expect((prisma.scheduledLineMessage.updateMany as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((prisma.scheduledLineMessage.update as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("flag 未設定で due 行があっても: push(fetch) を呼ばず DB を一切変更しない（完全 dryRun）", async () => {
    // due な pending 行を1件返すよう findMany を where 依存で上書き（stuck 検索には [] を返す）。
    (prisma.scheduledLineMessage.findMany as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where }: { where: { status: string } }) =>
        where.status === "pending"
          ? [{ id: "r1", workId: "w1", lineUserId: "U1", userProgressId: null, phaseId: null, cancelPolicyJson: null, oaId: "oa1", payloadJson: JSON.stringify({ message_type: "text", body: "x" }), retryCount: 0 }]
          : [],
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(reqWith(`Bearer ${SECRET}`));
    const json = await res.json();
    expect(json.data.dryRun).toBe(true);
    expect(json.data.claimed).toBe(1); // would-send（評価のみ）
    expect(fetchSpy).not.toHaveBeenCalled(); // 実 push なし
    expect((prisma.scheduledLineMessage.updateMany as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled(); // claim なし
    expect((prisma.scheduledLineMessage.update as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();     // sent/failed/cancel なし
    vi.unstubAllGlobals();
  });

  it("ENABLE_SCHEDULED_MESSAGE_WORKER=true → live mode（dryRun:false）で worker が走る", async () => {
    process.env.ENABLE_SCHEDULED_MESSAGE_WORKER = "true";
    const res = await POST(reqWith(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.dryRun).toBe(false);
    // 対象行が無い（findMany→[]）ため実 push もDB変更も発生しないが、live で実行されたこと自体は dryRun:false で確認。
    expect(JSON.stringify(json)).not.toContain(SECRET);
  });
});
