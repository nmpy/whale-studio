// src/__tests__/broadcast-core.test.ts
//
// 配信メッセージ（Broadcast）のコアロジック。
// 既存「応答メッセージ」には一切依存しない（import もしない）ことを含めて検証する。

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── prisma / LINE を差し替える ─────────────────────────────────────
const { mockPrisma, mockPushToLine } = vi.hoisted(() => {
  const prisma = {
    work:                  { findMany: vi.fn(), findUnique: vi.fn() },
    userProgress:          { findMany: vi.fn() },
    userTracking:          { findMany: vi.fn() },
    analyticsExcludedUser: { findMany: vi.fn() },
    segment:               { findUnique: vi.fn() },
    broadcast:             { findFirst: vi.fn(), updateMany: vi.fn() },
    broadcastRecipient:    { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  };
  return { mockPrisma: prisma, mockPushToLine: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/line", () => ({ pushToLine: (...a: unknown[]) => mockPushToLine(...a) }));

import {
  resolveBroadcastAudience,
  countBroadcastAudience,
  isSendableLineUserId,
} from "@/lib/broadcast/audience";
import { parseBroadcastContent, toLineMessages, BROADCAST_TEXT_MAX } from "@/lib/broadcast/content";
import { startBroadcast, retryFailedRecipients, toBroadcastTarget } from "@/lib/broadcast/service";
import {
  processBroadcastChunk, finalStatusOf, retryKeyOf, isRetryableFailure,
  RETRY_KEY_TTL_MS, AMBIGUOUS_REASON,
} from "@/lib/broadcast/processor";

const U = (n: number) => "U" + String(n).padStart(32, "0");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma));
  mockPrisma.analyticsExcludedUser.findMany.mockResolvedValue([]);
  mockPrisma.userTracking.findMany.mockResolvedValue([]);
  mockPrisma.broadcastRecipient.createMany.mockResolvedValue({ count: 0 });
  // 既定では claim(pending → sending) に成功する。並行テストでは個別に上書きする。
  mockPrisma.broadcastRecipient.updateMany.mockResolvedValue({ count: 1 });
});

// ══════════════════════════════════════════════════════════════════
describe("isSendableLineUserId — テスト ID / 不正値を宛先にしない", () => {
  it("LINE の userId 形式だけを許可する", () => {
    expect(isSendableLineUserId(U(1))).toBe(true);
    expect(isSendableLineUserId(U(1).toUpperCase())).toBe(true);
  });
  it("テスト用の任意 ID・空・null・非文字列を弾く", () => {
    for (const v of ["test-user", "", "   ", "U123", null, undefined, 123, {}]) {
      expect(isSendableLineUserId(v)).toBe(false);
    }
  });
});

describe("resolveBroadcastAudience — 全体", () => {
  it("OA 配下の Work 経由でしか UserProgress を引かない（OA isolation）", async () => {
    mockPrisma.work.findMany.mockResolvedValue([{ id: "w1" }, { id: "w2" }]);
    mockPrisma.userProgress.findMany.mockResolvedValue([{ lineUserId: U(1) }]);

    await resolveBroadcastAudience("oa1", { type: "all" });

    expect(mockPrisma.work.findMany).toHaveBeenCalledWith({ where: { oaId: "oa1" }, select: { id: true } });
    const where = mockPrisma.userProgress.findMany.mock.calls[0][0].where;
    expect(where.workId).toEqual({ in: ["w1", "w2"] });
    expect(where.isPreview).toBe(false); // プレビュー実行者に配信しない
    expect(mockPrisma.userTracking.findMany).toHaveBeenCalledWith({ where: { oaId: "oa1" }, select: { lineUserId: true } });
  });

  it("UserProgress と UserTracking を統合し、重複を除去する", async () => {
    mockPrisma.work.findMany.mockResolvedValue([{ id: "w1" }]);
    mockPrisma.userProgress.findMany.mockResolvedValue([{ lineUserId: U(1) }, { lineUserId: U(2) }]);
    mockPrisma.userTracking.findMany.mockResolvedValue([{ lineUserId: U(2) }, { lineUserId: U(3) }]);

    const r = await resolveBroadcastAudience("oa1", { type: "all" });
    expect(r.lineUserIds).toEqual([U(1), U(2), U(3)]);
    expect(r.count).toBe(3);
  });

  it("テスト ID / 空 / null を除外する", async () => {
    mockPrisma.work.findMany.mockResolvedValue([{ id: "w1" }]);
    mockPrisma.userProgress.findMany.mockResolvedValue([
      { lineUserId: U(1) }, { lineUserId: "test-user" }, { lineUserId: "" }, { lineUserId: null },
    ]);
    const r = await resolveBroadcastAudience("oa1", { type: "all" });
    expect(r.lineUserIds).toEqual([U(1)]);
  });

  it("analytics_excluded_users は宛先から外す", async () => {
    mockPrisma.work.findMany.mockResolvedValue([{ id: "w1" }]);
    mockPrisma.userProgress.findMany.mockResolvedValue([{ lineUserId: U(1) }, { lineUserId: U(2) }]);
    mockPrisma.analyticsExcludedUser.findMany.mockResolvedValue([{ lineUserId: U(2) }]);
    const r = await resolveBroadcastAudience("oa1", { type: "all" });
    expect(r.lineUserIds).toEqual([U(1)]);
  });

  it("Work が 1 件も無い OA では UserProgress を引かない", async () => {
    mockPrisma.work.findMany.mockResolvedValue([]);
    const r = await resolveBroadcastAudience("oa1", { type: "all" });
    expect(mockPrisma.userProgress.findMany).not.toHaveBeenCalled();
    expect(r.count).toBe(0);
  });
});

describe("resolveBroadcastAudience — セグメント", () => {
  const seg = (over: Record<string, unknown> = {}) =>
    ({ id: "s1", oaId: "oa1", filterType: "phase", phaseId: "p1", ...over });

  it("他 OA の Segment を指定しても解決しない", async () => {
    mockPrisma.segment.findUnique.mockResolvedValue(seg({ oaId: "OTHER" }));
    mockPrisma.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    const r = await resolveBroadcastAudience("oa1", { type: "segment", segmentId: "s1", workId: "w1" });
    expect(r.count).toBe(0);
    expect(mockPrisma.userProgress.findMany).not.toHaveBeenCalled();
  });

  it("他 OA の Work を指定しても解決しない", async () => {
    mockPrisma.segment.findUnique.mockResolvedValue(seg());
    mockPrisma.work.findUnique.mockResolvedValue({ id: "w1", oaId: "OTHER" });
    const r = await resolveBroadcastAudience("oa1", { type: "segment", segmentId: "s1", workId: "w1" });
    expect(r.count).toBe(0);
  });

  it("phase セグメントは currentPhaseId で絞る", async () => {
    mockPrisma.segment.findUnique.mockResolvedValue(seg());
    mockPrisma.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mockPrisma.userProgress.findMany.mockResolvedValue([{ lineUserId: U(1) }]);
    await resolveBroadcastAudience("oa1", { type: "segment", segmentId: "s1", workId: "w1" });
    const where = mockPrisma.userProgress.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ workId: "w1", isPreview: false, currentPhaseId: "p1" });
  });

  it("phaseId 未設定の phase セグメントは「全員送信」に化けない", async () => {
    mockPrisma.segment.findUnique.mockResolvedValue(seg({ phaseId: null }));
    mockPrisma.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    const r = await resolveBroadcastAudience("oa1", { type: "segment", segmentId: "s1", workId: "w1" });
    expect(r.count).toBe(0);
    expect(mockPrisma.userProgress.findMany).not.toHaveBeenCalled();
  });

  it("inactive_7d は未クリア かつ 7日以上未接触で絞る", async () => {
    mockPrisma.segment.findUnique.mockResolvedValue(seg({ filterType: "inactive_7d", phaseId: null }));
    mockPrisma.work.findUnique.mockResolvedValue({ id: "w1", oaId: "oa1" });
    mockPrisma.userProgress.findMany.mockResolvedValue([]);
    await resolveBroadcastAudience("oa1", { type: "segment", segmentId: "s1", workId: "w1" });
    const where = mockPrisma.userProgress.findMany.mock.calls[0][0].where;
    expect(where.reachedEnding).toBe(false);
    expect(where.lastInteractedAt).toHaveProperty("lt");
  });

  it("countBroadcastAudience は件数だけ返す", async () => {
    mockPrisma.work.findMany.mockResolvedValue([{ id: "w1" }]);
    mockPrisma.userProgress.findMany.mockResolvedValue([{ lineUserId: U(1) }, { lineUserId: U(2) }]);
    expect(await countBroadcastAudience("oa1", { type: "all" })).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("parseBroadcastContent", () => {
  it("正しいテキストを受理する", () => {
    expect(parseBroadcastContent({ kind: "text", text: "こんにちは" })).toEqual({ kind: "text", text: "こんにちは" });
  });
  it("空・空白のみ・未知 kind・非文字列・上限超過を弾く", () => {
    expect(parseBroadcastContent({ kind: "text", text: "" })).toBeNull();
    expect(parseBroadcastContent({ kind: "text", text: "   " })).toBeNull();
    expect(parseBroadcastContent({ kind: "flex", text: "x" })).toBeNull();
    expect(parseBroadcastContent({ kind: "text", text: 1 })).toBeNull();
    expect(parseBroadcastContent({ kind: "text", text: "a".repeat(BROADCAST_TEXT_MAX + 1) })).toBeNull();
    expect(parseBroadcastContent(null)).toBeNull();
    expect(parseBroadcastContent([])).toBeNull();
  });
  it("LINE message 形式に変換できる", () => {
    expect(toLineMessages({ kind: "text", text: "やあ" })).toEqual([{ type: "text", text: "やあ" }]);
  });
});

describe("toBroadcastTarget", () => {
  it("all / segment を復元し、欠損した segment 指定は null", () => {
    expect(toBroadcastTarget({ targetType: "all", segmentId: null, segmentWorkId: null })).toEqual({ type: "all" });
    expect(toBroadcastTarget({ targetType: "segment", segmentId: "s1", segmentWorkId: "w1" }))
      .toEqual({ type: "segment", segmentId: "s1", workId: "w1" });
    expect(toBroadcastTarget({ targetType: "segment", segmentId: "s1", segmentWorkId: null })).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
describe("startBroadcast — 二重配信防止", () => {
  const draft = { id: "b1", status: "draft", targetType: "all", segmentId: null, segmentWorkId: null };

  beforeEach(() => {
    mockPrisma.work.findMany.mockResolvedValue([{ id: "w1" }]);
    mockPrisma.userProgress.findMany.mockResolvedValue([{ lineUserId: U(1) }, { lineUserId: U(2) }]);
  });

  it("draft のときだけ開始し、宛先を snapshot する", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(draft);
    mockPrisma.broadcast.updateMany.mockResolvedValue({ count: 1 });

    const r = await startBroadcast({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: true, recipientCount: 2 });

    // CAS: where に status:"draft" が入っていること
    expect(mockPrisma.broadcast.updateMany.mock.calls[0][0].where)
      .toEqual({ id: "b1", oaId: "oa1", status: "draft" });
    // snapshot
    expect(mockPrisma.broadcastRecipient.createMany).toHaveBeenCalledWith({
      data: [{ broadcastId: "b1", lineUserId: U(1) }, { broadcastId: "b1", lineUserId: U(2) }],
      skipDuplicates: true,
    });
  });

  it("既に sending なら何もしない（ダブルクリック / reload / retry）", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue({ ...draft, status: "sending" });
    const r = await startBroadcast({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: false, reason: "already_started", status: "sending" });
    expect(mockPrisma.broadcast.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.broadcastRecipient.createMany).not.toHaveBeenCalled();
  });

  it("並行実行で CAS に負けたら snapshot も作らない", async () => {
    mockPrisma.broadcast.findFirst
      .mockResolvedValueOnce(draft)                      // 1 回目の読み取りでは draft
      .mockResolvedValueOnce({ status: "sending" });     // CAS 失敗後の再読み取り
    mockPrisma.broadcast.updateMany.mockResolvedValue({ count: 0 }); // 他リクエストが先に確定

    const r = await startBroadcast({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: false, reason: "already_started", status: "sending" });
    expect(mockPrisma.broadcastRecipient.createMany).not.toHaveBeenCalled();
  });

  it("他 OA の配信は開始できない", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(null);
    const r = await startBroadcast({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: false, reason: "not_found" });
    expect(mockPrisma.broadcast.findFirst.mock.calls[0][0].where).toMatchObject({ oaId: "oa1" });
  });

  it("宛先 0 件なら開始しない（sending のまま止まる状態を作らない）", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(draft);
    mockPrisma.userProgress.findMany.mockResolvedValue([]);
    const r = await startBroadcast({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: false, reason: "empty_audience" });
    expect(mockPrisma.broadcast.updateMany).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════
describe("processBroadcastChunk", () => {
  const sending = {
    id: "b1", status: "sending",
    contentJson: { kind: "text", text: "やあ" },
    oa: { channelAccessToken: "tok" },
  };
  const counts = (sent: number, failed: number, pending: number, skippedRows = 0) => {
    mockPrisma.broadcastRecipient.count
      .mockResolvedValueOnce(sent).mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(skippedRows).mockResolvedValueOnce(pending);
  };

  it("全件成功なら sent で完了する", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([{ id: "r1", lineUserId: U(1) }]);
    mockPushToLine.mockResolvedValue({ ok: true, status: 200 });
    counts(1, 0, 0);

    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ ok: true, processed: 1, sent: 1, failed: 0, hasMore: false, status: "sent" });
    expect(mockPushToLine).toHaveBeenCalledWith(
      U(1), [{ type: "text", text: "やあ" }], "tok", { retryKey: "r1" },
    );
  });

  it("一部失敗は partial_failed。宛先ごとに結果を記録する", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([
      { id: "r1", lineUserId: U(1) }, { id: "r2", lineUserId: U(2) },
    ]);
    mockPushToLine
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 400 });
    counts(1, 1, 0);

    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ sent: 1, failed: 1, status: "partial_failed" });
    const updates = mockPrisma.broadcastRecipient.update.mock.calls.map((c) => c[0].data.status);
    expect(updates).toEqual(["sent", "failed"]);
    // エラーメッセージに本文・PII を含めない
    const failedData = mockPrisma.broadcastRecipient.update.mock.calls[1][0].data;
    expect(failedData.errorMessage).toBe("LINE push failed (HTTP 400)");
    expect(JSON.stringify(failedData)).not.toContain("やあ");
  });

  it("全件失敗は failed", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([{ id: "r1", lineUserId: U(1) }]);
    mockPushToLine.mockResolvedValue({ ok: false, status: 500 });
    counts(0, 1, 0);
    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ status: "failed" });
  });

  it("ネットワークエラー（status なし）でも例外にせず failed として記録する", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([{ id: "r1", lineUserId: U(1) }]);
    mockPushToLine.mockResolvedValue({ ok: false });
    counts(0, 1, 0);
    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ failed: 1, status: "failed" });
    expect(mockPrisma.broadcastRecipient.update.mock.calls[0][0].data.errorMessage).toBe("LINE push failed");
  });

  it("残りがあれば sending のまま hasMore=true（完了扱いにしない）", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([{ id: "r1", lineUserId: U(1) }]);
    mockPushToLine.mockResolvedValue({ ok: true, status: 200 });
    counts(1, 0, 5);
    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ hasMore: true, status: "sending" });
    expect(mockPrisma.broadcast.updateMany.mock.calls[0][0].data.completedAt).toBeUndefined();
  });

  it("chunkSize 件だけ取り出す", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([]);
    counts(0, 0, 0);
    await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1", chunkSize: 7 });
    expect(mockPrisma.broadcastRecipient.findMany.mock.calls[0][0]).toMatchObject({
      where: { broadcastId: "b1", status: "pending" }, take: 7,
    });
  });

  it("sending でない配信は処理しない（二重 process 防止）", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue({ ...sending, status: "sent" });
    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: false, reason: "not_sending" });
    expect(mockPushToLine).not.toHaveBeenCalled();
  });

  it("本文が壊れていたら 1 通も送らない", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue({ ...sending, contentJson: { kind: "text", text: "" } });
    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: false, reason: "invalid_content" });
    expect(mockPushToLine).not.toHaveBeenCalled();
  });

  it("channelAccessToken が無ければ送らない", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue({ ...sending, oa: { channelAccessToken: "" } });
    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toEqual({ ok: false, reason: "no_token" });
    expect(mockPushToLine).not.toHaveBeenCalled();
  });

  it("finalStatusOf の判定", () => {
    expect(finalStatusOf(3, 0)).toBe("sent");
    expect(finalStatusOf(0, 3)).toBe("failed");
    expect(finalStatusOf(2, 1)).toBe("partial_failed");
  });

  // ── ケース C: process が同時に 2 回呼ばれても同じ宛先に二重送信しない ──
  it("push の前に pending → sending を CAS で claim する", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([{ id: "r1", lineUserId: U(1) }]);
    mockPushToLine.mockResolvedValue({ ok: true, status: 200 });
    counts(1, 0, 0);

    await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });

    // claim は push より前に、status:"pending" を条件にして実行されていること
    const claimCall = mockPrisma.broadcastRecipient.updateMany.mock.calls
      .find((c) => c[0]?.data?.status === "sending" && c[0]?.where?.status === "pending");
    expect(claimCall).toBeDefined();
    expect(claimCall![0].where).toEqual({ id: "r1", status: "pending" });
    expect(mockPrisma.broadcastRecipient.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mockPushToLine.mock.invocationCallOrder[0]);
  });

  it("claim に負けた宛先には push しない（並行 process の二重送信防止）", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([
      { id: "r1", lineUserId: U(1) }, { id: "r2", lineUserId: U(2) },
    ]);
    // r1 は他 process が先に取った（count=0）。r2 は自分が取れた（count=1）。
    mockPrisma.broadcastRecipient.updateMany
      .mockResolvedValueOnce({ count: 0 })   // (1) 滞留 claim の回収
      .mockResolvedValueOnce({ count: 0 })   // (2) retry key 失効行の停止
      .mockResolvedValueOnce({ count: 0 })   // r1 の claim → 失敗（他 process が先に取った）
      .mockResolvedValueOnce({ count: 1 });  // r2 の claim → 成功
    mockPushToLine.mockResolvedValue({ ok: true, status: 200 });
    counts(1, 0, 0);

    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });

    expect(mockPushToLine).toHaveBeenCalledTimes(1);
    expect(mockPushToLine).toHaveBeenCalledWith(U(2), expect.anything(), "tok", { retryKey: "r2" });
    expect(r).toMatchObject({ skipped: 1, sent: 1, processed: 1 });
  });

  it("in-flight(sending) が残っている間は完了扱いにしない", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([]);
    counts(1, 0, 3); // remaining は pending + sending の合算
    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ hasMore: true, status: "sending" });
    // 残件のカウントに sending を含めていること
    const remainingCall = mockPrisma.broadcastRecipient.count.mock.calls[3][0];
    expect(remainingCall.where.status).toEqual({ in: ["pending", "sending"] });
  });

  it("中断した claim（sending のまま古い行）は pending に戻して再開できる", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([]);
    counts(0, 0, 0);
    await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });

    const reclaim = mockPrisma.broadcastRecipient.updateMany.mock.calls[0][0];
    expect(reclaim.where).toMatchObject({ broadcastId: "b1", status: "sending" });
    expect(reclaim.where.updatedAt).toHaveProperty("lt");  // 古い行だけが対象
    expect(reclaim.where.createdAt).toHaveProperty("gte"); // retry key がまだ有効なものだけ
    expect(reclaim.data).toEqual({ status: "pending" });
  });

  // ── ケース A / B: reload・離脱後に残りだけを処理する ──
  it("再開時は pending だけを取り出す（sent には再送しない）", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([{ id: "r51", lineUserId: U(51) }]);
    mockPushToLine.mockResolvedValue({ ok: true, status: 200 });
    counts(51, 0, 0);

    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });

    // 取得条件が status:"pending" のみ = 送信済みは母集合に入らない
    expect(mockPrisma.broadcastRecipient.findMany.mock.calls[0][0].where)
      .toEqual({ broadcastId: "b1", status: "pending" });
    expect(mockPushToLine).toHaveBeenCalledTimes(1);
    expect(mockPushToLine).toHaveBeenCalledWith(U(51), expect.anything(), "tok", { retryKey: "r51" });
    expect(r).toMatchObject({ sent: 1, hasMore: false, status: "sent" });
  });

  // ══ X-Line-Retry-Key（LINE 受理後の crash による二重配信の防止）══
  // 公式仕様: 値は hexadecimal UUID / 初回 request から付けないと再試行不可 /
  //           既受理なら 409 Conflict / 有効期間は初回から 24 時間。

  // A. 初回 push から retry key が付く
  it("A. 最初の push から X-Line-Retry-Key を付ける", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([{ id: "11111111-2222-4333-8444-555555555555", lineUserId: U(1) }]);
    mockPushToLine.mockResolvedValue({ ok: true, status: 200 });
    counts(1, 0, 0);

    await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });

    expect(mockPushToLine).toHaveBeenCalledWith(
      U(1), expect.anything(), "tok",
      { retryKey: "11111111-2222-4333-8444-555555555555" },
    );
  });

  // B. 同じ宛先なら再送でも同じ retry key
  it("B. 同じ BroadcastRecipient への再 push は同じ retry key になる", async () => {
    const rid = "11111111-2222-4333-8444-555555555555";
    expect(retryKeyOf(rid)).toBe(rid);
    expect(retryKeyOf(rid)).toBe(retryKeyOf(rid)); // 何度呼んでも不変（乱数・時刻に依存しない）
  });

  // C. 別宛先は別 retry key
  it("C. 別の BroadcastRecipient は別の retry key になる", async () => {
    expect(retryKeyOf("aaaaaaaa-1111-4111-8111-111111111111"))
      .not.toBe(retryKeyOf("bbbbbbbb-2222-4222-8222-222222222222"));
  });

  // D. LINE 受理 → DB 更新前 crash → stale recovery → 同じ key → 409 → sent 確定
  it("D. LINE 受理後に落ちた宛先は、再 push の 409 で sent に確定し failed にしない", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    // stale recovery で pending に戻った同じ行
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([{ id: "r1", lineUserId: U(1) }]);
    mockPushToLine.mockResolvedValue({ ok: false, status: 409 }); // 既に受理済み
    counts(1, 0, 0);

    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });

    // 409 は成功側に数える（失敗にしない）
    expect(r).toMatchObject({ sent: 1, failed: 0, status: "sent" });
    const upd = mockPrisma.broadcastRecipient.update.mock.calls[0][0].data;
    expect(upd.status).toBe("sent");
    expect(upd.httpStatus).toBe(409);
    expect(upd.sentAt).toBeInstanceOf(Date);
    // 同じ retry key で送っていること
    expect(mockPushToLine).toHaveBeenCalledWith(U(1), expect.anything(), "tok", { retryKey: "r1" });
  });

  // F. 24 時間を超えた ambiguous な sending は自動 push しない
  it("F. retry key 失効後の sending は pending に戻さず skipped にする（自動再 push しない）", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([]);
    mockPrisma.broadcastRecipient.updateMany
      .mockResolvedValueOnce({ count: 0 })   // (1) 有効期間内の回収
      .mockResolvedValueOnce({ count: 2 });  // (2) 失効した ambiguous 行
    counts(0, 0, 0, 2);

    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });

    const expire = mockPrisma.broadcastRecipient.updateMany.mock.calls[1][0];
    expect(expire.where).toMatchObject({ broadcastId: "b1", status: "sending" });
    expect(expire.where.createdAt).toHaveProperty("lt"); // 24h より前
    expect(expire.data).toEqual({ status: "skipped", errorMessage: AMBIGUOUS_REASON });
    // 1 通も送らない
    expect(mockPushToLine).not.toHaveBeenCalled();
    // 全件成功には倒さない（成功 0 件なので failed。運用者の確認を促す）
    expect(r).toMatchObject({ status: "failed" });
  });

  it("F-2. retry key の有効期間は LINE 仕様どおり 24 時間", () => {
    expect(RETRY_KEY_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("F-3. skipped があるだけでも「全件成功」にはしない", () => {
    expect(finalStatusOf(3, 0, 0)).toBe("sent");
    expect(finalStatusOf(3, 0, 1)).toBe("partial_failed");
    expect(finalStatusOf(0, 0, 2)).toBe("failed");
  });

  it("全件 sent 済みなら再実行しても 1 通も送らない", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(sending);
    mockPrisma.broadcastRecipient.findMany.mockResolvedValue([]); // pending なし
    counts(100, 0, 0);
    const r = await processBroadcastChunk({ oaId: "oa1", broadcastId: "b1" });
    expect(mockPushToLine).not.toHaveBeenCalled();
    expect(r).toMatchObject({ processed: 0, sent: 0, hasMore: false, status: "sent" });
  });
});

// ══════════════════════════════════════════════════════════════════
describe("retryFailedRecipients — LINE 公式 retry 方針に沿った再送", () => {
  // LINE 公式: 再試行してよいのは timeout / 5xx のみ。
  //            2xx・409・その他 4xx は "Don't retry. Retries don't change the result."
  const setup = (over: Record<string, unknown> = {}) => {
    mockPrisma.broadcast.findFirst.mockResolvedValue({ id: "b1", status: "partial_failed", ...over });
    mockPrisma.broadcast.updateMany.mockResolvedValue({ count: 1 });
  };
  /** updateMany: (1)失効→skipped (2)retryable→pending、count: non-retryable 件数 */
  const mockRetryCalls = (expired: number, requeued: number, nonRetryable: number) => {
    mockPrisma.broadcastRecipient.updateMany
      .mockResolvedValueOnce({ count: expired })
      .mockResolvedValueOnce({ count: requeued });
    mockPrisma.broadcastRecipient.count.mockResolvedValueOnce(nonRetryable);
  };

  it("再送対象の where は timeout(status null) と 5xx のみ", async () => {
    setup(); mockRetryCalls(0, 2, 0);
    await retryFailedRecipients({ oaId: "oa1", broadcastId: "b1" });

    const requeue = mockPrisma.broadcastRecipient.updateMany.mock.calls[1][0];
    expect(requeue.where.status).toBe("failed");
    expect(requeue.where.OR).toEqual([{ httpStatus: null }, { httpStatus: { gte: 500 } }]);
    expect(requeue.data).toMatchObject({ status: "pending" });
  });

  // A / B: timeout・5xx は 24h 以内なら再送対象
  it("A/B. timeout(null) と 5xx は retryable と判定される", () => {
    expect(isRetryableFailure(null)).toBe(true);       // A: network timeout
    expect(isRetryableFailure(undefined)).toBe(true);
    expect(isRetryableFailure(500)).toBe(true);        // B: LINE server error
    expect(isRetryableFailure(502)).toBe(true);
    expect(isRetryableFailure(503)).toBe(true);
  });

  // D / E / F: 4xx は再送しない
  it("D/E/F. 400 / 401 / 403 / 404 / 429 は non-retryable", () => {
    for (const st of [400, 401, 403, 404, 429]) {
      expect(isRetryableFailure(st)).toBe(false);
    }
  });

  it("G. 409 は non-retryable（process 側で sent に確定するのでそもそも対象外）", () => {
    expect(isRetryableFailure(409)).toBe(false);
  });

  it("D/E/F. 4xx は pending に戻らず failed のまま残る", async () => {
    setup();
    // 失効 0 / retryable 0（= 4xx しか無い）/ non-retryable 3
    mockRetryCalls(0, 0, 3);

    const r = await retryFailedRecipients({ oaId: "oa1", broadcastId: "b1" });

    // requeued 0 のときは配信 status を sending に戻さない（再送しない）
    expect(mockPrisma.broadcast.updateMany).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, requeued: 0, nonRetryable: 3 });
    // skipped 化もしない（4xx は delivery unknown ではない）
    const expire = mockPrisma.broadcastRecipient.updateMany.mock.calls[0][0];
    expect(expire.where.OR).toEqual([{ httpStatus: null }, { httpStatus: { gte: 500 } }]);
  });

  // C: timeout / 5xx でも 24h 超過は skipped
  it("C. timeout / 5xx でも retry key 失効なら skipped にして再送しない", async () => {
    setup(); mockRetryCalls(3, 1, 0);

    const r = await retryFailedRecipients({ oaId: "oa1", broadcastId: "b1" });

    const expire = mockPrisma.broadcastRecipient.updateMany.mock.calls[0][0];
    expect(expire.where.createdAt).toHaveProperty("lt");
    expect(expire.where.OR).toEqual([{ httpStatus: null }, { httpStatus: { gte: 500 } }]);
    expect(expire.data).toEqual({ status: "skipped", errorMessage: AMBIGUOUS_REASON });
    expect(r).toMatchObject({ requeued: 1, skipped: 3 });
  });

  // H / I: sent / skipped には触れない
  it("H/I. sent と skipped は再送対象に含まれない", async () => {
    setup(); mockRetryCalls(0, 2, 0);
    await retryFailedRecipients({ oaId: "oa1", broadcastId: "b1" });
    for (const call of mockPrisma.broadcastRecipient.updateMany.mock.calls) {
      expect(call[0].where.status).toBe("failed"); // sent / skipped を対象にしない
    }
  });

  it("再送後も non-retryable 分は failureCount として残る（0 リセットしない）", async () => {
    setup(); mockRetryCalls(0, 2, 3);
    await retryFailedRecipients({ oaId: "oa1", broadcastId: "b1" });
    expect(mockPrisma.broadcast.updateMany.mock.calls[0][0].data)
      .toMatchObject({ status: "sending", failureCount: 3 });
  });

  it("送信中の配信は再送できない（worker と競合させない）", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue({ id: "b1", status: "sending" });
    const r = await retryFailedRecipients({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ ok: false, reason: "not_retryable" });
    expect(mockPrisma.broadcastRecipient.updateMany).not.toHaveBeenCalled();
  });

  it("他 OA の配信は再送できない", async () => {
    mockPrisma.broadcast.findFirst.mockResolvedValue(null);
    const r = await retryFailedRecipients({ oaId: "oa1", broadcastId: "b1" });
    expect(r).toMatchObject({ ok: false, reason: "not_found" });
  });
});

