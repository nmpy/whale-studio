/**
 * src/__tests__/quick-reply-postback.test.ts
 *
 * 通常クイックリプライ（QR）の送信先解決を「表示ラベル」ではなく postback の
 * sourceMessageId + qrIndex で行う修正の regression。
 *
 * バグ: 同一フェーズに同名 QR（「次へ」等）を持つメッセージが複数あると、メッセージ B 下の
 *       「次へ」をタップしても先頭メッセージ A の「次へ」へ解決され、A の送信先（= B）が再送されて
 *       先に進めない（matchQrItem のラベル/テキスト先頭一致）。
 * 修正後: sourceMessageId + qrIndex で「タップ元の QR」の送信先へ解決される（ラベル非依存）。
 */
import { describe, it, expect } from "vitest";
import {
  QUICK_REPLY_POSTBACK_ACTION,
  buildQuickReplyPostbackData, parseQuickReplyPostback,
  quickReplyItemHasDestination, resolveQuickReplyItem,
  type QuickReplyPostbackMessageRow,
} from "@/lib/quick-reply-postback";
import { buildQuickReplyFromItems } from "@/lib/line";
import { resolveQrBranchDelivery } from "@/lib/qr-branch";
import type { QuickReplyItem } from "@/types";

// 「次へ」QR（送信先 = target_message_id）を 1 件持つメッセージ行を作る。
const nextQrRow = (targetMessageId: string): QuickReplyPostbackMessageRow => ({
  kind: "normal", hintMode: "always", incorrectQuickReplies: null,
  quickReplies: JSON.stringify([
    { action: "text", label: "次へ", target_type: "message", target_message_id: targetMessageId },
  ]),
});

describe("postback data build/parse", () => {
  const MID = "0123abcd-4567-89ef-0123-456789abcdef";
  it("build→parse 往復で sourceMessageId / qrIndex が一致", () => {
    expect(parseQuickReplyPostback(buildQuickReplyPostbackData(MID, 0))).toEqual({ sourceMessageId: MID, qrIndex: 0 });
    expect(parseQuickReplyPostback(buildQuickReplyPostbackData(MID, 4))).toEqual({ sourceMessageId: MID, qrIndex: 4 });
  });
  it("action 識別子を含み、LINE postback data 上限300に十分収まる", () => {
    const d = buildQuickReplyPostbackData(MID, 2);
    expect(d).toContain(`action=${QUICK_REPLY_POSTBACK_ACTION}`);
    expect(d).toContain(`sourceMessageId=${MID}`);
    expect(d).toContain("qrIndex=2");
    expect(d.length).toBeLessThan(300);
  });
  it("別 action / sourceMessageId 空 / qrIndex 不正 → null（legacy text fallback へ）", () => {
    expect(parseQuickReplyPostback("action=resume_work&workId=x")).toBeNull();
    expect(parseQuickReplyPostback("action=puzzle_hint&messageId=m&hintIndex=0")).toBeNull();
    expect(parseQuickReplyPostback(`action=${QUICK_REPLY_POSTBACK_ACTION}&sourceMessageId=&qrIndex=0`)).toBeNull();
    expect(parseQuickReplyPostback(`action=${QUICK_REPLY_POSTBACK_ACTION}&sourceMessageId=m&qrIndex=`)).toBeNull();
    expect(parseQuickReplyPostback(`action=${QUICK_REPLY_POSTBACK_ACTION}&sourceMessageId=m&qrIndex=-1`)).toBeNull();
    expect(parseQuickReplyPostback(`action=${QUICK_REPLY_POSTBACK_ACTION}&sourceMessageId=m&qrIndex=abc`)).toBeNull();
    // 完全な空文字 / ゴミも null
    expect(parseQuickReplyPostback("")).toBeNull();
    expect(parseQuickReplyPostback("not even a query")).toBeNull();
  });
});

describe("quickReplyItemHasDestination: 送信先を持つ QR だけ true", () => {
  it("target_message_id / response_message_id / target_phase_id → true", () => {
    expect(quickReplyItemHasDestination({ action: "text", label: "次へ", target_message_id: "m" })).toBe(true);
    expect(quickReplyItemHasDestination({ action: "next", label: "次へ", response_message_id: "r" })).toBe(true);
    expect(quickReplyItemHasDestination({ action: "custom", label: "次へ", target_phase_id: "p" })).toBe(true);
  });
  it("送信先なしの純フリーテキスト QR → false（message action のまま keyword/transition へ）", () => {
    expect(quickReplyItemHasDestination({ action: "text", label: "次へ" })).toBe(false);
    expect(quickReplyItemHasDestination({ action: "url", label: "外部", value: "https://x", target_message_id: "m" } as QuickReplyItem)).toBe(false);
    expect(quickReplyItemHasDestination({ action: "hint", label: "ヒント", target_message_id: "m" } as QuickReplyItem)).toBe(false);
    expect(quickReplyItemHasDestination(null)).toBe(false);
    expect(quickReplyItemHasDestination(undefined)).toBe(false);
  });
});

describe("buildQuickReplyFromItems: 送信先を持つ通常 QR が postback（quick_reply）になる", () => {
  it("qrPostbackSourceMessageId 指定時: target 付き text は postback（sourceMessageId + qrIndex）", () => {
    const items = JSON.parse(nextQrRow("msg-B").quickReplies!) as QuickReplyItem[];
    const qr = buildQuickReplyFromItems(items, { qrPostbackSourceMessageId: "msg-A" })!;
    expect(qr.items[0].action.type).toBe("postback");
    const data = (qr.items[0].action as { data: string }).data;
    expect(parseQuickReplyPostback(data)).toEqual({ sourceMessageId: "msg-A", qrIndex: 0 });
    // displayText / label は維持（LINE 上は「次へ」を送ったように見える＝見た目不変）
    expect((qr.items[0].action as { displayText?: string }).displayText).toBe("次へ");
    expect((qr.items[0].action as { label?: string }).label).toBe("次へ");
  });

  it("displayText は value 優先（送信テキスト相当）", () => {
    const items = [{ action: "text", label: "次へ", value: "go", target_message_id: "B" }] as QuickReplyItem[];
    const qr = buildQuickReplyFromItems(items, { qrPostbackSourceMessageId: "A" })!;
    expect((qr.items[0].action as { displayText?: string }).displayText).toBe("go");
  });

  it("送信先を持たない QR は message action のまま（既存互換・keyword/transition へ）", () => {
    const items = [{ action: "text", label: "次へ" }] as QuickReplyItem[];
    const qr = buildQuickReplyFromItems(items, { qrPostbackSourceMessageId: "A" })!;
    expect(qr.items[0].action.type).toBe("message");
    expect((qr.items[0].action as { text?: string }).text).toBe("次へ");
  });

  it("qrPostbackSourceMessageId 未指定（legacy）: target 付きでも message action のまま", () => {
    const items = JSON.parse(nextQrRow("msg-B").quickReplies!) as QuickReplyItem[];
    const qr = buildQuickReplyFromItems(items)!;
    expect(qr.items[0].action.type).toBe("message");
    expect((qr.items[0].action as { text?: string }).text).toBe("次へ");
  });

  it("url アクションは postback 化されず uri のまま", () => {
    const items = [{ action: "url", label: "外部", value: "https://example.com" }] as QuickReplyItem[];
    const qr = buildQuickReplyFromItems(items, { qrPostbackSourceMessageId: "A" })!;
    expect(qr.items[0].action.type).toBe("uri");
  });

  it("qrIndex は items 内の元 index（先頭の disabled / hint を飛ばしても保持される）", () => {
    // index0=disabled text(送信先あり), index1=hint, index2=送信先付き「次へ」
    const items = [
      { action: "text", label: "無効", target_message_id: "X", enabled: false },
      { action: "hint", label: "ヒント", hint_text: "h" },
      { action: "text", label: "次へ", target_message_id: "C" },
    ] as QuickReplyItem[];
    const qr = buildQuickReplyFromItems(items, { qrPostbackSourceMessageId: "B" })!;
    // disabled は出力されない。残るのは hint(message) と 次へ(postback)。
    const postback = qr.items.find((i) => i.action.type === "postback")!;
    expect(parseQuickReplyPostback((postback.action as { data: string }).data)).toEqual({ sourceMessageId: "B", qrIndex: 2 });
  });
});

describe("resolveQuickReplyItem: sourceMessageId 行の qrIndex から送信先付き item を解決", () => {
  it("送信先付き item を返す（target_message_id）", () => {
    const item = resolveQuickReplyItem(nextQrRow("msg-C"), 0);
    expect(item?.target_message_id).toBe("msg-C");
  });
  it("範囲外 / 送信先なし / disabled → null（500 にしない）", () => {
    expect(resolveQuickReplyItem(nextQrRow("msg-C"), 5)).toBeNull();
    expect(resolveQuickReplyItem({ kind: "normal", hintMode: "always", quickReplies: JSON.stringify([{ action: "text", label: "次へ" }]) }, 0)).toBeNull();
    expect(resolveQuickReplyItem({ kind: "normal", hintMode: "always", quickReplies: JSON.stringify([{ action: "text", label: "次へ", target_message_id: "C", enabled: false }]) }, 0)).toBeNull();
  });
  it("不正 JSON → null（throw しない）", () => {
    expect(resolveQuickReplyItem({ kind: "normal", hintMode: "always", quickReplies: "{壊れ" }, 0)).toBeNull();
  });
});

describe("★ regression: 同一フェーズ・同名『次へ』が複数 → タップ元 QR の送信先へ解決される", () => {
  // メッセージ A:「次へ」→ B / メッセージ B:「次へ」→ C（ラベルは同一「次へ」）
  const rowA = nextQrRow("msg-B");
  const rowB = nextQrRow("msg-C");
  const A_ID = "msg-A";
  const B_ID = "msg-B";

  it("メッセージ A 下の『次へ』postback は A 行 → 送信先 B に解決される", () => {
    const qrA = buildQuickReplyFromItems(JSON.parse(rowA.quickReplies!), { qrPostbackSourceMessageId: A_ID })!;
    const pb = parseQuickReplyPostback((qrA.items[0].action as { data: string }).data)!;
    expect(pb.sourceMessageId).toBe(A_ID);
    const item = resolveQuickReplyItem(rowA, pb.qrIndex)!;
    expect(resolveQrBranchDelivery(item).selectedRootMessageId).toBe("msg-B");
  });

  it("メッセージ B 下の『次へ』postback は B 行 → 送信先 C に解決される（B が再送されない）", () => {
    const qrB = buildQuickReplyFromItems(JSON.parse(rowB.quickReplies!), { qrPostbackSourceMessageId: B_ID })!;
    const pb = parseQuickReplyPostback((qrB.items[0].action as { data: string }).data)!;
    expect(pb.sourceMessageId).toBe(B_ID);
    const item = resolveQuickReplyItem(rowB, pb.qrIndex)!;
    const resolved = resolveQrBranchDelivery(item).selectedRootMessageId;
    expect(resolved).toBe("msg-C");
    // ★ ラベルが同じ「次へ」でも、B の送信先（C）であって A の送信先（B）ではない
    expect(resolved).not.toBe("msg-B");
  });
});
