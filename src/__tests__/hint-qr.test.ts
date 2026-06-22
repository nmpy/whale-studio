/**
 * src/__tests__/hint-qr.test.ts
 * 問題メッセージのヒント用クイックリプライ（QR=Quick Reply）の送信payload解決とラベル正規化。
 */
import { describe, it, expect } from "vitest";
import { normalizeHintQrItems, resolveDisplayQrItems } from "@/lib/hint-qr";
import { buildQuickReplyFromItems } from "@/lib/line";
import type { QuickReplyItem } from "@/types";

const hint = (over: Partial<QuickReplyItem> = {}): QuickReplyItem =>
  ({ label: "", action: "hint", hint_text: "ヒント本文", ...over }) as QuickReplyItem;
const normalQr = (label: string): QuickReplyItem =>
  ({ label, action: "text", value: label }) as QuickReplyItem;

describe("normalizeHintQrItems — デフォルトラベル", () => {
  it("1件ならラベル「ヒント」", () => {
    expect(normalizeHintQrItems([hint()]).map((i) => i.label)).toEqual(["ヒント"]);
  });
  it("複数件は ヒント1 / ヒント2 / ヒント3", () => {
    expect(normalizeHintQrItems([hint(), hint(), hint()]).map((i) => i.label)).toEqual(["ヒント1", "ヒント2", "ヒント3"]);
  });
  it("既存ラベルが空でなければ優先", () => {
    expect(normalizeHintQrItems([hint({ label: "場所のヒント" }), hint()]).map((i) => i.label)).toEqual(["場所のヒント", "ヒント2"]);
  });
  it("action!=hint / enabled=false は除外", () => {
    expect(normalizeHintQrItems([normalQr("A"), hint({ enabled: false }), hint()]).map((i) => i.label)).toEqual(["ヒント"]);
  });
  it("null/空でも落ちない", () => {
    expect(normalizeHintQrItems(null)).toEqual([]);
    expect(normalizeHintQrItems(undefined)).toEqual([]);
  });
});

describe("resolveDisplayQrItems — 送信payload用 QR 解決", () => {
  const base = { quickReplies: null, incorrectQuickReplies: null };

  it("ヒントなしの問題メッセージ → quickReply は付かない（空配列）", () => {
    expect(resolveDisplayQrItems({ ...base, kind: "puzzle", hintMode: "always" })).toEqual([]);
  });
  it("ヒント1件あり → ヒント QR が1件追加（label=ヒント）", () => {
    const r = resolveDisplayQrItems({ kind: "puzzle", hintMode: "always", quickReplies: null, incorrectQuickReplies: [hint()] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ action: "hint", label: "ヒント" });
  });
  it("ヒント複数 → 件数分 ヒント1,2,3", () => {
    const r = resolveDisplayQrItems({ kind: "puzzle", hintMode: "always", quickReplies: null, incorrectQuickReplies: [hint(), hint(), hint()] });
    expect(r.map((i) => i.label)).toEqual(["ヒント1", "ヒント2", "ヒント3"]);
  });
  it("既存QRあり + ヒントあり → 既存QRは消えず先頭、ヒントは後ろに追加", () => {
    const r = resolveDisplayQrItems({ kind: "puzzle", hintMode: "always", quickReplies: [normalQr("選択肢A")], incorrectQuickReplies: [hint(), hint()] });
    expect(r.map((i) => i.label)).toEqual(["選択肢A", "ヒント1", "ヒント2"]);
  });
  it("hint_mode=on_wrong / hidden → 問題メッセージ初期表示にヒントを付けない", () => {
    expect(resolveDisplayQrItems({ kind: "puzzle", hintMode: "on_wrong", quickReplies: null, incorrectQuickReplies: [hint()] })).toEqual([]);
    expect(resolveDisplayQrItems({ kind: "puzzle", hintMode: "hidden", quickReplies: null, incorrectQuickReplies: [hint()] })).toEqual([]);
  });
  it("非パズルは incorrect_quick_replies を無視（既存仕様）", () => {
    expect(resolveDisplayQrItems({ kind: "normal", hintMode: "always", quickReplies: [normalQr("A")], incorrectQuickReplies: [hint()] }).map((i) => i.label)).toEqual(["A"]);
  });
  it("通常メッセージで hint_mode≠always のとき quick_replies 内の hint は隠す（既存仕様維持）", () => {
    const r = resolveDisplayQrItems({ kind: "normal", hintMode: "hidden", quickReplies: [normalQr("A"), hint({ label: "ヒントX" })], incorrectQuickReplies: null });
    expect(r.map((i) => i.label)).toEqual(["A"]);
  });
});

describe("実機送信payload: resolveDisplayQrItems → buildQuickReplyFromItems", () => {
  it("ヒント QR が message action（タップでラベル文字列を送信）になる", () => {
    const items = resolveDisplayQrItems({ kind: "puzzle", hintMode: "always", quickReplies: null, incorrectQuickReplies: [hint(), hint()] });
    const qr = buildQuickReplyFromItems(items)!;
    expect(qr.items).toHaveLength(2);
    expect(qr.items[0].action).toMatchObject({ type: "message", label: "ヒント1", text: "ヒント1" });
    expect(qr.items[1].action).toMatchObject({ type: "message", label: "ヒント2", text: "ヒント2" });
  });
  it("既存QR + 多数ヒントでも上限(4)で安全に切り詰め・既存QRは先頭に残る", () => {
    const items = resolveDisplayQrItems({
      kind: "puzzle", hintMode: "always",
      quickReplies: [normalQr("選択肢A")],
      incorrectQuickReplies: [hint(), hint(), hint(), hint(), hint(), hint()],
    });
    const qr = buildQuickReplyFromItems(items)!;
    expect(qr.items).toHaveLength(4); // QUICK_REPLY_MAX
    expect(qr.items[0].action).toMatchObject({ label: "選択肢A" }); // 既存QRが消えない
  });
});
