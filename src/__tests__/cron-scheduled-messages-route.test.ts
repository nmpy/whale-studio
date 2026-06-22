/**
 * src/__tests__/cron-scheduled-messages-route.test.ts
 * Cron route POST /api/cron/scheduled-messages の認証ゲートと「件数のみ返す（PII なし）」を検証。
 * prisma は最小モック（findMany→[]）。実 push は呼ばれない（no-op sender）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// prisma を最小モック（worker が触る範囲だけ）。
vi.mock("@/lib/prisma", () => ({
  prisma: {
    scheduledLineMessage: {
      findMany:   vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
      update:     vi.fn(async () => ({})),
    },
    userProgress: { findUnique: vi.fn(async () => null) },
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
  beforeEach(() => { process.env.CRON_SECRET = SECRET; vi.clearAllMocks(); });
  afterEach(() => { process.env.CRON_SECRET = orig; });

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

  it("正しい Bearer → 200・worker 実行（findMany 呼出）・件数のみ返す（PII/token なし）", async () => {
    const res = await POST(reqWith(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect((prisma.scheduledLineMessage.findMany as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    const json = await res.json();
    expect(json).toEqual({ success: true, data: { claimed: 0, canceled: 0, skipped: 0, sent: 0, errors: 0 } });
    // レスポンスに PII/token を示すキーが無いこと。
    const keys = Object.keys(json.data);
    expect(keys).not.toContain("lineUserId");
    expect(keys).not.toContain("payload");
    expect(JSON.stringify(json)).not.toContain(SECRET);
  });
});
