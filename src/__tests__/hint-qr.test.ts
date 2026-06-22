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

// ── 回帰: 通常 quick_replies の有無（空配列/null）がヒント合成を阻害しないこと ──
// （本番で「ヒント①」を ヒント（クイックリプライ）に設定しても問題下に出なかった事象の再発防止）
describe("回帰: quick_replies の有無に関わらずヒントを合成する", () => {
  const hint1 = (): QuickReplyItem =>
    ({ action: "hint", label: "ヒント①", value: "ヒント①", hint_text: "ヒントじゃ。" }) as QuickReplyItem;

  it("1. quick_replies=[] + ヒントあり → ヒント① が合成される", () => {
    const items = resolveDisplayQrItems({ kind: "puzzle", hintMode: "always", quickReplies: [], incorrectQuickReplies: [hint1()] });
    expect(items.map((i) => i.label)).toEqual(["ヒント①"]);
    const qr = buildQuickReplyFromItems(items)!;
    expect(qr.items).toHaveLength(1);
    expect(qr.items[0].action).toMatchObject({ type: "message", label: "ヒント①", text: "ヒント①" });
  });
  it("2. quick_replies=null + ヒントあり → ヒント① が合成される", () => {
    const items = resolveDisplayQrItems({ kind: "puzzle", hintMode: "always", quickReplies: null, incorrectQuickReplies: [hint1()] });
    expect(items.map((i) => i.label)).toEqual(["ヒント①"]);
  });
  it("3. 通常QRあり + ヒントあり → 通常QRが先頭・ヒントが後ろ（既存QRが消えない）", () => {
    const items = resolveDisplayQrItems({ kind: "puzzle", hintMode: "always", quickReplies: [normalQr("選択肢A"), normalQr("選択肢B")], incorrectQuickReplies: [hint1()] });
    expect(items.map((i) => i.label)).toEqual(["選択肢A", "選択肢B", "ヒント①"]);
  });
  it("hint_mode 未指定(null)でも quick_replies=[] でヒント合成される（既定 always 相当）", () => {
    const items = resolveDisplayQrItems({ kind: "puzzle", hintMode: null, quickReplies: [], incorrectQuickReplies: [hint1()] });
    expect(items.map((i) => i.label)).toEqual(["ヒント①"]);
  });
});

// ── 回帰: buildQuickReplyFromItems は action:"hint" を LINE message action に変換する ──
describe("回帰: buildQuickReplyFromItems converts action hint to LINE message action", () => {
  it("action:'hint' → type:'message'（除外されない）/ label・text が入る", () => {
    const qr = buildQuickReplyFromItems(normalizeHintQrItems([
      { action: "hint", label: "ヒント①", value: "ヒント１", hint_text: "..." } as QuickReplyItem,
      { action: "hint", label: "ヒント②", value: "ヒント２", hint_text: "..." } as QuickReplyItem,
    ]))!;
    expect(qr.items).toHaveLength(2);
    expect(qr.items.every((i) => i.action.type === "message")).toBe(true);
    expect((qr.items[0].action as { label: string }).label).toBe("ヒント①");
  });
  it("hint quick reply falls back to label when value is missing", () => {
    const qr = buildQuickReplyFromItems(normalizeHintQrItems([
      { action: "hint", label: "ヒント③（こたえ）", hint_text: "星じゃよ。" } as QuickReplyItem, // value 無し
    ]))!;
    expect(qr.items).toHaveLength(1);
    const action = qr.items[0].action as { type: string; label: string; text: string };
    expect(action.type).toBe("message");
    expect(action.label).toBe("ヒント③（こたえ）");
    expect(action.text).toBe("ヒント③（こたえ）"); // value 無し → label を text に
  });
  it("1件でも value 欠けたヒントがあっても quickReply 全体は落ちない（3件とも残る）", () => {
    const qr = buildQuickReplyFromItems(normalizeHintQrItems([
      { action: "hint", label: "ヒント①", value: "ヒント１", hint_text: "a" } as QuickReplyItem,
      { action: "hint", label: "ヒント②", value: "ヒント２", hint_text: "b" } as QuickReplyItem,
      { action: "hint", label: "ヒント③（こたえ）", hint_text: "c" } as QuickReplyItem,
    ]))!;
    expect(qr.items).toHaveLength(3);
  });
});
