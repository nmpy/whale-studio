// src/__tests__/broadcast-request-id.test.ts
//
// 配信の observability 拡張: LINE の応答ヘッダ（x-line-request-id /
// x-line-accepted-request-id）を BroadcastRecipient に永続化する。
//
// **observability-only change** であることをテストで固定する。
// payload / retry key / retry 動作 / cron 選択条件 / 成否判定 / status 遷移 / 集計は
// 一切変えていないことを併せて検証する。
//
// LINE 公式仕様（Messaging API reference / Retrying an API request）:
//   - x-line-request-id … 各リクエストに発行される ID。2xx にも 409 にも含まれる
//   - x-line-accepted-request-id … 409（同じ retry key が既に受理済み）のときだけ返る。
//     409 の x-line-request-id は「却下された再試行」の ID なので、実際に受理された
//     送信を辿るには accepted 側を見る

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const readCode = (p: string) =>
  read(p).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const REQ_ID = "123e4567-e89b-12d3-a456-426655440002";
const ACCEPTED_ID = "123e4567-e89b-12d3-a456-426655440001";
const TOKEN = "super-secret-channel-access-token";
const FULL_USER_ID = "U6475933f4f0fc8194bed3f24eb74b4ef";

// ── pushToLine を実 fetch で動かすための最小 mock ───────────────
vi.mock("@/lib/puzzle-history", () => ({ recordPuzzleDeliveries: vi.fn() }));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

/** headers を持つ最小の Response 風オブジェクト。 */
const res = (status: number, headers: Record<string, string> = {}, body = "{}") => {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null },
    text: async () => body,
  } as unknown as Response;
};

const push = async (opts?: { retryKey?: string }) => {
  const { pushToLine } = await import("@/lib/line");
  return pushToLine(FULL_USER_ID, [{ type: "text", text: "hi" }], TOKEN, opts);
};

// ══════════════════════════════════════════════════════════════════
describe("pushToLine の contract 拡張（additive）", () => {
  it("HTTP 200 + x-line-request-id → requestId を返す", async () => {
    fetchMock.mockResolvedValue(res(200, { "x-line-request-id": REQ_ID }));
    const r = await push();
    expect(r).toMatchObject({ ok: true, status: 200, requestId: REQ_ID });
  });

  it("HTTP 200 + header なし → 従来どおり成功し requestId は null", async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    const r = await push();
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.requestId).toBeNull();
  });

  it("409 → 両方のヘッダを返す（accepted 側が実際に受理された送信）", async () => {
    fetchMock.mockResolvedValue(res(409, {
      "x-line-request-id": REQ_ID,
      "x-line-accepted-request-id": ACCEPTED_ID,
    }, JSON.stringify({ message: "The retry key is already accepted" })));
    const r = await push({ retryKey: "k" });
    expect(r).toMatchObject({ ok: false, status: 409, requestId: REQ_ID, acceptedRequestId: ACCEPTED_ID });
    // 409 の request id と accepted request id は別物（同じ値を入れ違えていない）
    expect(r.requestId).not.toBe(r.acceptedRequestId);
  });

  it("ヘッダ名は大文字小文字を問わず取れる", async () => {
    fetchMock.mockResolvedValue(res(200, { "X-Line-Request-Id": REQ_ID }));
    expect((await push()).requestId).toBe(REQ_ID);
  });

  it("非 2xx（500 / 4xx）でも失敗判定は不変で、request id だけ増える", async () => {
    for (const st of [400, 403, 429, 500, 502]) {
      fetchMock.mockResolvedValue(res(st, { "x-line-request-id": REQ_ID }, JSON.stringify({ message: "x" })));
      const r = await push();
      expect(r.ok).toBe(false);       // 従来どおり失敗
      expect(r.status).toBe(st);      // 従来どおり status を返す
      expect(r.requestId).toBe(REQ_ID);
    }
  });

  it("headers を持たない / getter が投げる応答でも送信結果を壊さない", async () => {
    // 観測が成否判定に影響してはいけない（headers 取得の失敗で送信が失敗扱いにならないこと）
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "{}" } as unknown as Response);
    expect(await push()).toMatchObject({ ok: true, status: 200, requestId: null });

    fetchMock.mockResolvedValue({
      ok: true, status: 200, text: async () => "{}",
      headers: { get: () => { throw new Error("boom"); } },
    } as unknown as Response);
    expect(await push()).toMatchObject({ ok: true, status: 200, requestId: null });
  });

  it("ネットワーク例外は従来どおり { ok:false } のまま（header は無い）", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const r = await push();
    expect(r).toEqual({ ok: false });
  });

  it("リクエスト側（payload / header）が従来と完全に同じ", async () => {
    fetchMock.mockResolvedValue(res(200, { "x-line-request-id": REQ_ID }));
    await push({ retryKey: "retry-key-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Line-Retry-Key"]).toBe("retry-key-1");
    expect(JSON.parse(init.body)).toEqual({ to: FULL_USER_ID, messages: [{ type: "text", text: "hi" }] });
  });

  it("retryKey 未指定なら従来どおりヘッダ自体を付けない", async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    await push();
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("X-Line-Retry-Key");
  });

  it("token / full userId をログに出さない", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(res(500, { "x-line-request-id": REQ_ID }, "{}"));
    await push({ retryKey: "k" });
    const out = [...log.mock.calls, ...err.mock.calls].flat().map(String).join(" ");
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(FULL_USER_ID);
    expect(out).toContain(FULL_USER_ID.slice(0, 8)); // prefix のみ
    log.mockRestore(); err.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════════
describe("BroadcastRecipient への永続化", () => {
  const src = readCode("src/lib/broadcast/processor.ts");

  it("成功・409 の保存で両方の request id を書く", () => {
    const sentBlock = src.slice(src.indexOf('status:       "sent"'), src.indexOf('} else {'));
    expect(sentBlock).toContain("lineRequestId:         res.requestId ?? null");
    expect(sentBlock).toContain("lineAcceptedRequestId: res.acceptedRequestId ?? null");
  });

  it("失敗時も request id を残す", () => {
    const failedBlock = src.slice(src.indexOf('status: "failed"'));
    expect(failedBlock).toContain("lineRequestId:         res.requestId ?? null");
  });

  it("ログだけでなく DB 列に保存している（schema に列がある）", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model BroadcastRecipient"), schema.indexOf("@@map(\"broadcast_recipients\")"));
    expect(model).toContain('lineRequestId String?  @map("line_request_id")');
    expect(model).toContain('lineAcceptedRequestId String? @map("line_accepted_request_id")');
  });
});

// ══════════════════════════════════════════════════════════════════
describe("observability-only であること（挙動不変）", () => {
  const src = readCode("src/lib/broadcast/processor.ts");

  it("retry key の生成規則が不変（= BroadcastRecipient.id）", () => {
    expect(src).toContain("retryKeyOf(recipientId: string): string");
    expect(src).toContain("return recipientId;");
    expect(src).toContain("retryKey: retryKeyOf(r.id)");
  });

  it("成否判定が request id に依存しない", () => {
    // 成功/409 判定は status のみで行う
    expect(src).toContain("const alreadyAccepted = !res.ok && res.status === 409;");
    expect(src).toContain("if (res.ok || alreadyAccepted) {");
    // request id は「保存」と「ログ」にしか現れない = 制御フローに入っていない
    const lines = src.split("\n").filter((l) => /requestid/i.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l).toMatch(/^\s*(lineRequestId|lineAcceptedRequestId|requestId|acceptedRequestId):/);
      expect(l).not.toMatch(/\b(if|return|&&|\|\||\?)\b/);
    }
  });

  it("宛先単位 CAS / status 遷移が不変", () => {
    expect(src).toContain('where: { id: r.id, status: "pending" }');
    expect(src).toContain('data:  { status: "sending" }');
    expect(src).toContain('status:       "sent"');
    expect(src).toContain('status: "failed"');
  });

  it("retry 分類 / 24h ambiguous / chunk size が不変", () => {
    expect(src).toContain("BROADCAST_CHUNK_SIZE = 50");
    expect(src).toContain("isRetryableFailure");
    expect(src).toContain("RETRY_KEY_TTL_MS");
    expect(src).toContain("AMBIGUOUS_REASON");
  });

  it("集計・最終 status が宛先テーブルの実状態から取り直されるまま", () => {
    expect(src).toContain("finalStatusOf");
    expect(src).toContain('count({ where: { broadcastId, status: "sent" } })');
    expect(src).toContain('status: { in: ["pending", "sending"] }');
  });

  it("cron worker は request id を知らない（選択条件も不変）", () => {
    const worker = readCode("src/lib/broadcast/worker.ts");
    for (const t of ["requestId", "lineRequestId", "acceptedRequestId"]) expect(worker).not.toContain(t);
    const cron = readCode("src/app/api/cron/broadcast-worker/route.ts");
    expect(cron).toContain('where:   { status: "sending" }');
    expect(cron).toContain('orderBy: { startedAt: "asc" }');
  });

  it("payload 生成（content layer）を変更していない", () => {
    const content = readCode("src/lib/broadcast/content.ts");
    for (const t of ["requestId", "x-line", "header"]) expect(content.toLowerCase()).not.toContain(t.toLowerCase());
  });

  it("Test Send は Broadcast / BroadcastRecipient を作らないまま", () => {
    const ts = readCode("src/app/api/oas/[id]/broadcasts/test-send/route.ts");
    expect(ts).not.toContain("broadcast.create");
    expect(ts).not.toContain("broadcastRecipient");
    expect(ts).toContain("requestId: res.requestId ?? null"); // ログにだけ残す
  });

  it("migration は additive のみ（nullable 追加・backfill なし）", () => {
    const sql = read("prisma/migrations/20260817000000_add_broadcast_recipient_line_request_ids/migration.sql");
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "line_request_id" TEXT');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "line_accepted_request_id" TEXT');
    for (const forbidden of ["DROP", "ALTER COLUMN", "UPDATE ", "DELETE ", "NOT NULL", "RENAME"]) {
      expect(sql.toUpperCase()).not.toContain(forbidden.toUpperCase());
    }
  });
});
