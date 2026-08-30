// src/__tests__/uzupro-player-view.test.ts
// getUzuProPlayerView（for ウズプロ ＞ プレイヤー画面の View Model）の単体テスト。
//   - View Model に個人情報キー（email/name/phone/purchaser）が一切混入しないこと。
//   - サマリー集計（active 基準）・LIFF 状態導出・フィルタ・空結果の各挙動。
// prisma は uzuProBooking.findMany のみモック（この関数はそれ以外を呼ばない）。

import { describe, it, expect, vi, beforeEach } from "vitest";

const mp = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { uzuProBooking: { findMany: mp.findMany } } }));

import { getUzuProPlayerView, deriveLiffState } from "@/lib/uzupro/player-view";

/** 予約 1 件のフィクスチャ（PII を含まない）。 */
function booking(over: Partial<Record<string, unknown>> = {}) {
  return {
    externalBookingId: "UZ-0001",
    participantCount: 4,
    status: "confirmed",
    syncedAt: new Date("2026-07-01T00:00:00Z"),
    liveSessionId: "sess-1",
    liveSession: { name: "第1公演", startsAt: new Date("2026-07-10T09:00:00Z") },
    players: [],
    ...over,
  };
}

function player(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p-000000-1",
    playerIndex: 1,
    status: "active",
    lineUserId: null,
    lineLinkSource: null,
    linkedAt: null,
    liffLinks: [],
    ...over,
  };
}

const issuedLink = { status: "issued", issuedAt: new Date("2026-07-02T00:00:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUzuProPlayerView — PII フリー", () => {
  it("View Model に個人情報キーが一切含まれない", async () => {
    mp.findMany.mockResolvedValue([
      booking({
        players: [
          player({ id: "p1", playerIndex: 1, lineUserId: "U_secret", liffLinks: [issuedLink] }),
          player({ id: "p2", playerIndex: 2, liffLinks: [] }),
        ],
      }),
    ]);
    const view = await getUzuProPlayerView({ oaId: "oa1", workId: "w1" });
    const json = JSON.stringify(view);
    for (const forbidden of ["email", "name", "phone", "purchaser"]) {
      expect(json).not.toContain(forbidden);
    }
    // 生 lineUserId も露出しない。
    expect(json).not.toContain("U_secret");
  });
});

describe("getUzuProPlayerView — LINE 連携状態（マスク表示）", () => {
  it("連携済みプレイヤーの行は masked ID（生値でない）と linkedAt を持つ", async () => {
    const rawUid = "U1234567890abcdefABCD";
    const linkedAt = new Date("2026-07-05T03:00:00Z");
    mp.findMany.mockResolvedValue([
      booking({
        players: [
          player({ id: "p1", playerIndex: 1, lineUserId: rawUid, linkedAt, liffLinks: [issuedLink] }),
        ],
      }),
    ]);
    const view = await getUzuProPlayerView({ oaId: "oa1", workId: "w1" });
    const row = view.bookings.flatMap((b) => b.players)[0];
    expect(row.lineLinked).toBe(true);
    // マスクされている（ドットを含む・生値と一致しない）。
    expect(row.lineLinkedMaskedId).toContain("•");
    expect(row.lineLinkedMaskedId).not.toBe(rawUid);
    expect(row.linkedAt).toBe(linkedAt.toISOString());
    // View Model 全体を文字列化しても生 UID は現れない。
    expect(JSON.stringify(view)).not.toContain(rawUid);
  });

  it("連携元（lineLinkSource）を行に反映する（LIFF / MANUAL / 未連携=null）", async () => {
    mp.findMany.mockResolvedValue([
      booking({
        players: [
          player({ id: "p1", playerIndex: 1, lineUserId: "U_liff", lineLinkSource: "LIFF", liffLinks: [issuedLink] }),
          player({ id: "p2", playerIndex: 2, lineUserId: "U_man", lineLinkSource: "MANUAL", liffLinks: [] }),
          player({ id: "p3", playerIndex: 3, lineUserId: null, lineLinkSource: null, liffLinks: [] }),
        ],
      }),
    ]);
    const rows = (await getUzuProPlayerView({ oaId: "oa1", workId: "w1" })).bookings.flatMap((b) => b.players);
    expect(rows.find((r) => r.playerIndex === 1)?.lineLinkSource).toBe("LIFF");
    expect(rows.find((r) => r.playerIndex === 2)?.lineLinkSource).toBe("MANUAL");
    // 未連携は source を出さない（null）。
    expect(rows.find((r) => r.playerIndex === 3)?.lineLinkSource).toBeNull();
  });

  it("未連携プレイヤーの行は lineLinkedMaskedId=null・linkedAt=null", async () => {
    mp.findMany.mockResolvedValue([
      booking({ players: [player({ id: "p1", lineUserId: null, linkedAt: null, liffLinks: [] })] }),
    ]);
    const view = await getUzuProPlayerView({ oaId: "oa1", workId: "w1" });
    const row = view.bookings.flatMap((b) => b.players)[0];
    expect(row.lineLinked).toBe(false);
    expect(row.lineLinkedMaskedId).toBeNull();
    expect(row.linkedAt).toBeNull();
  });
});

describe("getUzuProPlayerView — サマリー集計", () => {
  it("4 players(2 issued / 1 unissued / 1 cancelled) → total 3, liffIssued 2, liffUnissued 1", async () => {
    mp.findMany.mockResolvedValue([
      booking({
        players: [
          player({ id: "p1", playerIndex: 1, liffLinks: [issuedLink] }),
          player({ id: "p2", playerIndex: 2, liffLinks: [issuedLink] }),
          player({ id: "p3", playerIndex: 3, liffLinks: [] }),
          player({ id: "p4", playerIndex: 4, status: "cancelled", liffLinks: [] }),
        ],
      }),
    ]);
    const view = await getUzuProPlayerView({ oaId: "oa1", workId: "w1" });
    expect(view.summary).toEqual({ total: 3, liffIssued: 2, liffUnissued: 1, lineLinked: 0, syncError: 0 });
    // 一括対象: 未発行 active 1 / 除外: cancelled 1・issued 2。
    expect(view.bulk).toEqual({ target: 1, excludedCancelled: 1, excludedIssued: 2 });
    expect(view.syncStatus).toBe("ok");
  });

  it("error 状態の active プレイヤーは syncError にカウントされ syncStatus=error", async () => {
    mp.findMany.mockResolvedValue([
      booking({
        players: [player({ id: "p1", liffLinks: [{ status: "error", issuedAt: new Date("2026-07-02T00:00:00Z") }] })],
      }),
    ]);
    const view = await getUzuProPlayerView({ oaId: "oa1", workId: "w1" });
    expect(view.summary.syncError).toBe(1);
    expect(view.syncStatus).toBe("error");
  });
});

describe("getUzuProPlayerView — フィルタ", () => {
  it("liffStatus フィルタは一致する行のみ返す", async () => {
    mp.findMany.mockResolvedValue([
      booking({
        players: [
          player({ id: "p1", playerIndex: 1, liffLinks: [issuedLink] }),
          player({ id: "p2", playerIndex: 2, liffLinks: [] }),
        ],
      }),
    ]);
    const view = await getUzuProPlayerView({ oaId: "oa1", workId: "w1", filters: { liffStatus: "issued" } });
    const rows = view.bookings.flatMap((b) => b.players);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("p1");
    expect(rows[0].liffStatus).toBe("issued");
  });

  it("マッチ 0 件の予約グループは落とされる", async () => {
    mp.findMany.mockResolvedValue([
      booking({ players: [player({ id: "p1", liffLinks: [] })] }),
    ]);
    const view = await getUzuProPlayerView({ oaId: "oa1", workId: "w1", filters: { liffStatus: "issued" } });
    expect(view.bookings).toHaveLength(0);
  });
});

describe("getUzuProPlayerView — 空結果", () => {
  it("予約なし → summary は全 0・syncStatus ok・lastSyncedAt null", async () => {
    mp.findMany.mockResolvedValue([]);
    const view = await getUzuProPlayerView({ oaId: "oa1", workId: "w1" });
    expect(view.summary).toEqual({ total: 0, liffIssued: 0, liffUnissued: 0, lineLinked: 0, syncError: 0 });
    expect(view.bookings).toHaveLength(0);
    expect(view.sessions).toHaveLength(0);
    expect(view.lastSyncedAt).toBeNull();
    expect(view.syncStatus).toBe("ok");
  });
});

describe("deriveLiffState — 優先順位", () => {
  it("linked が最優先", () => {
    expect(deriveLiffState([{ status: "issued", issuedAt: new Date() }, { status: "linked", issuedAt: new Date() }])).toBe("linked");
  });
  it("issued は revoked/error より優先", () => {
    expect(deriveLiffState([{ status: "revoked", issuedAt: new Date() }, { status: "issued", issuedAt: new Date() }])).toBe("issued");
  });
  it("linked/issued なしなら最新リンクの状態（revoked）", () => {
    expect(
      deriveLiffState([
        { status: "revoked", issuedAt: new Date("2026-07-03T00:00:00Z") },
        { status: "error", issuedAt: new Date("2026-07-01T00:00:00Z") },
      ]),
    ).toBe("revoked");
  });
  it("リンクなしは unissued", () => {
    expect(deriveLiffState([])).toBe("unissued");
  });
});
