/**
 * src/__tests__/buildKeywordMessages-hint.test.ts
 *
 * 回帰: buildKeywordMessages 経路（通常クイックリプライの target_message_id →
 * puzzle メッセージ送信など）でも、問題メッセージ本体にヒント用クイックリプライが付くこと。
 *
 * 背景: 実機ログで quickReply=false。原因は buildKeywordMessages が msg.quickReplies のみ参照し、
 * incorrect_quick_replies / hint_mode / kind を使った resolveDisplayQrItems 合成をしていなかったため。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildKeywordMessages, type KeywordMessageRecord } from "@/lib/line";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** 本番 SQL と同形の incorrect_quick_replies（JSON文字列＝DB保存形式）。3件目は value 無し。 */
const PROD_HINTS = JSON.stringify([
  { label: "ヒント①", action: "hint", value: "ヒント１", hint_text: "ヒントじゃ。" },
  { label: "ヒント②", action: "hint", value: "ヒント２", hint_text: "「ほ」二文字" },
  { label: "ヒント③（こたえ）", action: "hint", hint_text: "星じゃよ。" }, // value 無し
]);

function rec(over: Partial<KeywordMessageRecord> = {}): KeywordMessageRecord {
  return {
    id: "8c001c89-b5ca-4c77-9681-f919c6b4e701",
    messageType: "text",
    body: "この子の帰り道を示すもの。",
    assetUrl: null, altText: null, flexPayloadJson: null,
    quickReplies: null,
    kind: "puzzle", hintMode: "always", incorrectQuickReplies: null,
    nextMessageId: null, sortOrder: 0,
    character: null,
    ...over,
  } as KeywordMessageRecord;
}

type QrAction = { type: string; label: string; text: string };
const qrOf = (m: unknown) => (m as { quickReply?: { items: { action: QrAction }[] } }).quickReply;

describe("buildKeywordMessages: 問題メッセージにヒント QR を合成する", () => {
  it("1. target_message_id → puzzle: incorrect_quick_replies 3件が LINE message action として付く", () => {
    const out = buildKeywordMessages([rec({ incorrectQuickReplies: PROD_HINTS })]);
    const qr = qrOf(out[0]);
    expect(qr).toBeDefined();
    expect(qr!.items).toHaveLength(3);
    expect(qr!.items.map((i) => i.action.type)).toEqual(["message", "message", "message"]);
    expect(qr!.items.map((i) => i.action.label)).toEqual(["ヒント①", "ヒント②", "ヒント③（こたえ）"]);
    // value 欠落の3件目は text が label fallback
    expect(qr!.items[2].action.text).toBe("ヒント③（こたえ）");
    // action.type に "hint" は決して残さない（LINE は未知 action を拒否する）
    expect(qr!.items.every((i) => i.action.type === "message")).toBe(true);
  });

  it("2. quick_replies=null + ヒントあり → ヒント QR が付く", () => {
    const out = buildKeywordMessages([rec({ quickReplies: null, incorrectQuickReplies: PROD_HINTS })]);
    expect(qrOf(out[0])!.items).toHaveLength(3);
  });

  it("3. 通常 quick_replies + ヒントあり → 通常QRが先頭・ヒントが後置", () => {
    const normal = JSON.stringify([{ label: "選択肢A", action: "text", value: "選択肢A" }]);
    const out = buildKeywordMessages([rec({ quickReplies: normal, incorrectQuickReplies: PROD_HINTS })]);
    const labels = qrOf(out[0])!.items.map((i) => i.action.label);
    expect(labels).toEqual(["選択肢A", "ヒント①", "ヒント②", "ヒント③（こたえ）"]);
  });

  it("4-a. hint_mode='hidden' → 初期送信ではヒント QR を付けない", () => {
    const out = buildKeywordMessages([rec({ hintMode: "hidden", incorrectQuickReplies: PROD_HINTS })]);
    expect(qrOf(out[0])).toBeUndefined();
  });

  it("4-b. hint_mode='on_wrong' → 初期送信ではヒント QR を付けない", () => {
    const out = buildKeywordMessages([rec({ hintMode: "on_wrong", incorrectQuickReplies: PROD_HINTS })]);
    expect(qrOf(out[0])).toBeUndefined();
  });

  it("kind='normal'（puzzle以外）はヒント QR を付けない（通常メッセージへの誤付与防止）", () => {
    const out = buildKeywordMessages([rec({ kind: "normal", incorrectQuickReplies: PROD_HINTS })]);
    expect(qrOf(out[0])).toBeUndefined();
  });
});
