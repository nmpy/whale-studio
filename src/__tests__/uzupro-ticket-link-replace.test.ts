// src/__tests__/uzupro-ticket-link-replace.test.ts
//
// チケット連携「内容を修正」= replacement のドメインロジック検証（PR-C）。
//
// ここで守りたいこと:
//   - 既存 TicketLink を上書きしない（status のみ REVOKED / 内容と members は不変）
//   - 新 TicketLink は PENDING_UZU_BOOKING + members 人数分 + ownership 継承
//   - uzuSyncedAt 等の同期済み状態を引き継がない（CMS 再照合の対象になる）
//   - 旧解除・新規作成・監査ログが同一トランザクション（部分成功を作らない）
//   - 旧リンクの CAS が replacement 作成の gate（二重作成・revoke との競合を防ぐ）
//   - no-op はいかなる write も起こさない

import { describe, it, expect, vi, beforeEach } from "vitest";

const mp = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  deleteMany: vi.fn(),
  create: vi.fn(),
  memberUpdate: vi.fn(),
  memberDelete: vi.fn(),
  memberDeleteMany: vi.fn(),
  memberCreate: vi.fn(),
  workFindFirst: vi.fn(),
  activityCreate: vi.fn(),
  txCalls: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const client = {
    ticketLink: {
      findFirst: mp.findFirst,
      updateMany: mp.updateMany,
      update: mp.update,
      delete: mp.delete,
      deleteMany: mp.deleteMany,
      create: mp.create,
    },
    ticketLinkMember: {
      update: mp.memberUpdate,
      delete: mp.memberDelete,
      deleteMany: mp.memberDeleteMany,
      create: mp.memberCreate,
    },
    work: { findFirst: mp.workFindFirst },
    uzuProActivityLog: { create: mp.activityCreate },
    // interactive transaction を再現する。コールバックの throw はそのまま伝播する
    // （= 実 DB では全体が巻き戻る）。
    $transaction: (fn: (tx: unknown) => unknown) => {
      mp.txCalls();
      return fn(client);
    },
  };
  return { prisma: client };
});

import { prisma } from "@/lib/prisma";
import {
  replaceTicketLink,
  runTicketLinkReplace,
  isSameTicketLinkContent,
} from "@/lib/uzupro/ticket-link-replace";

const OA = "oa-1";
const WORK = "w-1";
const OLD_ID = "tl-old";

/** 作品設定（参加人数の source of truth）。 */
const SETTINGS = {
  ticket_link: {
    enabled: true,
    manualInputEnabled: true,
    ticketTypes: [
      { ticketTypeKey: "solo", ticketTypeLabel: "1名チケット", participantCount: 1, enabled: true, sortOrder: 0 },
      { ticketTypeKey: "quad", ticketTypeLabel: "4名グループチケット", participantCount: 4, enabled: true, sortOrder: 1 },
      { ticketTypeKey: "old", ticketTypeLabel: "廃止チケット", participantCount: 2, enabled: false, sortOrder: 2 },
    ],
  },
};

function oldLink(over: Record<string, unknown> = {}) {
  return {
    id: OLD_ID,
    status: "PENDING_UZU_BOOKING",
    lineUserId: "Uplayer",
    lineDisplayName: "たろう",
    source: "LIFF_MANUAL",
    normalizedReservationNumber: "123-456",
    ticketTypeKey: "solo",
    participantCount: 1,
    members: [{ codeName: "アリス" }],
    ...over,
  };
}

const INPUT = {
  ticketLinkId: OLD_ID,
  oaId: OA,
  workId: WORK,
  ticketTypeKey: "quad",
  reservationNumberInput: "999-888",
  codeNames: ["A", "B", "C", "D"],
};

const NOW = new Date("2026-08-07T10:00:00Z");
const run = (input = INPUT) => runTicketLinkReplace(prisma, input, "u-actor", NOW);

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks は once キューを消さない。テスト間で持ち越さないよう明示的に reset する。
  mp.findFirst.mockReset();
  mp.updateMany.mockReset();
  mp.create.mockReset();
  // [0] 対象取得, [1] 予約番号の先約チェック(なし)
  mp.findFirst.mockResolvedValueOnce(oldLink()).mockResolvedValue(null);
  mp.workFindFirst.mockResolvedValue({ liffHomeSettingsJson: SETTINGS });
  mp.updateMany.mockResolvedValue({ count: 1 });
  mp.create.mockResolvedValue({ id: "tl-new" });
  mp.activityCreate.mockResolvedValue({});
});

describe("replacement の基本形", () => {
  it("旧を REVOKED にし、新を PENDING_UZU_BOOKING で作成する", async () => {
    const r = await run();
    expect(r).toEqual({
      kind: "replaced", oldTicketLinkId: OLD_ID, newTicketLinkId: "tl-new", previousStatus: "PENDING_UZU_BOOKING",
    });
    expect(mp.updateMany.mock.calls[0][0].data).toEqual({ status: "REVOKED" });
    expect(mp.create.mock.calls[0][0].data.status).toBe("PENDING_UZU_BOOKING");
  });

  it.each(["PENDING_UZU_BOOKING", "LINKED", "CONFLICT"] as const)(
    "%s からも修正できる（新は必ず PENDING_UZU_BOOKING）",
    async (status) => {
      mp.findFirst.mockReset();
      mp.findFirst.mockResolvedValueOnce(oldLink({ status })).mockResolvedValue(null);
      const r = await run();
      expect(r.kind).toBe("replaced");
      expect(mp.updateMany.mock.calls[0][0].where.status).toBe(status);
      expect(mp.create.mock.calls[0][0].data.status).toBe("PENDING_UZU_BOOKING");
    },
  );

  it("旧 TicketLink の内容は一切変更しない（status 以外を書かない）", async () => {
    await run();
    // 旧行への書き込みは status のみ
    expect(mp.updateMany.mock.calls[0][0].data).toEqual({ status: "REVOKED" });
    expect(mp.update).not.toHaveBeenCalled();
    // 物理削除もしない
    expect(mp.delete).not.toHaveBeenCalled();
    expect(mp.deleteMany).not.toHaveBeenCalled();
  });

  it("旧 TicketLinkMember を update / delete / 付け替えしない", async () => {
    await run();
    expect(mp.memberUpdate).not.toHaveBeenCalled();
    expect(mp.memberDelete).not.toHaveBeenCalled();
    expect(mp.memberDeleteMany).not.toHaveBeenCalled();
    // 新メンバーは新リンクのネスト create でのみ作る
    expect(mp.memberCreate).not.toHaveBeenCalled();
  });

  it("新 members が participantCount 人数分・memberIndex 1..n で作られる", async () => {
    await run();
    const members = mp.create.mock.calls[0][0].data.members.create;
    expect(members).toHaveLength(4);
    expect(members.map((m: { memberIndex: number }) => m.memberIndex)).toEqual([1, 2, 3, 4]);
    expect(members.map((m: { codeName: string }) => m.codeName)).toEqual(["A", "B", "C", "D"]);
  });

  it("ownership（lineUserId / 表示名 / OA / 作品 / 登録経路）を旧リンクから引き継ぐ", async () => {
    await run();
    expect(mp.create.mock.calls[0][0].data).toMatchObject({
      oaId: OA, workId: WORK, lineUserId: "Uplayer", lineDisplayName: "たろう", source: "LIFF_MANUAL",
    });
  });

  it("uzuSyncedAt を引き継がない（CMS 差分取得の対象として拾われる）", async () => {
    await run();
    expect(mp.create.mock.calls[0][0].data.uzuSyncedAt).toBeUndefined();
  });

  it("チケット種別の表示名・人数は作品設定から解決する（クライアント値を使わない）", async () => {
    await run();
    expect(mp.create.mock.calls[0][0].data).toMatchObject({
      ticketTypeKey: "quad", ticketType: "4名グループチケット", participantCount: 4,
    });
  });

  it("confirmedAt は replacement 実行時刻", async () => {
    await run();
    expect(mp.create.mock.calls[0][0].data.confirmedAt).toBe(NOW);
  });
});

describe("検証（既存の純関数を再利用）", () => {
  it("予約番号は既存 normalize を通した正規形で保存する（表記ゆれ吸収）", async () => {
    await run({ ...INPUT, reservationNumberInput: "９９９ ８８８" });
    expect(mp.create.mock.calls[0][0].data.normalizedReservationNumber).toBe("999-888");
  });

  it("不正文字を含む予約番号は拒否し、何も書き込まない", async () => {
    const r = await run({ ...INPUT, reservationNumberInput: "abc123def456" });
    expect(r).toMatchObject({ kind: "invalid", code: "INVALID_RESERVATION_NUMBER" });
    expect(mp.updateMany).not.toHaveBeenCalled();
    expect(mp.create).not.toHaveBeenCalled();
  });

  it("桁不足の予約番号は拒否する", async () => {
    const r = await run({ ...INPUT, reservationNumberInput: "12345" });
    expect(r).toMatchObject({ kind: "invalid", code: "INVALID_RESERVATION_NUMBER" });
  });

  it("無効化済みのチケット種別は解決しない", async () => {
    const r = await run({ ...INPUT, ticketTypeKey: "old", codeNames: ["A", "B"] });
    expect(r).toMatchObject({ kind: "invalid", code: "INVALID_TICKET_TYPE" });
    expect(mp.updateMany).not.toHaveBeenCalled();
  });

  it("未知のチケット種別キーは解決しない", async () => {
    const r = await run({ ...INPUT, ticketTypeKey: "nope" });
    expect(r).toMatchObject({ kind: "invalid", code: "INVALID_TICKET_TYPE" });
  });

  it("コードネーム件数が participantCount と一致しないと拒否する", async () => {
    const r = await run({ ...INPUT, codeNames: ["A", "B"] });
    expect(r).toMatchObject({ kind: "invalid", code: "CODE_NAME_COUNT_MISMATCH" });
    expect(mp.create).not.toHaveBeenCalled();
  });

  it("空のコードネームは既存 validateCodeNames で拒否する", async () => {
    const r = await run({ ...INPUT, codeNames: ["A", "  ", "C", "D"] });
    expect(r).toMatchObject({ kind: "invalid", code: "CODE_NAME_INVALID" });
  });

  it("コードネームは trim / NFKC 済みの値で保存される", async () => {
    await run({ ...INPUT, codeNames: [" A ", "B", "C", "D"] });
    expect(mp.create.mock.calls[0][0].data.members.create[0].codeName).toBe("A");
  });
});

describe("no-op 修正の拒否", () => {
  const sameInput = {
    ...INPUT, ticketTypeKey: "solo", reservationNumberInput: "123-456", codeNames: ["アリス"],
  };

  it("全項目が同一なら何も書き込まない", async () => {
    const r = await run(sameInput);
    expect(r).toEqual({ kind: "no_change" });
    expect(mp.updateMany).not.toHaveBeenCalled();
    expect(mp.create).not.toHaveBeenCalled();
    expect(mp.activityCreate).not.toHaveBeenCalled();
  });

  it("予約番号の表記ゆれだけなら「変更なし」とみなす", async () => {
    const r = await run({ ...sameInput, reservationNumberInput: "１２３４５６" });
    expect(r).toEqual({ kind: "no_change" });
    expect(mp.updateMany).not.toHaveBeenCalled();
  });

  it("コードネームの前後空白だけの違いも「変更なし」", async () => {
    const r = await run({ ...sameInput, codeNames: [" アリス "] });
    expect(r).toEqual({ kind: "no_change" });
  });

  it("コードネームが変われば replacement を作る", async () => {
    const r = await run({ ...sameInput, codeNames: ["ボブ"] });
    expect(r.kind).toBe("replaced");
  });

  it("isSameTicketLinkContent: 種別キーが変われば別内容", () => {
    expect(
      isSameTicketLinkContent(
        { normalizedReservationNumber: "123-456", ticketTypeKey: "solo", participantCount: 1, members: [{ codeName: "A" }] },
        { normalized: "123-456", ticketTypeKey: "quad", participantCount: 1, codeNames: ["A"] },
      ),
    ).toBe(false);
  });
});

describe("予約番号の先約（部分 UNIQUE 相当）", () => {
  it("別の有効な連携が同じ予約番号を使っていれば作らない", async () => {
    mp.findFirst.mockReset();
    mp.findFirst.mockResolvedValueOnce(oldLink()).mockResolvedValueOnce({ id: "tl-other" });
    const r = await run();
    expect(r).toEqual({ kind: "reservation_taken" });
    // 旧リンクを REVOKED にしていない
    expect(mp.updateMany).not.toHaveBeenCalled();
    expect(mp.create).not.toHaveBeenCalled();
  });

  it("先約チェックは PENDING / LINKED のみを見て、旧リンク自身を除外する", async () => {
    await run();
    const where = mp.findFirst.mock.calls[1][0].where;
    expect(where.status).toEqual({ in: ["PENDING_UZU_BOOKING", "LINKED"] });
    expect(where.id).toEqual({ not: OLD_ID });
    expect(where).toMatchObject({ oaId: OA, workId: WORK, normalizedReservationNumber: "999-888" });
  });

  it("同じ予約番号のまま他項目だけ修正できる（旧を解除して UNIQUE を解放してから作る）", async () => {
    const r = await run({ ...INPUT, reservationNumberInput: "123-456" });
    expect(r.kind).toBe("replaced");
    // 解除 → 作成 の順であること
    expect(mp.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mp.create.mock.invocationCallOrder[0]);
  });
});

describe("テナント境界", () => {
  it("対象は id + oaId + workId で引く", async () => {
    await run();
    expect(mp.findFirst.mock.calls[0][0].where).toEqual({ id: OLD_ID, oaId: OA, workId: WORK });
  });

  it("別 OA / 別作品 / 不在は not_found（区別しない）", async () => {
    mp.findFirst.mockReset();
    mp.findFirst.mockResolvedValue(null);
    expect(await run()).toEqual({ kind: "not_found" });
    expect(mp.updateMany).not.toHaveBeenCalled();
  });

  it("work も OA スコープで引く", async () => {
    await run();
    expect(mp.workFindFirst.mock.calls[0][0].where).toEqual({ id: WORK, oaId: OA });
  });

  it("REVOKED は terminal なので修正できない", async () => {
    mp.findFirst.mockReset();
    mp.findFirst.mockResolvedValueOnce(oldLink({ status: "REVOKED" })).mockResolvedValue(null);
    expect(await run()).toEqual({ kind: "already_revoked" });
    expect(mp.updateMany).not.toHaveBeenCalled();
    expect(mp.create).not.toHaveBeenCalled();
  });
});

describe("並行更新（CAS が replacement 作成の gate）", () => {
  it("更新条件は読んだ status との compare-and-swap", async () => {
    await run();
    const where = mp.updateMany.mock.calls[0][0].where;
    expect(where.status).toBe("PENDING_UZU_BOOKING");
    expect(where.status).not.toEqual({ not: "REVOKED" });
    expect(where).toMatchObject({ id: OLD_ID, oaId: OA, workId: WORK });
  });

  it("CAS 失敗後に REVOKED なら新リンクを作らない（二重 replacement 防止）", async () => {
    mp.findFirst.mockReset();
    mp.findFirst
      .mockResolvedValueOnce(oldLink())      // 対象取得
      .mockResolvedValueOnce(null)           // 先約なし
      .mockResolvedValueOnce({ status: "REVOKED" }); // CAS 後の再読込
    mp.updateMany.mockResolvedValue({ count: 0 });

    const r = await run();
    expect(r).toEqual({ kind: "already_revoked" });
    expect(mp.create).not.toHaveBeenCalled();
    expect(mp.activityCreate).not.toHaveBeenCalled();
  });

  it("revoke が先に勝った場合も replacement を作らない", async () => {
    // PR-B の「連携を解除」が先に REVOKED を確定させたケース
    mp.findFirst.mockReset();
    mp.findFirst
      .mockResolvedValueOnce(oldLink({ status: "LINKED" }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "REVOKED" });
    mp.updateMany.mockResolvedValue({ count: 0 });

    const r = await run();
    expect(r.kind).toBe("already_revoked");
    expect(mp.create).not.toHaveBeenCalled();
  });

  it("stale な status で旧リンクを REVOKED にしない（最新 status で CAS し直す）", async () => {
    mp.findFirst.mockReset();
    mp.findFirst
      .mockResolvedValueOnce(oldLink({ status: "PENDING_UZU_BOOKING" }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "LINKED" });
    mp.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 });

    const r = await run();
    expect(r).toMatchObject({ kind: "replaced", previousStatus: "LINKED" });
    expect(mp.updateMany.mock.calls[0][0].where.status).toBe("PENDING_UZU_BOOKING");
    expect(mp.updateMany.mock.calls[1][0].where.status).toBe("LINKED");
  });

  it("CAS 再試行は 1 回まで（無制限に retry しない）", async () => {
    mp.findFirst.mockReset();
    mp.findFirst
      .mockResolvedValueOnce(oldLink())
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ status: "LINKED" });
    mp.updateMany.mockResolvedValue({ count: 0 });

    const r = await run();
    expect(mp.updateMany).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ kind: "conflict", currentStatus: "LINKED" });
    expect(mp.create).not.toHaveBeenCalled();
  });

  it("CAS 失敗後に行が消えていれば not_found", async () => {
    mp.findFirst.mockReset();
    mp.findFirst
      .mockResolvedValueOnce(oldLink())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mp.updateMany.mockResolvedValue({ count: 0 });
    expect(await run()).toEqual({ kind: "not_found" });
  });

  it("DB error を競合として扱わず throw する", async () => {
    mp.updateMany.mockRejectedValue(new Error("db down"));
    await expect(run()).rejects.toThrow("db down");
    expect(mp.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe("監査ログ（PII を含めない）", () => {
  it("replacement 専用 action で旧新を内部 ID により関連付ける", async () => {
    await run();
    expect(mp.activityCreate).toHaveBeenCalledTimes(1);
    const data = mp.activityCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      action: "ticket_link_replace", targetType: "ticket_link", targetId: OLD_ID, actorUserId: "u-actor",
    });
    expect(JSON.parse(data.detail)).toEqual({
      fromStatus: "PENDING_UZU_BOOKING",
      toStatus: "REVOKED",
      replacementTicketLinkId: "tl-new",
      replacementStatus: "PENDING_UZU_BOOKING",
    });
  });

  it("単純解除（ticket_link_revoke）とは別 action", async () => {
    await run();
    expect(mp.activityCreate.mock.calls[0][0].data.action).not.toBe("ticket_link_revoke");
  });

  it("detail に予約番号 / コードネーム / LINE UID / 表示名を入れない", async () => {
    await run();
    const serialized = JSON.stringify(mp.activityCreate.mock.calls[0][0].data);
    for (const secret of ["999-888", "123-456", "アリス", "Uplayer", "たろう", "A", "B"]) {
      if (secret.length === 1) continue; // 1 文字は誤検知するので除く
      expect(serialized).not.toContain(secret);
    }
  });

  it("fromStatus は CAS で一致した直前 status（stale な初回読み取り値ではない）", async () => {
    mp.findFirst.mockReset();
    mp.findFirst
      .mockResolvedValueOnce(oldLink({ status: "PENDING_UZU_BOOKING" }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "LINKED" });
    mp.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 });

    await run();
    expect(JSON.parse(mp.activityCreate.mock.calls[0][0].data.detail).fromStatus).toBe("LINKED");
  });
});

describe("原子性（同一トランザクション）", () => {
  const atomicArgs = { ...INPUT, actorUserId: "u-actor", now: NOW };

  it("$transaction を 1 回開き、その中で解除・作成・ログを実行する", async () => {
    const r = await replaceTicketLink(atomicArgs);
    expect(r.kind).toBe("replaced");
    expect(mp.txCalls).toHaveBeenCalledTimes(1);
    expect(mp.updateMany).toHaveBeenCalledTimes(1);
    expect(mp.create).toHaveBeenCalledTimes(1);
    expect(mp.activityCreate).toHaveBeenCalledTimes(1);
  });

  it("解除 → 作成 → ログ の順で実行する", async () => {
    const order: string[] = [];
    mp.updateMany.mockImplementation(async () => { order.push("revoke"); return { count: 1 }; });
    mp.create.mockImplementation(async () => { order.push("create"); return { id: "tl-new" }; });
    mp.activityCreate.mockImplementation(async () => { order.push("log"); return {}; });
    await replaceTicketLink(atomicArgs);
    expect(order).toEqual(["revoke", "create", "log"]);
  });

  it("新 TicketLink の作成が失敗したら全体が失敗する（旧の解除だけ残さない）", async () => {
    mp.create.mockRejectedValue(new Error("create failed"));
    await expect(replaceTicketLink(atomicArgs)).rejects.toThrow("create failed");
    expect(mp.txCalls).toHaveBeenCalledTimes(1);
    expect(mp.activityCreate).not.toHaveBeenCalled();
  });

  it("members の作成失敗も全体を巻き戻す（ネスト create なので同じ失敗経路）", async () => {
    mp.create.mockRejectedValue(new Error("member create failed"));
    await expect(replaceTicketLink(atomicArgs)).rejects.toThrow("member create failed");
  });

  it("監査ログの作成が失敗したら replacement 全体が失敗する", async () => {
    mp.activityCreate.mockRejectedValue(new Error("log write failed"));
    await expect(replaceTicketLink(atomicArgs)).rejects.toThrow("log write failed");
  });

  it("部分 UNIQUE 違反(P2002)は業務結果へ変換し、旧を REVOKED のまま残さない", async () => {
    const { Prisma } = await import("@prisma/client");
    mp.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5.22.0" }),
    );
    const r = await replaceTicketLink(atomicArgs);
    // トランザクションごと rollback 済み = 旧リンクは元の状態に戻る
    expect(r).toEqual({ kind: "reservation_taken" });
    expect(mp.activityCreate).not.toHaveBeenCalled();
  });

  it("no_change ではトランザクション内で 1 件も write しない", async () => {
    const r = await replaceTicketLink({
      ...atomicArgs, ticketTypeKey: "solo", reservationNumberInput: "123-456", codeNames: ["アリス"],
    });
    expect(r).toEqual({ kind: "no_change" });
    expect(mp.updateMany).not.toHaveBeenCalled();
    expect(mp.create).not.toHaveBeenCalled();
    expect(mp.activityCreate).not.toHaveBeenCalled();
  });
});
