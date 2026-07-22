// src/__tests__/uzupro-sync.test.ts
// for ウズプロ: 予約/プレイヤー SYNC API + サービスのテスト。
//   POST /api/external/v2/uzu-pro/bookings/sync … CMS(正本)→Whale Studio の冪等同期
//   syncUzuProBooking …（直接ユニット）新規作成 / 人数可変 / 巻き戻り防止 / キャンセル反映
//
// prisma は mock。external-auth は env でキー/allowlist を設定して実物を使う。
// route テストは **実物の syncUzuProBooking** を mock prisma tx（$transaction=fn(mp)）で走らせ、
// live-external-session（LiveSession upsert）のみ mock する。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

const { mp } = vi.hoisted(() => ({
  mp: {
    work: { findUnique: vi.fn() },
    uzuProSyncRequest: { create: vi.fn(), update: vi.fn() },
    uzuProBooking: { findUnique: vi.fn(), upsert: vi.fn() },
    uzuProPlayer: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    uzuProLiffLink: { updateMany: vi.fn() },
    uzuProActivityLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mp }));
// LiveSession の冪等 upsert は #591 の実装を持たない前提でスタブ（id は内部主キー）。
vi.mock("@/lib/live-external-session", () => ({
  upsertExternalLiveSession: vi.fn(async () => ({
    id: "SESSION_INTERNAL_ID",
    externalSessionRef: "uzu-s-1",
    status: "draft",
    origin: "UZU_PRO",
    startsAt: null,
    endsAt: null,
  })),
}));

import { POST as syncPost } from "@/app/api/external/v2/uzu-pro/bookings/sync/route";
import { syncUzuProBooking } from "@/lib/uzupro/sync";

const KEY = "test-external-key";
const H = { "x-whale-api-key": KEY, "Content-Type": "application/json" };
const req = (body: unknown, headers: Record<string, string> = H) =>
  new NextRequest("http://localhost/api/external/v2/uzu-pro/bookings/sync", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

const SRC = "2026-08-17T12:00:00+09:00";
const baseBody = (over: Record<string, unknown> = {}) => ({
  workId: "w1",
  session: { externalSessionRef: "uzu-s-1", startsAt: "2026-08-17T18:00:00+09:00", endsAt: null },
  booking: { externalBookingId: "uzu-b-1", participantCount: 2, status: "confirmed", sourceUpdatedAt: SRC },
  players: [{ playerIndex: 1 }, { playerIndex: 2 }],
  ...over,
});

// 実物 sync が新規予約 + N プレイヤー作成として走るよう mock prisma tx を仕込む。
function setupNewBooking() {
  mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
  mp.uzuProSyncRequest.create.mockResolvedValue({ id: "req1" });
  mp.uzuProSyncRequest.update.mockResolvedValue({ id: "req1" });
  mp.uzuProBooking.findUnique.mockResolvedValue(null); // 既存なし = 新規
  const d = new Date("2026-08-17T03:00:00.000Z");
  mp.uzuProBooking.upsert.mockResolvedValue({ id: "BOOKING_INTERNAL_ID", createdAt: d, updatedAt: d }); // created
  mp.uzuProPlayer.findUnique.mockResolvedValue(null); // 各プレイヤー新規
  mp.uzuProPlayer.upsert.mockResolvedValue({ id: "PLAYER_INTERNAL_ID" });
  mp.uzuProPlayer.findMany.mockResolvedValue([]); // straggler なし
  mp.uzuProLiffLink.updateMany.mockResolvedValue({ count: 0 }); // cancelled プレイヤーの LIFF 失効（既定 0 件）
  mp.uzuProActivityLog.create.mockResolvedValue({ id: "log1" });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHALE_EXTERNAL_WRITE_API_KEY = KEY;
  process.env.WHALE_EXTERNAL_OA_IDS = "oa1";
  mp.$transaction.mockImplementation(async (fn: (tx: typeof mp) => unknown) => fn(mp));
});

// ───────── route: 認証 / テナント境界 ─────────
describe("POST /uzu-pro/bookings/sync — 認証 / 境界", () => {
  it("h: APIキーなしは 401（同期しない）", async () => {
    const res = await syncPost(req(baseBody(), { "Content-Type": "application/json" }));
    expect(res.status).toBe(401);
    expect(mp.uzuProBooking.upsert).not.toHaveBeenCalled();
  });
  it("g: 不在 work は 404（同期しない）", async () => {
    mp.work.findUnique.mockResolvedValue(null);
    expect((await syncPost(req(baseBody()))).status).toBe(404);
    expect(mp.uzuProBooking.upsert).not.toHaveBeenCalled();
  });
  it("g: allowlist 外 OA の work は 404（存在秘匿・同期しない）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oaX" });
    expect((await syncPost(req(baseBody()))).status).toBe(404);
    expect(mp.uzuProBooking.upsert).not.toHaveBeenCalled();
  });
});

// ───────── route: PII 拒否（strict schema）─────────
describe("POST /uzu-pro/bookings/sync — PII 拒否", () => {
  it("e: 本文の PII フィールドは 400（同期も reserve もしない）", async () => {
    for (const extra of [
      { purchaserName: "山田" },
      { email: "a@example.com" },
      { phone: "090-0000-0000" },
      { address: "東京" },
      { memo: "備考" },
      { name: "x" },
    ]) {
      vi.clearAllMocks();
      setupNewBooking();
      const res = await syncPost(req(baseBody(extra)));
      expect(res.status).toBe(400);
      expect(mp.uzuProSyncRequest.create).not.toHaveBeenCalled();
      expect(mp.uzuProBooking.upsert).not.toHaveBeenCalled();
    }
  });
  it("e2: players 内の PII（氏名等）も 400", async () => {
    setupNewBooking();
    const res = await syncPost(req(baseBody({ players: [{ playerIndex: 1, name: "山田" }] })));
    expect(res.status).toBe(400);
    expect(mp.uzuProBooking.upsert).not.toHaveBeenCalled();
  });
});

// ───────── route: 新規予約 + N プレイヤー作成 / 冪等キー ─────────
describe("POST /uzu-pro/bookings/sync — 新規作成 / 冪等 upsert キー", () => {
  it("a: 新規予約 + 2 プレイヤー作成、内部主キーを返さない", async () => {
    setupNewBooking();
    const res = await syncPost(req(baseBody()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.booking).toMatchObject({ externalBookingId: "uzu-b-1", status: "confirmed", participantCount: 2, applied: true });
    expect(json.data.counts).toMatchObject({ created: 2, updated: 0, cancelled: 0, failed: 0 });
    expect(json.data.players).toHaveLength(2);
    expect(json.data.players.every((p: { outcome: string }) => p.outcome === "created")).toBe(true);
    // 外部契約: 内部主キー（booking/session/player id）を一切含まない。
    const body = JSON.stringify(json);
    for (const v of ["BOOKING_INTERNAL_ID", "SESSION_INTERNAL_ID", "PLAYER_INTERNAL_ID", "bookingId", "liveSessionId"]) {
      expect(body).not.toContain(v);
    }
    // 監査ログ（sync_success, 件数のみ）。
    expect(mp.uzuProActivityLog.create).toHaveBeenCalledTimes(1);
    expect(mp.uzuProActivityLog.create.mock.calls[0][0].data.action).toBe("sync_success");
  });

  it("b: 冪等 upsert キーは (oaId,workId,externalBookingId) / (bookingId,playerIndex)", async () => {
    setupNewBooking();
    await syncPost(req(baseBody()));
    expect(mp.uzuProBooking.upsert.mock.calls[0][0].where).toEqual({
      oaId_workId_externalBookingId: { oaId: "oa1", workId: "w1", externalBookingId: "uzu-b-1" },
    });
    expect(mp.uzuProPlayer.upsert.mock.calls[0][0].where).toEqual({
      bookingId_playerIndex: { bookingId: "BOOKING_INTERNAL_ID", playerIndex: 1 },
    });
  });

  it("c: participantCount 1/2/4/6 → その人数分のプレイヤーを作成", async () => {
    for (const n of [1, 2, 4, 6]) {
      vi.clearAllMocks();
      mp.$transaction.mockImplementation(async (fn: (tx: typeof mp) => unknown) => fn(mp));
      setupNewBooking();
      const players = Array.from({ length: n }, (_, i) => ({ playerIndex: i + 1 }));
      const res = await syncPost(req(baseBody({ booking: { externalBookingId: "uzu-b-1", participantCount: n, status: "confirmed", sourceUpdatedAt: SRC }, players })));
      const json = await res.json();
      expect(json.data.counts.created).toBe(n);
      expect(json.data.players).toHaveLength(n);
      expect(mp.uzuProPlayer.upsert).toHaveBeenCalledTimes(n);
    }
  });
});

// ───────── route: Idempotency-Key リプレイ ─────────
describe("POST /uzu-pro/bookings/sync — Idempotency-Key リプレイ", () => {
  const p2002 = new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });

  it("b: 同一キー再送は idempotent_replay を返し再処理しない", async () => {
    setupNewBooking();
    mp.uzuProSyncRequest.create.mockRejectedValueOnce(p2002); // 既に reserve 済み
    const res = await syncPost(req(baseBody(), { ...H, "idempotency-key": "idem-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ idempotent_replay: true });
    // 再処理なし（sync / activity を走らせない）。
    expect(mp.uzuProBooking.upsert).not.toHaveBeenCalled();
    expect(mp.uzuProActivityLog.create).not.toHaveBeenCalled();
  });

  it("初回キーは reserve→processed に更新して同期する", async () => {
    setupNewBooking();
    const res = await syncPost(req(baseBody(), { ...H, "idempotency-key": "idem-1", "x-request-id": "rq-1" }));
    expect(res.status).toBe(200);
    expect(mp.uzuProSyncRequest.create.mock.calls[0][0].data).toMatchObject({
      idempotencyKey: "idem-1",
      requestId: "rq-1",
      oaId: "oa1",
      workId: "w1",
      externalBookingId: "uzu-b-1",
      status: "received",
    });
    expect(mp.uzuProSyncRequest.update.mock.calls[0][0]).toMatchObject({
      where: { idempotencyKey: "idem-1" },
      data: { status: "processed" },
    });
  });

  it("キーなしは reserve せず同期する", async () => {
    setupNewBooking();
    await syncPost(req(baseBody()));
    expect(mp.uzuProSyncRequest.create).not.toHaveBeenCalled();
    expect(mp.uzuProBooking.upsert).toHaveBeenCalledTimes(1);
  });
});

// ───────── route: 巻き戻り防止 / キャンセル反映 ─────────
describe("POST /uzu-pro/bookings/sync — 巻き戻り / キャンセル", () => {
  it("d: 古い sourceUpdatedAt は applied=false（upsert しない = 退行なし）", async () => {
    mp.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mp.uzuProActivityLog.create.mockResolvedValue({ id: "log1" });
    // 保存済みが受信より新しい → 巻き戻り。
    mp.uzuProBooking.findUnique.mockResolvedValue({ id: "BOOKING_INTERNAL_ID", sourceUpdatedAt: new Date("2030-01-01T00:00:00.000Z") });
    const res = await syncPost(req(baseBody()));
    const json = await res.json();
    expect(json.data.booking.applied).toBe(false);
    expect(json.data.counts).toMatchObject({ created: 0, updated: 0, cancelled: 0, failed: 0 });
    expect(mp.uzuProBooking.upsert).not.toHaveBeenCalled();
  });

  it("f: booking status cancelled が upsert に反映される", async () => {
    setupNewBooking();
    // プレイヤーは既存 → cancelled outcome を確認。
    mp.uzuProPlayer.findUnique.mockResolvedValue({ id: "PLAYER_INTERNAL_ID" });
    const res = await syncPost(req(baseBody({ booking: { externalBookingId: "uzu-b-1", participantCount: 2, status: "cancelled", sourceUpdatedAt: SRC } })));
    const json = await res.json();
    expect(json.data.booking.status).toBe("cancelled");
    const call = mp.uzuProBooking.upsert.mock.calls[0][0];
    expect(call.create.status).toBe("cancelled");
    expect(call.update.status).toBe("cancelled");
    expect(json.data.players.every((p: { outcome: string }) => p.outcome === "cancelled")).toBe(true);
    // 既存プレイヤーを cancelled に更新した場合、outcome は "cancelled" だが件数は updated 側で数える
    // （playersCancelled は payload に無い straggler の cancel 専用）。
    expect(json.data.counts.updated).toBe(2);
    expect(json.data.counts.cancelled).toBe(0);
  });
});

// ───────── サービス直接ユニット（syncUzuProBooking, mock tx）─────────
describe("syncUzuProBooking（mock tx 直接）", () => {
  function fakeTx(over: Partial<Record<string, unknown>> = {}) {
    const created = new Date("2026-08-17T03:00:00.000Z");
    return {
      uzuProBooking: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: "b1", createdAt: created, updatedAt: created }),
      },
      uzuProPlayer: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: "p1" }),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
      },
      uzuProLiffLink: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      ...over,
    } as unknown as Prisma.TransactionClient;
  }
  const input = (over: Record<string, unknown> = {}) => ({
    oaId: "oa1",
    workId: "w1",
    externalSessionRef: "uzu-s-1",
    sessionStartsAt: null,
    sessionEndsAt: null,
    externalBookingId: "uzu-b-1",
    participantCount: 2,
    bookingStatus: "confirmed" as const,
    sourceUpdatedAt: new Date("2026-08-17T03:00:00.000Z"),
    players: [{ playerIndex: 1 }, { playerIndex: 2 }],
    now: new Date("2026-08-17T04:00:00.000Z"),
    ...over,
  });

  it("a: 新規予約 + 2 プレイヤーを created で返す", async () => {
    const r = await syncUzuProBooking(fakeTx(), input());
    expect(r.applied).toBe(true);
    expect(r.bookingCreated).toBe(true);
    expect(r.playersCreated).toBe(2);
    expect(r.players.map((p) => p.outcome)).toEqual(["created", "created"]);
  });

  it("c: 人数可変 1/2/4/6 → その人数分作成", async () => {
    for (const n of [1, 2, 4, 6]) {
      const players = Array.from({ length: n }, (_, i) => ({ playerIndex: i + 1 }));
      const r = await syncUzuProBooking(fakeTx(), input({ participantCount: n, players }));
      expect(r.playersCreated).toBe(n);
      expect(r.players).toHaveLength(n);
    }
  });

  it("d: 保存済みが新しければ applied=false（upsert を呼ばない）", async () => {
    const tx = fakeTx({
      uzuProBooking: {
        findUnique: vi.fn().mockResolvedValue({ id: "b1", sourceUpdatedAt: new Date("2030-01-01T00:00:00.000Z") }),
        upsert: vi.fn(),
      },
    });
    const r = await syncUzuProBooking(tx, input());
    expect(r.applied).toBe(false);
    expect((tx.uzuProBooking.upsert as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("f: bookingStatus cancelled は既存プレイヤーを cancelled 化", async () => {
    const tx = fakeTx({
      uzuProPlayer: {
        findUnique: vi.fn().mockResolvedValue({ id: "p1" }), // 既存
        upsert: vi.fn().mockResolvedValue({ id: "p1" }),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
      },
    });
    const r = await syncUzuProBooking(tx, input({ bookingStatus: "cancelled" }));
    expect(r.players.every((p) => p.outcome === "cancelled")).toBe(true);
    const upsertCall = (tx.uzuProPlayer.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upsertCall.update.status).toBe("cancelled");
  });
});
