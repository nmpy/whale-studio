// src/__tests__/broadcast-cron-route.test.ts
//
// 配信 worker の cron エンドポイントの認証と、構造上の禁止事項を固定する。
// - CRON_SECRET 未設定 / 不一致 は必ず 401（fail closed）
// - 管理画面セッションを cron 認証の代用にしない
// - secret / 本文 / 宛先 ID をレスポンスやログに出さない
// - cron から admin HTTP API を叩き直さない（shared service を直接呼ぶ）
// - 既存「応答メッセージ」側には一切触れない

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** 行コメントを除いたソース。コメント内の言及を実装と誤検出しないため。 */
const readCode = (p: string) =>
  read(p).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const ROUTE = "src/app/api/cron/broadcast-worker/route.ts";
const WORKER = "src/lib/broadcast/worker.ts";

const mocks = vi.hoisted(() => ({
  processBroadcastChunk: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { broadcast: { findMany: mocks.findMany } } }));
vi.mock("@/lib/broadcast/processor", async (orig) => ({
  ...(await orig<typeof import("@/lib/broadcast/processor")>()),
  processBroadcastChunk: mocks.processBroadcastChunk,
}));

const makeReq = (auth?: string) =>
  ({ headers: { get: (k: string) => (k.toLowerCase() === "authorization" ? auth ?? null : null) } }) as never;

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
});
afterEach(() => { process.env = { ...ENV }; });

async function callGet(auth?: string) {
  const { GET } = await import("@/app/api/cron/broadcast-worker/route");
  const res = await GET(makeReq(auth));
  return { status: res.status, body: await res.json() };
}

// ══════════════════════════════════════════════════════════════════
describe("A. cron 認証", () => {
  it("CRON_SECRET 未設定なら 401（fail closed、無認証で動かさない）", async () => {
    delete process.env.CRON_SECRET;
    const r = await callGet("Bearer whatever");
    expect(r.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("Authorization ヘッダが無ければ 401", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await callGet(undefined)).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("secret が一致しなければ 401", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await callGet("Bearer wrong")).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("正しい secret なら 200 で worker が動く", async () => {
    process.env.CRON_SECRET = "s3cret";
    const r = await callGet("Bearer s3cret");
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });

  it("401 レスポンスに secret を含めない", async () => {
    process.env.CRON_SECRET = "super-secret-value";
    const r = await callGet("Bearer wrong");
    expect(JSON.stringify(r.body)).not.toContain("super-secret-value");
  });

  it("ログに secret を出さない", async () => {
    process.env.CRON_SECRET = "super-secret-value";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await callGet("Bearer super-secret-value");
    const logged = spy.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain("super-secret-value");
    spy.mockRestore();
  });

  it("管理画面のセッション/RBAC を cron 認証の代用にしていない", () => {
    const src = readCode(ROUTE);
    for (const forbidden of ["withAuth", "withRole", "requireRole", "getServerSession", "next-auth"]) {
      expect(src).not.toContain(forbidden);
    }
  });
});

// ══════════════════════════════════════════════════════════════════
describe("live mode ゲート", () => {
  it("ENABLE_BROADCAST_WORKER 未設定なら dryRun（1 通も送らない）", async () => {
    process.env.CRON_SECRET = "s3cret";
    delete process.env.ENABLE_BROADCAST_WORKER;
    mocks.findMany.mockResolvedValue([{ id: "b1", oaId: "oa1" }]);
    const r = await callGet("Bearer s3cret");
    expect(r.body.dryRun).toBe(true);
    expect(mocks.processBroadcastChunk).not.toHaveBeenCalled();
  });

  it("ENABLE_BROADCAST_WORKER=true のときだけ実送信する", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.ENABLE_BROADCAST_WORKER = "true";
    mocks.findMany.mockResolvedValue([{ id: "b1", oaId: "oa1" }]);
    mocks.processBroadcastChunk.mockResolvedValue({
      ok: true, processed: 2, sent: 2, failed: 0, skipped: 0, hasMore: false, status: "sent",
    });
    const r = await callGet("Bearer s3cret");
    expect(r.body.dryRun).toBe(false);
    expect(mocks.processBroadcastChunk).toHaveBeenCalledWith({ oaId: "oa1", broadcastId: "b1" });
    expect(r.body.sent).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("対象選択", () => {
  it("status=sending の Broadcast だけを取得する（draft を勝手に送らない）", async () => {
    process.env.CRON_SECRET = "s3cret";
    await callGet("Bearer s3cret");
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ status: "sending" });
    expect(JSON.stringify(where)).not.toContain("draft");
  });

  it("古い配信から順に処理する", async () => {
    process.env.CRON_SECRET = "s3cret";
    await callGet("Bearer s3cret");
    expect(mocks.findMany.mock.calls[0][0].orderBy).toEqual({ startedAt: "asc" });
  });

  it("1 invocation で取る件数に上限がある", async () => {
    process.env.CRON_SECRET = "s3cret";
    await callGet("Bearer s3cret");
    const take = mocks.findMany.mock.calls[0][0].take;
    expect(typeof take).toBe("number");
    expect(take).toBeGreaterThan(0);
    expect(take).toBeLessThanOrEqual(20); // 根拠のない巨大バッチにしない
  });

  it("宛先本体（lineUserId）や本文を select していない", async () => {
    process.env.CRON_SECRET = "s3cret";
    await callGet("Bearer s3cret");
    expect(mocks.findMany.mock.calls[0][0].select).toEqual({ id: true, oaId: true });
  });
});

// ══════════════════════════════════════════════════════════════════
describe("構造上の禁止事項", () => {
  const routeSrc = readCode(ROUTE);
  const workerSrc = readCode(WORKER);

  it("cron から admin の HTTP API を叩き直さない（shared service を直接呼ぶ）", () => {
    for (const src of [routeSrc, workerSrc]) {
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toContain("/api/oas/");
    }
    expect(routeSrc).toContain("processBroadcastChunk");
  });

  it("送信ロジックを複製していない（worker は LINE API を直接叩かない）", () => {
    for (const src of [routeSrc, workerSrc]) {
      expect(src).not.toContain("pushToLine");
      expect(src).not.toContain("api.line.me");
      expect(src).not.toContain("multicast");
      expect(src).not.toContain("X-Line-Retry-Key");
    }
  });

  it("worker が独自の集計・完了判定を持たない（既存 finalization に委ねる）", () => {
    expect(workerSrc).not.toContain("finalStatusOf");
    expect(workerSrc).not.toContain("completedAt");
    expect(workerSrc).not.toContain("successCount");
  });

  it("worker は DB を直接更新しない（prisma を import しない）", () => {
    expect(workerSrc).not.toContain("@/lib/prisma");
    expect(workerSrc).not.toMatch(/prisma\./);
  });

  it("新しい locking / queue 基盤を持ち込んでいない", () => {
    for (const src of [routeSrc, workerSrc]) {
      for (const forbidden of ["redis", "Redis", "qstash", "QStash", "sqs", "SQS", "advisory_lock", "pg_advisory"]) {
        expect(src).not.toContain(forbidden);
      }
    }
  });

  it("module scope の可変 state に依存していない（invocation をまたいで持ち越さない）", () => {
    expect(workerSrc).not.toMatch(/^(let|var)\s/m);
    expect(routeSrc).not.toMatch(/^(let|var)\s/m);
  });

  it("既存「応答メッセージ」側のモジュールを参照していない", () => {
    for (const src of [routeSrc, workerSrc]) {
      for (const forbidden of ["scheduled-message", "uzu-outbox", "webhook", "@/lib/message"]) {
        expect(src).not.toContain(forbidden);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════
describe("cron 登録", () => {
  const vercelJson = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };

  it("vercel.json に配信 worker の cron が登録されている", () => {
    const c = vercelJson.crons.find((x) => x.path === "/api/cron/broadcast-worker");
    expect(c).toBeTruthy();
    expect(c!.schedule).toBe("* * * * *");
  });

  it("既存 cron（応答メッセージ系）を消していない", () => {
    const paths = vercelJson.crons.map((c) => c.path);
    expect(paths).toContain("/api/cron/scheduled-messages");
    expect(paths).toContain("/api/cron/uzu-outbox");
  });

  it("実行時間の上限を宣言している", () => {
    expect(readCode(ROUTE)).toMatch(/export const maxDuration\s*=\s*60/);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("Phase 3/9. ブラウザが配信完了条件になっていない", () => {
  const newPage = readCode("src/app/oas/[id]/broadcasts/new/page.tsx");
  const detail  = readCode("src/app/oas/[id]/broadcasts/[broadcastId]/page.tsx");

  it("送信画面が全 chunk を回すループを持たない", () => {
    expect(newPage).not.toMatch(/for\s*\(;;\)/);
    expect(newPage).not.toContain("has_more");
  });

  it("詳細画面が全 chunk を回すループを持たない", () => {
    expect(detail).not.toMatch(/for\s*\(;;\)/);
    expect(detail).not.toContain("has_more");
  });

  it("送信中はブラウザを閉じてよいことを画面上で説明している", () => {
    expect(detail).toContain("閉じても");
  });

  it("進捗は DB を polling して表示する（クライアント state を正としない）", () => {
    expect(detail).toContain("setInterval");
    expect(detail).toContain("broadcastApi.get");
  });
});
