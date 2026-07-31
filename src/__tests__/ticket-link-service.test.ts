// src/__tests__/ticket-link-service.test.ts
//
// 手動登録フローのサーバー側ロジック（ステップ機械 / 最終確定 / 冪等 / 競合）。
// prisma は最小のモック tx で差し替える。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import {
  canAdvanceStep,
  canConfirmFromStep,
  isDraftExpired,
  draftExpiresAt,
  confirmTicketLink,
} from "@/lib/ticket-link/service";
import { readTicketLinkSettings } from "@/lib/ticket-link/settings";

const NOW = new Date("2026-08-01T00:00:00Z");
const FUTURE = new Date("2026-08-02T00:00:00Z");
const PAST = new Date("2026-07-31T00:00:00Z");

const settings = readTicketLinkSettings({
  ticket_link: {
    enabled: true,
    manualInputEnabled: true,
    ticketTypes: [
      { ticketTypeKey: "single", ticketTypeLabel: "1名チケット", participantCount: 1, enabled: true, sortOrder: 0 },
      { ticketTypeKey: "pair", ticketTypeLabel: "2名グループチケット", participantCount: 2, enabled: true, sortOrder: 1 },
      { ticketTypeKey: "old", ticketTypeLabel: "終了分", participantCount: 2, enabled: false, sortOrder: 2 },
    ],
  },
});

const BASE = { draftId: "d1", lineUserId: "U1", displayName: "たろう", oaId: "oa1", workId: "w1", settings, now: NOW };

function payload(over: Record<string, unknown> = {}) {
  return {
    ticketTypeKey: "pair",
    purchaserName: "山田太郎",
    normalizedReservationNumber: "123-456",
    reservationNumberRaw: "123-456",
    codeNames: ["アリス", "ボブ"],
    ...over,
  };
}

function makeTx(over: Record<string, unknown> = {}) {
  return {
    ticketLinkDraft: {
      findFirst: vi.fn().mockResolvedValue({
        id: "d1", status: "NEEDS_REVIEW", step: "FINAL_REVIEW", expiresAt: FUTURE, confirmedPayload: payload(),
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    ticketLink: {
      findFirst:  vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create:     vi.fn().mockResolvedValue({ id: "tl-new" }),
      update:     vi.fn().mockResolvedValue({}),
    },
    ...over,
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe("ステップ機械", () => {
  it("1 段ずつ前進できる", () => {
    expect(canAdvanceStep("MANUAL_INPUT", "TICKET_REVIEW")).toBe(true);
    expect(canAdvanceStep("TICKET_REVIEW", "CODE_NAMES")).toBe(true);
    expect(canAdvanceStep("CODE_NAMES", "FINAL_REVIEW")).toBe(true);
  });

  it("ステップを飛ばせない", () => {
    expect(canAdvanceStep("MANUAL_INPUT", "CODE_NAMES")).toBe(false);
    expect(canAdvanceStep("TICKET_REVIEW", "FINAL_REVIEW")).toBe(false);
  });

  it("許可された前段階へは戻れる", () => {
    expect(canAdvanceStep("FINAL_REVIEW", "CODE_NAMES")).toBe(true);
    expect(canAdvanceStep("CODE_NAMES", "MANUAL_INPUT")).toBe(true);
  });

  it("最終確認からのみ確定できる", () => {
    expect(canConfirmFromStep("FINAL_REVIEW")).toBe(true);
    expect(canConfirmFromStep("CODE_NAMES")).toBe(false);
    expect(canConfirmFromStep("MANUAL_INPUT")).toBe(false);
    expect(canConfirmFromStep(null)).toBe(false);
  });

  it("期限判定", () => {
    expect(isDraftExpired({ expiresAt: PAST, status: "NEEDS_REVIEW" }, NOW)).toBe(true);
    expect(isDraftExpired({ expiresAt: FUTURE, status: "NEEDS_REVIEW" }, NOW)).toBe(false);
    expect(isDraftExpired({ expiresAt: FUTURE, status: "EXPIRED" }, NOW)).toBe(true);
  });

  it("期限は now から 24 時間後", () => {
    expect(draftExpiresAt(NOW).toISOString()).toBe("2026-08-02T00:00:00.000Z");
  });
});

describe("confirmTicketLink — 検証", () => {
  it("他人/存在しないドラフトは DRAFT_NOT_FOUND", async () => {
    const tx = makeTx({ ticketLinkDraft: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } });
    const r = await confirmTicketLink(tx, BASE);
    expect(r).toMatchObject({ kind: "invalid", code: "DRAFT_NOT_FOUND" });
  });

  it("期限切れドラフトは確定できない", async () => {
    const tx = makeTx({
      ticketLinkDraft: {
        findFirst: vi.fn().mockResolvedValue({ id: "d1", status: "NEEDS_REVIEW", step: "FINAL_REVIEW", expiresAt: PAST, confirmedPayload: payload() }),
        update: vi.fn(),
      },
    });
    const r = await confirmTicketLink(tx, BASE);
    expect(r).toMatchObject({ kind: "invalid", code: "DRAFT_EXPIRED" });
  });

  it("最終確認前のステップでは確定できない（本登録されない）", async () => {
    const tx = makeTx({
      ticketLinkDraft: {
        findFirst: vi.fn().mockResolvedValue({ id: "d1", status: "NEEDS_REVIEW", step: "CODE_NAMES", expiresAt: FUTURE, confirmedPayload: payload() }),
        update: vi.fn(),
      },
    });
    const r = await confirmTicketLink(tx, BASE);
    expect(r).toMatchObject({ kind: "invalid", code: "INVALID_STEP" });
    expect((tx as never as { ticketLink: { create: ReturnType<typeof vi.fn> } }).ticketLink.create).not.toHaveBeenCalled();
  });

  it("無効化されたチケット種別では確定できない", async () => {
    const tx = makeTx({
      ticketLinkDraft: {
        findFirst: vi.fn().mockResolvedValue({ id: "d1", status: "NEEDS_REVIEW", step: "FINAL_REVIEW", expiresAt: FUTURE, confirmedPayload: payload({ ticketTypeKey: "old" }) }),
        update: vi.fn(),
      },
    });
    const r = await confirmTicketLink(tx, BASE);
    expect(r).toMatchObject({ kind: "invalid", code: "INVALID_TICKET_TYPE" });
  });

  it("予約番号が不正なら確定できない", async () => {
    const tx = makeTx({
      ticketLinkDraft: {
        findFirst: vi.fn().mockResolvedValue({ id: "d1", status: "NEEDS_REVIEW", step: "FINAL_REVIEW", expiresAt: FUTURE, confirmedPayload: payload({ normalizedReservationNumber: "abc", reservationNumberRaw: "abc" }) }),
        update: vi.fn(),
      },
    });
    const r = await confirmTicketLink(tx, BASE);
    expect(r).toMatchObject({ kind: "invalid", code: "INVALID_RESERVATION_NUMBER" });
  });

  it("コードネーム数が参加人数と一致しなければ確定できない", async () => {
    const tx = makeTx({
      ticketLinkDraft: {
        findFirst: vi.fn().mockResolvedValue({ id: "d1", status: "NEEDS_REVIEW", step: "FINAL_REVIEW", expiresAt: FUTURE, confirmedPayload: payload({ codeNames: ["アリス"] }) }),
        update: vi.fn(),
      },
    });
    const r = await confirmTicketLink(tx, BASE);
    expect(r).toMatchObject({ kind: "invalid", code: "CODE_NAME_COUNT_MISMATCH" });
  });

  it("コードネームが空ならサーバー側で弾く", async () => {
    const tx = makeTx({
      ticketLinkDraft: {
        findFirst: vi.fn().mockResolvedValue({ id: "d1", status: "NEEDS_REVIEW", step: "FINAL_REVIEW", expiresAt: FUTURE, confirmedPayload: payload({ codeNames: ["アリス", "  "] }) }),
        update: vi.fn(),
      },
    });
    const r = await confirmTicketLink(tx, BASE);
    expect(r).toMatchObject({ kind: "invalid", code: "CODE_NAME_INVALID" });
  });
});

describe("confirmTicketLink — 正常確定", () => {
  it("TicketLink と人数分の TicketLinkMember を作る", async () => {
    const tx = makeTx();
    const r = await confirmTicketLink(tx, BASE);
    expect(r).toMatchObject({ kind: "created", ticketLinkId: "tl-new", status: "PENDING_UZU_BOOKING" });

    const arg = (tx as never as { ticketLink: { create: ReturnType<typeof vi.fn> } }).ticketLink.create.mock.calls[0][0];
    expect(arg.data.status).toBe("PENDING_UZU_BOOKING");
    expect(arg.data.members.create).toEqual([
      { memberIndex: 1, codeName: "アリス" },
      { memberIndex: 2, codeName: "ボブ" },
    ]);
  });

  it("確定時にチケット種別のラベルと人数をスナップショットする", async () => {
    const tx = makeTx();
    await confirmTicketLink(tx, BASE);
    const arg = (tx as never as { ticketLink: { create: ReturnType<typeof vi.fn> } }).ticketLink.create.mock.calls[0][0];
    expect(arg.data.ticketTypeKey).toBe("pair");
    expect(arg.data.ticketType).toBe("2名グループチケット");
    expect(arg.data.participantCount).toBe(2);
  });

  it("確定成功時に購入者名を破棄する（PR4 のバッチを待たない）", async () => {
    const tx = makeTx();
    await confirmTicketLink(tx, BASE);
    const upd = (tx as never as { ticketLinkDraft: { update: ReturnType<typeof vi.fn> } }).ticketLinkDraft.update.mock.calls[0][0];
    expect(upd.data.status).toBe("CONFIRMED");
    expect(JSON.stringify(upd.data.confirmedPayload)).not.toContain("山田太郎");
    expect(upd.data.ocrRawText).toBeNull();
  });

  it("予約番号はサーバー側で再正規化してから保存する", async () => {
    const tx = makeTx({
      ticketLinkDraft: {
        findFirst: vi.fn().mockResolvedValue({ id: "d1", status: "NEEDS_REVIEW", step: "FINAL_REVIEW", expiresAt: FUTURE, confirmedPayload: payload({ normalizedReservationNumber: "１２３－４５６" }) }),
        update: vi.fn().mockResolvedValue({}),
      },
    });
    await confirmTicketLink(tx, BASE);
    const arg = (tx as never as { ticketLink: { create: ReturnType<typeof vi.fn> } }).ticketLink.create.mock.calls[0][0];
    expect(arg.data.normalizedReservationNumber).toBe("123-456");
  });
});

describe("confirmTicketLink — 冪等 / 重複", () => {
  it("確定済みドラフトの再送は既存を返し、二重作成しない", async () => {
    const tx = makeTx({
      ticketLinkDraft: {
        findFirst: vi.fn().mockResolvedValue({ id: "d1", status: "CONFIRMED", step: "FINAL_REVIEW", expiresAt: FUTURE, confirmedPayload: { ticketLinkId: "tl-1" } }),
        update: vi.fn(),
      },
      ticketLink: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue({ id: "tl-1", status: "PENDING_UZU_BOOKING" }),
        create: vi.fn(), update: vi.fn(),
      },
    });
    const r = await confirmTicketLink(tx, BASE);
    expect(r).toMatchObject({ kind: "existing", ticketLinkId: "tl-1" });
    expect((tx as never as { ticketLink: { create: ReturnType<typeof vi.fn> } }).ticketLink.create).not.toHaveBeenCalled();
  });

  it("同一ユーザーの同じ予約番号は既存を返し、コードネームを上書きしない", async () => {
    const tx = makeTx({
      ticketLink: {
        findFirst: vi.fn().mockResolvedValue({ id: "tl-1", status: "PENDING_UZU_BOOKING", lineUserId: "U1" }),
        findUnique: vi.fn(), create: vi.fn(), update: vi.fn(),
      },
    });
    const r = await confirmTicketLink(tx, BASE);
    expect(r).toMatchObject({ kind: "existing", ticketLinkId: "tl-1" });
    expect((tx as never as { ticketLink: { create: ReturnType<typeof vi.fn> } }).ticketLink.create).not.toHaveBeenCalled();
  });

  it("競合送信（P2002）で同一ユーザーなら既存を返す", async () => {
    const dup = new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5.22.0" });
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null) // 事前チェック
      .mockResolvedValueOnce({ id: "tl-race", status: "PENDING_UZU_BOOKING", lineUserId: "U1" }); // P2002 後
    const tx = makeTx({
      ticketLink: { findFirst, findUnique: vi.fn(), create: vi.fn().mockRejectedValue(dup), update: vi.fn() },
    });
    const r = await confirmTicketLink(tx, BASE);
    expect(r).toMatchObject({ kind: "existing", ticketLinkId: "tl-race" });
  });
});

describe("confirmTicketLink — 競合（別ユーザー）", () => {
  it("別ユーザーが先に登録済みなら上書きせず competing 状態を返す", async () => {
    const tx = makeTx({
      ticketLink: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ id: "tl-other", status: "PENDING_UZU_BOOKING", lineUserId: "U-OTHER" })
          .mockResolvedValueOnce(null), // 既存 CONFLICT 行の確認
        findUnique: vi.fn(), create: vi.fn().mockResolvedValue({ id: "tl-conf" }), update: vi.fn(),
      },
    });
    const r = await confirmTicketLink(tx, BASE);
    expect(r).toEqual({ kind: "conflict" });
  });

  it("競合結果に他人の情報を一切含めない", async () => {
    const tx = makeTx({
      ticketLink: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ id: "tl-other", status: "LINKED", lineUserId: "U-OTHER", lineDisplayName: "他人" })
          .mockResolvedValueOnce(null),
        findUnique: vi.fn(), create: vi.fn().mockResolvedValue({ id: "tl-conf" }), update: vi.fn(),
      },
    });
    const r = await confirmTicketLink(tx, BASE);
    const s = JSON.stringify(r);
    expect(s).not.toContain("U-OTHER");
    expect(s).not.toContain("他人");
    expect(s).not.toContain("tl-other");
  });

  it("同一ユーザーの競合再試行では CONFLICT 行を増やさない", async () => {
    const create = vi.fn();
    const tx = makeTx({
      ticketLink: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ id: "tl-other", status: "PENDING_UZU_BOOKING", lineUserId: "U-OTHER" })
          .mockResolvedValueOnce({ id: "tl-conf-existing" }), // 既に競合行がある
        findUnique: vi.fn(), create, update: vi.fn().mockResolvedValue({}),
      },
    });
    const r = await confirmTicketLink(tx, BASE);
    expect(r).toEqual({ kind: "conflict" });
    expect(create).not.toHaveBeenCalled();
  });

  it("競合時にも購入者名を破棄する", async () => {
    const draftUpdate = vi.fn().mockResolvedValue({});
    const tx = makeTx({
      ticketLinkDraft: {
        findFirst: vi.fn().mockResolvedValue({ id: "d1", status: "NEEDS_REVIEW", step: "FINAL_REVIEW", expiresAt: FUTURE, confirmedPayload: payload() }),
        update: draftUpdate,
      },
      ticketLink: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ id: "tl-other", status: "LINKED", lineUserId: "U-OTHER" })
          .mockResolvedValueOnce(null),
        findUnique: vi.fn(), create: vi.fn().mockResolvedValue({ id: "c" }), update: vi.fn(),
      },
    });
    await confirmTicketLink(tx, BASE);
    expect(JSON.stringify(draftUpdate.mock.calls)).not.toContain("山田太郎");
  });
});
