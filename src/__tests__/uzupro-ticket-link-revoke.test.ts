// src/__tests__/uzupro-ticket-link-revoke.test.ts
//
// for ウズプロ ＞ チケット連携の「連携を解除」処理の単体テスト。
//
// ここで守りたいこと:
//   - **物理削除しない**（delete / deleteMany を呼ばない）
//   - status を REVOKED にするだけ
//   - 対象取得・更新のどちらも oaId + workId を where に含める（別 OA / 別作品を操作できない）
//   - 既に REVOKED への再実行が冪等（updatedAt を動かさない）
//   - 監査ログに PII（予約番号 / 氏名 / コードネーム / LINE UID）を入れない

import { describe, it, expect, vi, beforeEach } from "vitest";

const mp = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  deleteMany: vi.fn(),
  activityCreate: vi.fn(),
  txCalls: vi.fn(),
}));
const txClient = vi.hoisted(() => ({}));
vi.mock("@/lib/prisma", () => {
  const client = {
    ticketLink: {
      findFirst: mp.findFirst,
      updateMany: mp.updateMany,
      update: mp.update,
      delete: mp.delete,
      deleteMany: mp.deleteMany,
    },
    uzuProActivityLog: { create: mp.activityCreate },
    // interactive transaction を再現する。コールバックが throw したら
    // そのまま伝播させる（= 実 DB では巻き戻る）。
    $transaction: (fn: (tx: unknown) => unknown) => {
      mp.txCalls();
      return fn(client);
    },
  };
  Object.assign(txClient, client);
  return { prisma: client };
});

import { prisma } from "@/lib/prisma";
import { revokeTicketLink, recordTicketLinkRevoked, revokeTicketLinkAtomic } from "@/lib/uzupro/ticket-link-revoke";

const INPUT = { ticketLinkId: "tl-1", oaId: "oa-1", workId: "w-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mp.findFirst.mockResolvedValue({ id: "tl-1", status: "PENDING_UZU_BOOKING" });
  mp.updateMany.mockResolvedValue({ count: 1 });
  mp.activityCreate.mockResolvedValue({});
});

describe("正常系", () => {
  it("PENDING_UZU_BOOKING を REVOKED にできる", async () => {
    const r = await revokeTicketLink(prisma, INPUT);
    expect(r).toEqual({ kind: "revoked", previousStatus: "PENDING_UZU_BOOKING" });
    expect(mp.updateMany.mock.calls[0][0].data).toEqual({ status: "REVOKED" });
  });

  it("LINKED も解除できる（既存の遷移規則で許可されている）", async () => {
    mp.findFirst.mockResolvedValue({ id: "tl-1", status: "LINKED" });
    const r = await revokeTicketLink(prisma, INPUT);
    expect(r).toEqual({ kind: "revoked", previousStatus: "LINKED" });
  });

  it("CONFLICT も解除できる", async () => {
    mp.findFirst.mockResolvedValue({ id: "tl-1", status: "CONFLICT" });
    const r = await revokeTicketLink(prisma, INPUT);
    expect(r.kind).toBe("revoked");
  });
});

describe("物理削除しない", () => {
  it("delete / deleteMany / update を一切呼ばない（updateMany のみ）", async () => {
    await revokeTicketLink(prisma, INPUT);
    expect(mp.delete).not.toHaveBeenCalled();
    expect(mp.deleteMany).not.toHaveBeenCalled();
    expect(mp.update).not.toHaveBeenCalled();
    expect(mp.updateMany).toHaveBeenCalledTimes(1);
  });

  it("status 以外のカラムを書き換えない", async () => {
    await revokeTicketLink(prisma, INPUT);
    expect(Object.keys(mp.updateMany.mock.calls[0][0].data)).toEqual(["status"]);
  });
});

describe("テナント境界（別 OA / 別作品を操作できない）", () => {
  it("取得時に oaId + workId を where に含める", async () => {
    await revokeTicketLink(prisma, INPUT);
    expect(mp.findFirst.mock.calls[0][0].where).toEqual({ id: "tl-1", oaId: "oa-1", workId: "w-1" });
  });

  it("更新時も oaId + workId を where に含める（id 単体で更新しない）", async () => {
    await revokeTicketLink(prisma, INPUT);
    expect(mp.updateMany.mock.calls[0][0].where).toMatchObject({ id: "tl-1", oaId: "oa-1", workId: "w-1" });
  });

  it("別 OA の id は not_found（存在を露出しない）", async () => {
    mp.findFirst.mockResolvedValue(null);
    const r = await revokeTicketLink(prisma, { ...INPUT, oaId: "oa-other" });
    expect(r).toEqual({ kind: "not_found" });
    expect(mp.updateMany).not.toHaveBeenCalled();
  });

  it("別作品の id は not_found", async () => {
    mp.findFirst.mockResolvedValue(null);
    const r = await revokeTicketLink(prisma, { ...INPUT, workId: "w-other" });
    expect(r).toEqual({ kind: "not_found" });
    expect(mp.updateMany).not.toHaveBeenCalled();
  });

  it("存在しない id も同じく not_found（区別しない）", async () => {
    mp.findFirst.mockResolvedValue(null);
    expect(await revokeTicketLink(prisma, { ...INPUT, ticketLinkId: "nope" })).toEqual({ kind: "not_found" });
  });
});

describe("冪等性", () => {
  it("既に REVOKED なら更新せず already_revoked", async () => {
    mp.findFirst.mockResolvedValue({ id: "tl-1", status: "REVOKED" });
    const r = await revokeTicketLink(prisma, INPUT);
    expect(r).toEqual({ kind: "already_revoked" });
    // updatedAt を動かさないため update 系を呼ばない
    expect(mp.updateMany).not.toHaveBeenCalled();
  });

  it("同時実行で先に解除済みなら（count=0 + 再読込で REVOKED）already_revoked へ倒す", async () => {
    mp.updateMany.mockResolvedValue({ count: 0 });
    mp.findFirst
      .mockResolvedValueOnce({ id: "tl-1", status: "PENDING_UZU_BOOKING" })
      .mockResolvedValueOnce({ status: "REVOKED" });
    const r = await revokeTicketLink(prisma, INPUT);
    expect(r).toEqual({ kind: "already_revoked" });
  });

  it("更新条件は読んだ status との compare-and-swap（not REVOKED だけで更新しない）", async () => {
    mp.findFirst.mockResolvedValue({ id: "tl-1", status: "PENDING_UZU_BOOKING" });
    await revokeTicketLink(prisma, INPUT);
    const where = mp.updateMany.mock.calls[0][0].where;
    // 読んだ status そのものを条件にする
    expect(where.status).toBe("PENDING_UZU_BOOKING");
    // 「REVOKED 以外なら何でも」では更新しない
    expect(where.status).not.toEqual({ not: "REVOKED" });
    // 境界条件も同時に効かせる
    expect(where).toMatchObject({ id: "tl-1", oaId: "oa-1", workId: "w-1" });
  });

  it("二重実行しても REVOKED のまま（2 回目は更新なし）", async () => {
    await revokeTicketLink(prisma, INPUT);
    mp.findFirst.mockResolvedValue({ id: "tl-1", status: "REVOKED" });
    const second = await revokeTicketLink(prisma, INPUT);
    expect(second).toEqual({ kind: "already_revoked" });
    expect(mp.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe("監査ログ（既存 UzuProActivityLog を利用・schema 変更なし）", () => {
  it("action / targetType / targetId / actor / scope を記録する", async () => {
    await recordTicketLinkRevoked(prisma, {
      oaId: "oa-1", workId: "w-1", actorUserId: "u-1",
      ticketLinkId: "tl-1", previousStatus: "PENDING_UZU_BOOKING",
    });
    const data = mp.activityCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      oaId: "oa-1", workId: "w-1", actorUserId: "u-1",
      action: "ticket_link_revoke", targetType: "ticket_link", targetId: "tl-1",
    });
  });

  it("detail は遷移元/先のみで PII を含まない", async () => {
    await recordTicketLinkRevoked(prisma, {
      oaId: "oa-1", workId: "w-1", actorUserId: "u-1",
      ticketLinkId: "tl-1", previousStatus: "LINKED",
    });
    const detail = mp.activityCreate.mock.calls[0][0].data.detail as string;
    expect(JSON.parse(detail)).toEqual({ from: "LINKED", to: "REVOKED" });
    // 予約番号 / 氏名 / コードネーム / LINE UID を含まない
    for (const pii of ["123-456", "reservation", "codeName", "lineUserId", "displayName"]) {
      expect(detail).not.toContain(pii);
    }
  });
});

describe("REVOKED 後のプレイヤー向け LIFF 挙動（既存仕様の再利用）", () => {
  const read = (rel: string) =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("node:fs").readFileSync(new URL(rel, import.meta.url), "utf8") as string;

  it("LIFF config は status != REVOKED で有効な連携を絞る（既存条件をそのまま使う）", () => {
    const route = read("../app/api/liff/works/[workId]/ticket-link/config/route.ts");
    expect(route).toMatch(/status:\s*\{\s*not:\s*"REVOKED"\s*\}/);
  });

  it("解除処理は LIFF 側に新しい除外条件を足していない", () => {
    const revoke = read("../lib/uzupro/ticket-link-revoke.ts");
    // status を REVOKED にするだけ。LIFF 用のフラグや別カラムを持ち込まない。
    expect(revoke).not.toContain("hidden");
    expect(revoke).not.toContain("visible");
    expect(revoke).not.toContain("deletedAt");
  });

  it("マスク仕様には触れていない", () => {
    const revoke = read("../lib/uzupro/ticket-link-revoke.ts");
    expect(revoke).not.toContain("maskReservationNumber");
  });
});

describe("原子性（status 更新と ActivityLog を同一トランザクションで行う）", () => {
  it("$transaction の中で status 更新と ActivityLog 作成を実行する", async () => {
    const r = await revokeTicketLinkAtomic({ ...INPUT, actorUserId: "u-1" });
    expect(r).toEqual({ kind: "revoked", previousStatus: "PENDING_UZU_BOOKING" });
    // トランザクションが 1 回開かれ、その中で両方が呼ばれている
    expect(mp.txCalls).toHaveBeenCalledTimes(1);
    expect(mp.updateMany).toHaveBeenCalledTimes(1);
    expect(mp.activityCreate).toHaveBeenCalledTimes(1);
  });

  it("正常時は status 更新と ActivityLog がそれぞれ 1 回だけ", async () => {
    await revokeTicketLinkAtomic({ ...INPUT, actorUserId: "u-1" });
    expect(mp.updateMany).toHaveBeenCalledTimes(1);
    expect(mp.activityCreate).toHaveBeenCalledTimes(1);
  });

  it("ActivityLog の作成が失敗したらトランザクションごと失敗する（部分成功にしない）", async () => {
    mp.activityCreate.mockRejectedValue(new Error("log write failed"));
    // コールバックの throw がそのまま伝播する = 実 DB では status 更新も巻き戻る
    await expect(revokeTicketLinkAtomic({ ...INPUT, actorUserId: "u-1" })).rejects.toThrow("log write failed");
    expect(mp.txCalls).toHaveBeenCalledTimes(1);
  });

  it("status 更新 → ActivityLog の順で呼ばれる（ログ先行で書かない）", async () => {
    const order: string[] = [];
    mp.updateMany.mockImplementation(async () => { order.push("update"); return { count: 1 }; });
    mp.activityCreate.mockImplementation(async () => { order.push("log"); return {}; });
    await revokeTicketLinkAtomic({ ...INPUT, actorUserId: "u-1" });
    expect(order).toEqual(["update", "log"]);
  });

  it("既に REVOKED なら status 更新も ActivityLog も書かない（冪等維持）", async () => {
    mp.findFirst.mockResolvedValue({ id: "tl-1", status: "REVOKED" });
    const r = await revokeTicketLinkAtomic({ ...INPUT, actorUserId: "u-1" });
    expect(r).toEqual({ kind: "already_revoked" });
    expect(mp.updateMany).not.toHaveBeenCalled();
    expect(mp.activityCreate).not.toHaveBeenCalled();
  });

  it("not_found でも何も書き込まない", async () => {
    mp.findFirst.mockResolvedValue(null);
    const r = await revokeTicketLinkAtomic({ ...INPUT, actorUserId: "u-1" });
    expect(r).toEqual({ kind: "not_found" });
    expect(mp.updateMany).not.toHaveBeenCalled();
    expect(mp.activityCreate).not.toHaveBeenCalled();
  });

  it("actorUserId は引数のセッション値がそのまま記録される", async () => {
    await revokeTicketLinkAtomic({ ...INPUT, actorUserId: "u-session" });
    expect(mp.activityCreate.mock.calls[0][0].data.actorUserId).toBe("u-session");
  });
});

describe("並行 status 更新との競合（CMS 照合結果との TOCTOU）", () => {
  it("読んだ後に LINKED へ変わったら、stale な PENDING を条件に更新しない", async () => {
    // 1 周目: PENDING を読む → CAS 失敗（実際は LINKED に変わっている）
    // 2 周目: LINKED を読み直して CAS 成功
    mp.findFirst
      .mockResolvedValueOnce({ id: "tl-1", status: "PENDING_UZU_BOOKING" })
      .mockResolvedValueOnce({ id: "tl-1", status: "LINKED" });
    mp.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const r = await revokeTicketLink(prisma, INPUT);

    // stale な PENDING を previousStatus にしない
    expect(r).toEqual({ kind: "revoked", previousStatus: "LINKED" });
    expect(mp.updateMany.mock.calls[0][0].where.status).toBe("PENDING_UZU_BOOKING");
    expect(mp.updateMany.mock.calls[1][0].where.status).toBe("LINKED");
  });

  it("CAS 再試行は 1 回まで（無制限に retry しない）", async () => {
    mp.updateMany.mockResolvedValue({ count: 0 });
    mp.findFirst.mockResolvedValue({ id: "tl-1", status: "LINKED" });
    const r = await revokeTicketLink(prisma, INPUT);
    // 更新は 2 回まで。3 回目は撃たない。
    expect(mp.updateMany).toHaveBeenCalledTimes(2);
    // 成功扱いにせず conflict
    expect(r).toEqual({ kind: "conflict", currentStatus: "LINKED" });
  });

  it("CAS 失敗後に REVOKED なら already_revoked（更新しない）", async () => {
    mp.findFirst
      .mockResolvedValueOnce({ id: "tl-1", status: "PENDING_UZU_BOOKING" })
      .mockResolvedValueOnce({ id: "tl-1", status: "REVOKED" });
    mp.updateMany.mockResolvedValue({ count: 0 });
    const r = await revokeTicketLink(prisma, INPUT);
    expect(r).toEqual({ kind: "already_revoked" });
    expect(mp.updateMany).toHaveBeenCalledTimes(1);
  });

  it("CAS 失敗後に行が無ければ not_found", async () => {
    mp.findFirst
      .mockResolvedValueOnce({ id: "tl-1", status: "PENDING_UZU_BOOKING" })
      .mockResolvedValueOnce(null);
    mp.updateMany.mockResolvedValue({ count: 0 });
    expect(await revokeTicketLink(prisma, INPUT)).toEqual({ kind: "not_found" });
  });

  it("DB error は競合として扱わず throw する（conflict / already_revoked に化けない）", async () => {
    mp.updateMany.mockRejectedValue(new Error("db down"));
    await expect(revokeTicketLink(prisma, INPUT)).rejects.toThrow("db down");
    // 握りつぶして再試行しない
    expect(mp.updateMany).toHaveBeenCalledTimes(1);
  });

  it("findFirst の DB error も競合扱いしない", async () => {
    mp.findFirst.mockRejectedValue(new Error("read failed"));
    await expect(revokeTicketLink(prisma, INPUT)).rejects.toThrow("read failed");
  });
});

describe("ActivityLog.detail.from は CAS で一致した直前 status", () => {
  it("競合で status が動いた場合、記録されるのは最初の読み取り値ではなく実際の直前 status", async () => {
    mp.findFirst
      .mockResolvedValueOnce({ id: "tl-1", status: "PENDING_UZU_BOOKING" })
      .mockResolvedValueOnce({ id: "tl-1", status: "LINKED" });
    mp.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await revokeTicketLinkAtomic({ ...INPUT, actorUserId: "u-1" });

    const detail = JSON.parse(mp.activityCreate.mock.calls[0][0].data.detail);
    expect(detail).toMatchObject({ from: "LINKED", to: "REVOKED" });
    expect(detail.from).not.toBe("PENDING_UZU_BOOKING");
  });

  it("競合が無ければ読んだ status がそのまま from になる", async () => {
    mp.findFirst.mockResolvedValue({ id: "tl-1", status: "CONFLICT" });
    await revokeTicketLinkAtomic({ ...INPUT, actorUserId: "u-1" });
    expect(JSON.parse(mp.activityCreate.mock.calls[0][0].data.detail))
      .toMatchObject({ from: "CONFLICT", to: "REVOKED" });
  });

  it("conflict で終わった場合は ActivityLog を書かない", async () => {
    mp.updateMany.mockResolvedValue({ count: 0 });
    mp.findFirst.mockResolvedValue({ id: "tl-1", status: "LINKED" });
    const r = await revokeTicketLinkAtomic({ ...INPUT, actorUserId: "u-1" });
    expect(r.kind).toBe("conflict");
    expect(mp.activityCreate).not.toHaveBeenCalled();
  });
});
