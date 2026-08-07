// UZU 連携 outbox の純粋ロジック（バックオフ・冪等キー・HTTP 分類・envelope）。
// DB へは接続しない。

import { describe, expect, it, vi } from "vitest";
import {
  BACKOFF_MINUTES,
  MAX_ATTEMPTS,
  enqueueUzuEvent,
  nextAttemptAtFor,
  playerLineLinkedKey,
  UZU_EVENT_TYPES,
} from "@/lib/uzu-outbox";
import { buildEnvelope, classifyHttpStatus, sendEnvelope, UZU_EVENTS_PATH } from "@/lib/uzu-client";

const NOW = new Date("2026-08-07T00:00:00.000Z");

describe("nextAttemptAtFor（指数バックオフ）", () => {
  it("attempt ごとに待ち時間が伸びる", () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const next = nextAttemptAtFor(attempt, NOW);
      expect(next).not.toBeNull();
      expect(next!.getTime() - NOW.getTime()).toBe(BACKOFF_MINUTES[attempt] * 60_000);
    }
  });

  it("上限に達したら null（恒久失敗）", () => {
    expect(nextAttemptAtFor(MAX_ATTEMPTS, NOW)).toBeNull();
    expect(nextAttemptAtFor(MAX_ATTEMPTS + 5, NOW)).toBeNull();
  });

  it("待ち時間は単調増加", () => {
    const deltas = BACKOFF_MINUTES.slice();
    for (let i = 1; i < deltas.length; i++) expect(deltas[i]).toBeGreaterThan(deltas[i - 1]);
  });
});

describe("playerLineLinkedKey（冪等キー）", () => {
  const base = { participantId: "p1", teamId: "t1", lineUserId: "U1" };

  it("同一の業務イベントは同じキー", () => {
    expect(playerLineLinkedKey(base)).toBe(playerLineLinkedKey({ ...base }));
  });

  it("別 LINE ユーザーは別キー（正当な再リンクを潰さない）", () => {
    expect(playerLineLinkedKey(base)).not.toBe(playerLineLinkedKey({ ...base, lineUserId: "U2" }));
  });

  it("別チームへの付け替えは別キー", () => {
    expect(playerLineLinkedKey(base)).not.toBe(playerLineLinkedKey({ ...base, teamId: "t2" }));
  });

  it("別 participant は別キー", () => {
    expect(playerLineLinkedKey(base)).not.toBe(playerLineLinkedKey({ ...base, participantId: "p2" }));
  });

  it("eventType を接頭辞に含む", () => {
    expect(playerLineLinkedKey(base).startsWith(`${UZU_EVENT_TYPES.playerLineLinked}:`)).toBe(true);
  });
});

describe("enqueueUzuEvent", () => {
  const args = {
    oaId: "oa1", workId: "w1", uzuProjectId: "11111111-1111-4111-8111-111111111111",
    eventType: UZU_EVENT_TYPES.playerLineLinked,
    idempotencyKey: "k1",
    payload: { reservationNumber: "ESC-1", lineUserId: "U1", lineDisplayName: null, oaId: "oa1", workId: "w1", matchedVia: "reservation" as const },
    now: NOW,
  };

  it("未登録なら作成する", async () => {
    const db = { uzuOutboxEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) } };
    const r = await enqueueUzuEvent(db as never, args);
    expect(r.enqueued).toBe(true);
    expect(db.uzuOutboxEvent.create).toHaveBeenCalledOnce();
    const data = db.uzuOutboxEvent.create.mock.calls[0][0].data;
    expect(data.status).toBe("pending");
    expect(data.idempotencyKey).toBe("k1");
    expect(data.nextAttemptAt).toBe(NOW);
  });

  it("同一 idempotencyKey が既にあれば作成しない", async () => {
    const db = { uzuOutboxEvent: { findUnique: vi.fn().mockResolvedValue({ id: "x" }), create: vi.fn() } };
    const r = await enqueueUzuEvent(db as never, args);
    expect(r.enqueued).toBe(false);
    expect(db.uzuOutboxEvent.create).not.toHaveBeenCalled();
  });

  it("作成に失敗したら例外を伝播する（呼び出し側 transaction を巻き戻す）", async () => {
    const db = {
      uzuOutboxEvent: {
        findUnique: vi.fn().mockResolvedValue(null),
        create:     vi.fn().mockRejectedValue(new Error("db down")),
      },
    };
    await expect(enqueueUzuEvent(db as never, args)).rejects.toThrow("db down");
  });
});

describe("classifyHttpStatus", () => {
  it.each([
    [200, false, "OK"],
    [204, false, "OK"],
    [429, true, "RATE_LIMITED"],
    [500, true, "HTTP_500"],
    [502, true, "HTTP_502"],
    [503, true, "HTTP_503"],
    [400, false, "INVALID_PAYLOAD"],
    [401, false, "UNAUTHORIZED"],
    [403, false, "FORBIDDEN"],
    [404, false, "HTTP_404"],
  ])("status %i → retryable=%s code=%s", (status, retryable, code) => {
    const r = classifyHttpStatus(status as number);
    expect(r.retryable).toBe(retryable);
    expect(r.errorCode).toBe(code);
  });
});

describe("buildEnvelope", () => {
  it("eventId は行 id（再送しても不変）", () => {
    const row = { id: "row-1", eventType: "player_line.linked", uzuProjectId: "proj-1", payloadJson: { a: 1 }, createdAt: NOW };
    const e1 = buildEnvelope(row);
    const e2 = buildEnvelope(row);
    expect(e1.eventId).toBe("row-1");
    expect(e2.eventId).toBe(e1.eventId);
    expect(e1.schemaVersion).toBe(1);
    expect(e1.source).toBe("whale_studio");
    expect(e1.projectId).toBe("proj-1");
    expect(e1.occurredAt).toBe(NOW.toISOString());
  });
});

describe("sendEnvelope", () => {
  const envelope = buildEnvelope({ id: "r1", eventType: "player_line.linked", uzuProjectId: "p1", payloadJson: {}, createdAt: NOW });

  it("2xx は成功", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const r = await sendEnvelope(envelope, { baseUrl: "https://uzu.example", secret: "s", fetcher });
    expect(r.ok).toBe(true);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`https://uzu.example${UZU_EVENTS_PATH}`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer s");
  });

  it("5xx は retryable", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    const r = await sendEnvelope(envelope, { baseUrl: "https://uzu.example", secret: "s", fetcher });
    expect(r).toMatchObject({ ok: false, retryable: true });
  });

  it("400 は terminal", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 400 }));
    const r = await sendEnvelope(envelope, { baseUrl: "https://uzu.example", secret: "s", fetcher });
    expect(r).toMatchObject({ ok: false, retryable: false, errorCode: "INVALID_PAYLOAD" });
  });

  it("401 は terminal（設定不備として識別できる）", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    const r = await sendEnvelope(envelope, { baseUrl: "https://uzu.example", secret: "s", fetcher });
    expect(r).toMatchObject({ ok: false, retryable: false, errorCode: "UNAUTHORIZED" });
  });

  it("network error は retryable", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("boom"));
    const r = await sendEnvelope(envelope, { baseUrl: "https://uzu.example", secret: "s", fetcher });
    expect(r).toMatchObject({ ok: false, retryable: true, errorCode: "NETWORK_ERROR" });
  });

  it("timeout（AbortError）は retryable", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    const fetcher = vi.fn().mockRejectedValue(err);
    const r = await sendEnvelope(envelope, { baseUrl: "https://uzu.example", secret: "s", fetcher });
    expect(r).toMatchObject({ ok: false, retryable: true, errorCode: "TIMEOUT" });
  });

  it("secret を message に含めない", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    const r = await sendEnvelope(envelope, { baseUrl: "https://uzu.example", secret: "super-secret", fetcher });
    expect(JSON.stringify(r)).not.toContain("super-secret");
  });
});
