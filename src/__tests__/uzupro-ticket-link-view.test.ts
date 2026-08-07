// src/__tests__/uzupro-ticket-link-view.test.ts
//
// for ウズプロ ＞ チケット連携（管理・read-only）の View Model 単体テスト。
//
// ここで守りたいこと:
//   - oaId + workId で必ずスコープされ、別 OA / 別作品の行を引けないこと
//   - status フィルタ / 予約番号検索 / コードネーム検索 / 種別検索 / ページング
//   - 予約番号検索が **既存の normalizeReservationNumber を再利用**していること
//     （１２３４５６ / 123 456 / 123-456 が同じ結果になる）
//   - View Model に LINE UID 等を含めないこと
//   - **書き込みを一切行わないこと**（prisma の write メソッドを呼ばない）

import { describe, it, expect, vi, beforeEach } from "vitest";

const mp = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  deleteMany: vi.fn(),
  workFindFirst: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticketLink: {
      findMany: mp.findMany,
      count: mp.count,
      groupBy: mp.groupBy,
      update: mp.update,
      updateMany: mp.updateMany,
      create: mp.create,
      delete: mp.delete,
      deleteMany: mp.deleteMany,
    },
    work: { findFirst: mp.workFindFirst },
  },
}));

import {
  getTicketLinkAdminView,
  parseTicketLinkFilters,
  buildReservationNumberWhere,
  TICKET_LINK_PAGE_SIZE,
  TICKET_LINK_STATUS_LABEL,
  TICKET_LINK_STATUSES,
} from "@/lib/uzupro/ticket-link-view";

function row(over: Record<string, unknown> = {}) {
  return {
    id: "tl-1",
    status: "PENDING_UZU_BOOKING",
    ticketType: "1名様貸切チケット",
    participantCount: 1,
    normalizedReservationNumber: "123-456",
    reservationNumberRaw: "123-456",
    source: "LIFF_MANUAL",
    confirmedAt: new Date("2026-08-01T00:00:00Z"),
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    uzuSyncedAt: null,
    members: [{ codeName: "ALPHA" }],
    ...over,
  };
}

const BASE = { oaId: "oa-1", workId: "w-1" };
const NO_FILTER = { status: null, reservationNumber: null, codeName: null, ticketType: null, page: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  mp.workFindFirst.mockResolvedValue({ title: "OPERATION ; BELKISSH" });
  mp.count.mockResolvedValue(1);
  mp.groupBy.mockResolvedValue([{ status: "PENDING_UZU_BOOKING", _count: { _all: 1 } }]);
  mp.findMany.mockResolvedValue([row()]);
});

describe("スコープ（別 OA / 別作品を引けない）", () => {
  it("count / findMany / groupBy すべてに oaId + workId が入る", async () => {
    await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });

    for (const fn of [mp.count, mp.findMany]) {
      expect(fn.mock.calls[0][0].where).toMatchObject({ oaId: "oa-1", workId: "w-1" });
    }
    expect(mp.groupBy.mock.calls[0][0].where).toEqual({ oaId: "oa-1", workId: "w-1" });
  });

  it("フィルタを付けてもスコープが外れない", async () => {
    await getTicketLinkAdminView({
      ...BASE,
      filters: { ...NO_FILTER, status: "LINKED", reservationNumber: "123-456", codeName: "A", ticketType: "貸切" },
    });
    expect(mp.findMany.mock.calls[0][0].where).toMatchObject({ oaId: "oa-1", workId: "w-1" });
  });
});

describe("読み取り専用", () => {
  it("書き込み系の prisma メソッドを一切呼ばない", async () => {
    await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });
    for (const fn of [mp.update, mp.updateMany, mp.create, mp.delete, mp.deleteMany]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe("View Model の内容", () => {
  it("LINE UID / 表示名を select しない（Client へ渡さない）", async () => {
    await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });
    const select = mp.findMany.mock.calls[0][0].select;
    expect(select.lineUserId).toBeUndefined();
    expect(select.lineDisplayName).toBeUndefined();
  });

  it("予約番号はフル値で返る（管理画面は照合キーとして必要）", async () => {
    const v = await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });
    expect(v.rows[0].reservationNumber).toBe("123-456");
    expect(v.rows[0].reservationNumber).not.toContain("*");
  });

  it("原文と正規形が同じなら表記ゆれフラグは false", async () => {
    const v = await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });
    expect(v.rows[0].reservationNumberDiffers).toBe(false);
  });

  it("原文が正規形と異なるときだけ表記ゆれフラグが true", async () => {
    mp.findMany.mockResolvedValue([row({ reservationNumberRaw: "１２３４５６" })]);
    const v = await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });
    expect(v.rows[0].reservationNumberDiffers).toBe(true);
    expect(v.rows[0].reservationNumberRaw).toBe("１２３４５６");
  });

  it("コードネームを人数分そのまま並べる（4名様貸切）", async () => {
    mp.findMany.mockResolvedValue([
      row({ participantCount: 4, ticketType: "4名様貸切チケット",
            members: [{ codeName: "ALPHA" }, { codeName: "BRAVO" }, { codeName: "CHARLIE" }, { codeName: "DELTA" }] }),
    ]);
    const v = await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });
    expect(v.rows[0].codeNames).toEqual(["ALPHA", "BRAVO", "CHARLIE", "DELTA"]);
    expect(v.rows[0].participantCount).toBe(4);
  });

  it("日時は ISO 文字列で返し、未同期は null", async () => {
    const v = await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });
    expect(v.rows[0].createdAt).toBe("2026-08-01T00:00:00.000Z");
    expect(v.rows[0].uzuSyncedAt).toBeNull();
  });

  it("status ラベルは既存 enum 4 種すべてを網羅する", () => {
    expect(TICKET_LINK_STATUSES).toEqual(["PENDING_UZU_BOOKING", "LINKED", "CONFLICT", "REVOKED"]);
    for (const s of TICKET_LINK_STATUSES) {
      expect(TICKET_LINK_STATUS_LABEL[s]).toBeTruthy();
    }
  });
});

describe("status フィルタ", () => {
  it("指定時は where.status に入る", async () => {
    await getTicketLinkAdminView({ ...BASE, filters: { ...NO_FILTER, status: "CONFLICT" } });
    expect(mp.findMany.mock.calls[0][0].where.status).toBe("CONFLICT");
  });

  it("未指定なら status 条件を付けない（REVOKED も含む全件）", async () => {
    await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });
    expect(mp.findMany.mock.calls[0][0].where.status).toBeUndefined();
  });

  it("REVOKED も絞り込みできる", async () => {
    await getTicketLinkAdminView({ ...BASE, filters: { ...NO_FILTER, status: "REVOKED" } });
    expect(mp.findMany.mock.calls[0][0].where.status).toBe("REVOKED");
  });

  it("statusCounts は 4 種すべてのキーを持つ（未出現は 0）", async () => {
    const v = await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });
    expect(Object.keys(v.statusCounts).sort()).toEqual([...TICKET_LINK_STATUSES].sort());
    expect(v.statusCounts.LINKED).toBe(0);
    expect(v.statusCounts.PENDING_UZU_BOOKING).toBe(1);
  });
});

describe("予約番号検索（既存 normalize を再利用）", () => {
  it("表記ゆれがすべて同じ正規形に解決される", () => {
    for (const input of ["123456", "123-456", "123 456", "１２３４５６", "123ー456", " 123-456 "]) {
      expect(buildReservationNumberWhere(input), input)
        .toEqual({ normalizedReservationNumber: "123-456" });
    }
  });

  it("正規形へ解決できる入力は完全一致で引く（部分一致にしない）", () => {
    const w = buildReservationNumberWhere("123-456");
    expect(typeof w.normalizedReservationNumber).toBe("string");
  });

  it("部分入力は contains で拾う", () => {
    expect(buildReservationNumberWhere("123")).toEqual({
      normalizedReservationNumber: { contains: "123" },
    });
  });

  it("全角の部分入力も半角へ寄せて contains にする", () => {
    expect(buildReservationNumberWhere("１２３")).toEqual({
      normalizedReservationNumber: { contains: "123" },
    });
  });

  it("数字を含まない入力は条件を作らない（全件返しを防ぐ意図の空オブジェクト）", () => {
    expect(buildReservationNumberWhere("あいうえお")).toEqual({});
  });

  it("view から呼ぶと where に反映される", async () => {
    await getTicketLinkAdminView({ ...BASE, filters: { ...NO_FILTER, reservationNumber: "１２３４５６" } });
    expect(mp.findMany.mock.calls[0][0].where.normalizedReservationNumber).toBe("123-456");
  });
});

describe("コードネーム / 種別 検索", () => {
  it("コードネームは members の部分一致（大文字小文字を無視）", async () => {
    await getTicketLinkAdminView({ ...BASE, filters: { ...NO_FILTER, codeName: "alpha" } });
    expect(mp.findMany.mock.calls[0][0].where.members).toEqual({
      some: { codeName: { contains: "alpha", mode: "insensitive" } },
    });
  });

  it("チケット種別は ticketType の部分一致", async () => {
    await getTicketLinkAdminView({ ...BASE, filters: { ...NO_FILTER, ticketType: "貸切" } });
    expect(mp.findMany.mock.calls[0][0].where.ticketType).toEqual({
      contains: "貸切", mode: "insensitive",
    });
  });
});

describe("ページング", () => {
  it("既定は 1 ページ目・skip 0", async () => {
    await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });
    expect(mp.findMany.mock.calls[0][0].skip).toBe(0);
    expect(mp.findMany.mock.calls[0][0].take).toBe(TICKET_LINK_PAGE_SIZE);
  });

  it("2 ページ目は pageSize 分 skip する", async () => {
    await getTicketLinkAdminView({ ...BASE, filters: { ...NO_FILTER, page: 3 } });
    expect(mp.findMany.mock.calls[0][0].skip).toBe(TICKET_LINK_PAGE_SIZE * 2);
  });

  it("総ページ数を件数から算出する", async () => {
    mp.count.mockResolvedValue(TICKET_LINK_PAGE_SIZE * 2 + 1);
    const v = await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });
    expect(v.pages).toBe(3);
  });

  it("0 件でも pages は 1（ページャが壊れない）", async () => {
    mp.count.mockResolvedValue(0);
    mp.findMany.mockResolvedValue([]);
    const v = await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });
    expect(v.pages).toBe(1);
    expect(v.rows).toEqual([]);
  });

  it("新しい順（createdAt desc）で並べる", async () => {
    await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });
    expect(mp.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });
});

describe("parseTicketLinkFilters（URL クエリ）", () => {
  it("未指定なら既定値", () => {
    expect(parseTicketLinkFilters({})).toEqual(NO_FILTER);
  });

  it("既知の status だけ採用し、未知値は無視する", () => {
    expect(parseTicketLinkFilters({ status: "LINKED" }).status).toBe("LINKED");
    expect(parseTicketLinkFilters({ status: "APPROVED" }).status).toBeNull();
    expect(parseTicketLinkFilters({ status: "" }).status).toBeNull();
  });

  it("検索語は trim され、空なら null", () => {
    expect(parseTicketLinkFilters({ rn: "  123-456 " }).reservationNumber).toBe("123-456");
    expect(parseTicketLinkFilters({ cn: "   " }).codeName).toBeNull();
  });

  it("page は 1 以上の整数のみ採用", () => {
    expect(parseTicketLinkFilters({ page: "3" }).page).toBe(3);
    expect(parseTicketLinkFilters({ page: "0" }).page).toBe(1);
    expect(parseTicketLinkFilters({ page: "-2" }).page).toBe(1);
    expect(parseTicketLinkFilters({ page: "abc" }).page).toBe(1);
  });

  it("配列で渡っても先頭を使う", () => {
    expect(parseTicketLinkFilters({ status: ["CONFLICT", "LINKED"] }).status).toBe("CONFLICT");
  });
});

describe("先頭グループが同じ別予約の識別（実機で同一に見えた件の確認手段）", () => {
  it("123-456 と 123-789 は管理画面では別レコードとして区別できる", async () => {
    mp.count.mockResolvedValue(2);
    mp.findMany.mockResolvedValue([
      row({ id: "tl-1", normalizedReservationNumber: "123-456", reservationNumberRaw: "123-456" }),
      row({ id: "tl-2", normalizedReservationNumber: "123-789", reservationNumberRaw: "123-789" }),
    ]);
    const v = await getTicketLinkAdminView({ ...BASE, filters: NO_FILTER });
    expect(v.rows.map((r) => r.reservationNumber)).toEqual(["123-456", "123-789"]);
    // プレイヤー画面では両方 "123-***" になるが、この画面では区別できる
    expect(new Set(v.rows.map((r) => r.reservationNumber)).size).toBe(2);
  });
});
