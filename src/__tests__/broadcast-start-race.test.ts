// src/__tests__/broadcast-start-race.test.ts
//
// start と PATCH の競合を **挙動として** 固定する。
//
// Production は ENABLE_BROADCAST_WORKER=true なので、sending になった瞬間に
// 自然 cron が送信対象にする。したがって不変条件は次の 2 つだけ:
//
//   Case A: PATCH が勝つ → updatedAt が進む → start の CAS が失敗 → draft のまま
//   Case B: start が勝つ → sending → 以降の PATCH は CAS 失敗（content は不変）
//
// 「sending になった後に PATCH が成功する」「検証した内容と違う content が sending になる」
// のどちらも起きないことをテストする。
//
// updateMany の where 一致判定を持つ最小の in-memory prisma を用意し、
// 実際の CAS セマンティクスで検証する（source-code assertion では race は固定できない）。

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── in-memory の Broadcast 1 行 + CAS セマンティクス ────────────────
type Row = {
  id: string; oaId: string; status: string; name: string;
  contentJson: unknown; targetType: string; segmentId: string | null; segmentWorkId: string | null;
  updatedAt: Date; startedAt: Date | null;
  recipientCount: number; successCount: number; failureCount: number;
};

const ID = "b1", OA = "oa1";
let row: Row;
let recipients: { broadcastId: string; lineUserId: string }[];
let clock: number;

/** where の各条件が row に一致するか（updatedAt は値比較）。 */
function matches(r: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    const cur = (r as unknown as Record<string, unknown>)[k];
    if (v instanceof Date) return cur instanceof Date && cur.getTime() === v.getTime();
    return cur === v;
  });
}

/** Prisma の @updatedAt 相当。更新が起きたら必ず revision が進む。 */
function bumpUpdatedAt() { clock += 1; row.updatedAt = new Date(clock); }

const mockPrisma = vi.hoisted(() => ({ prisma: {} as Record<string, never> }));
vi.mock("@/lib/prisma", () => mockPrisma);

const audience = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/broadcast/audience", () => ({
  resolveBroadcastAudience: audience.resolve,
  isSendableLineUserId: (v: unknown) => typeof v === "string" && /^U[0-9a-f]{32}$/i.test(v),
}));

const broadcastDelegate = {
  findFirst: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
    if (!matches(row, where)) return null;
    if (!select) return { ...row };
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(select)) out[k] = (row as unknown as Record<string, unknown>)[k];
    return out;
  },
  updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (!matches(row, where)) return { count: 0 };
    Object.assign(row, data);
    bumpUpdatedAt();
    return { count: 1 };
  },
};

const prismaImpl = {
  broadcast: broadcastDelegate,
  broadcastRecipient: {
    createMany: async ({ data }: { data: { broadcastId: string; lineUserId: string }[] }) => {
      recipients.push(...data);
      return { count: data.length };
    },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaImpl),
};

const ME = "U6475933f4f0fc8194bed3f24eb74b4ef";

beforeEach(async () => {
  clock = 1_000_000;
  row = {
    id: ID, oaId: OA, status: "draft", name: "n",
    contentJson: { kind: "text", text: "content A" },
    targetType: "all", segmentId: null, segmentWorkId: null,
    updatedAt: new Date(clock), startedAt: null,
    recipientCount: 0, successCount: 0, failureCount: 0,
  };
  recipients = [];
  Object.assign(mockPrisma.prisma, prismaImpl);
  audience.resolve.mockResolvedValue({ lineUserIds: [ME], count: 1 });
});

const startBroadcast = async (expectedUpdatedAt?: Date) => {
  const { startBroadcast: fn } = await import("@/lib/broadcast/service");
  return fn({ oaId: OA, broadcastId: ID, expectedUpdatedAt });
};

/** 管理画面の PATCH 相当（draft 限定 CAS の write）。 */
const patchContent = async (text: string) =>
  broadcastDelegate.updateMany({
    where: { id: ID, oaId: OA, status: "draft" },
    data:  { contentJson: { kind: "text", text } },
  });

// ══════════════════════════════════════════════════════════════════
describe("A. PATCH が read した後に start が勝つ", () => {
  it("PATCH の write は CAS で失敗し、content は書き換わらない", async () => {
    // PATCH が draft であることを read（この時点では draft）
    const seen = await broadcastDelegate.findFirst({ where: { id: ID, oaId: OA }, select: { status: true } });
    expect(seen).toMatchObject({ status: "draft" });

    // その隙に start が勝つ
    const r = await startBroadcast(row.updatedAt);
    expect(r).toMatchObject({ ok: true, recipientCount: 1 });
    expect(row.status).toBe("sending");

    // PATCH の write が来る → CAS 失敗
    const res = await patchContent("content B");
    expect(res.count).toBe(0);
    expect(row.contentJson).toEqual({ kind: "text", text: "content A" });
  });
});

// ══════════════════════════════════════════════════════════════════
describe("B. start が検証した後に PATCH が勝つ（TOCTOU の本丸）", () => {
  it("start は draft_changed で失敗し、sending にならず snapshot も作られない", async () => {
    // start が content A を read（= 検証したのはこの revision）
    const validated = await broadcastDelegate.findFirst({
      where: { id: ID, oaId: OA }, select: { status: true, contentJson: true, updatedAt: true },
    }) as { contentJson: unknown; updatedAt: Date };
    expect(validated.contentJson).toEqual({ kind: "text", text: "content A" });

    // 検証中に別タブが content B へ変更（PATCH は draft なので成功する）
    const patched = await patchContent("content B");
    expect(patched.count).toBe(1);

    // start の最終 CAS は検証した revision に pin されているので失敗する
    const r = await startBroadcast(validated.updatedAt);
    expect(r).toEqual({ ok: false, reason: "draft_changed" });

    // 不変条件: draft のまま / 宛先 snapshot 0 / 送信 0
    expect(row.status).toBe("draft");
    expect(row.startedAt).toBeNull();
    expect(row.recipientCount).toBe(0);
    expect(recipients).toHaveLength(0);
  });

  it("draft_changed は already_started と区別される", async () => {
    const rev = row.updatedAt;
    await patchContent("content B");
    const r = await startBroadcast(rev);
    expect(r).toMatchObject({ reason: "draft_changed" });
    expect(r).not.toHaveProperty("status"); // already_started ではない

    // 実際に開始済みのときは already_started
    const r2 = await startBroadcast(row.updatedAt);
    expect(r2).toMatchObject({ ok: true });
    const r3 = await startBroadcast(row.updatedAt);
    expect(r3).toMatchObject({ reason: "already_started", status: "sending" });
  });

  it("name / target の変更でも revision が進み start は失敗する", async () => {
    for (const data of [{ name: "renamed" }, { targetType: "segment", segmentId: "s1", segmentWorkId: "w1" }]) {
      // 各ケースを独立させるため状態を戻す
      row.status = "draft"; row.startedAt = null; row.recipientCount = 0; recipients = [];
      const rev = row.updatedAt;
      await broadcastDelegate.updateMany({ where: { id: ID, oaId: OA, status: "draft" }, data });
      const r = await startBroadcast(rev);
      expect(r).toEqual({ ok: false, reason: "draft_changed" });
      expect(row.status).toBe("draft");
      expect(recipients).toHaveLength(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════
describe("C. start が勝った後の PATCH", () => {
  it("sending になった後の PATCH は必ず失敗する（content immutable）", async () => {
    await startBroadcast(row.updatedAt);
    expect(row.status).toBe("sending");

    for (const s of ["sending", "sent", "partial_failed", "failed"]) {
      row.status = s;
      const res = await patchContent("content B");
      expect(res.count).toBe(0);
      expect(row.contentJson).toEqual({ kind: "text", text: "content A" });
    }
  });
});

// ══════════════════════════════════════════════════════════════════
describe("D/E. 競合が無い通常経路（回帰なし）", () => {
  it("D. 単独の start は従来どおり成功し snapshot を作る", async () => {
    const r = await startBroadcast(row.updatedAt);
    expect(r).toMatchObject({ ok: true, recipientCount: 1 });
    expect(row.status).toBe("sending");
    expect(row.recipientCount).toBe(1);
    expect(recipients).toEqual([{ broadcastId: ID, lineUserId: ME }]);
  });

  it("D2. revision を渡さない呼び出しも従来どおり動く（後方互換）", async () => {
    const r = await startBroadcast(undefined);
    expect(r).toMatchObject({ ok: true, recipientCount: 1 });
    expect(row.status).toBe("sending");
  });

  it("E. legacy text content でも挙動は変わらない", async () => {
    row.contentJson = { kind: "text", text: "【Whale Studio 配信E2E】\n返信は不要です。" };
    const r = await startBroadcast(row.updatedAt);
    expect(r).toMatchObject({ ok: true });
    expect(row.contentJson).toEqual({ kind: "text", text: "【Whale Studio 配信E2E】\n返信は不要です。" });
  });

  it("宛先 0 人なら draft のまま（既存挙動）", async () => {
    audience.resolve.mockResolvedValue({ lineUserIds: [], count: 0 });
    const r = await startBroadcast(row.updatedAt);
    expect(r).toEqual({ ok: false, reason: "empty_audience" });
    expect(row.status).toBe("draft");
    expect(recipients).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("F. image / flex でも検証した revision だけが sending になる", () => {
  const bubble = { type: "bubble", body: { type: "box", layout: "vertical", contents: [] } };

  it("Flex: 検証後に差し替えられたら start しない", async () => {
    row.contentJson = { kind: "flex", altText: "A", contents: bubble };
    const rev = row.updatedAt;

    // 検証中に別 Flex へ差し替え
    await broadcastDelegate.updateMany({
      where: { id: ID, oaId: OA, status: "draft" },
      data:  { contentJson: { kind: "flex", altText: "B", contents: bubble } },
    });

    const r = await startBroadcast(rev);
    expect(r).toEqual({ ok: false, reason: "draft_changed" });
    expect(row.status).toBe("draft");
    expect(recipients).toHaveLength(0);
  });

  it("画像: 検証した revision のまま start すれば、その content が sending になる", async () => {
    const content = {
      kind: "image",
      originalContentUrl: "https://res.cloudinary.com/x/image/upload/a.jpg",
      previewImageUrl:    "https://res.cloudinary.com/x/image/upload/w_240/a.jpg",
    };
    row.contentJson = content;
    const r = await startBroadcast(row.updatedAt);
    expect(r).toMatchObject({ ok: true });
    expect(row.status).toBe("sending");
    // sending になった content は、検証したものと同一
    expect(row.contentJson).toEqual(content);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("不変条件", () => {
  it("start の CAS は必ず status=draft を条件に含む（revision 単独では通らない）", async () => {
    row.status = "sending";
    const r = await startBroadcast(row.updatedAt);
    expect(r).toMatchObject({ reason: "already_started" });
    expect(recipients).toHaveLength(0);
  });

  it("PATCH の write は必ず oaId も条件に含む（他 OA から書き換えられない）", async () => {
    const res = await broadcastDelegate.updateMany({
      where: { id: ID, oaId: "other-oa", status: "draft" },
      data:  { contentJson: { kind: "text", text: "hijacked" } },
    });
    expect(res.count).toBe(0);
    expect(row.contentJson).toEqual({ kind: "text", text: "content A" });
  });
});
