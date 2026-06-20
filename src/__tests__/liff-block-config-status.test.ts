/**
 * src/__tests__/liff-block-config-status.test.ts
 * PR-BLK2: ブロックカードの「未設定」判定（純関数）の回帰テスト。
 * - 必須項目が空 → 未設定 / 入力済 → 設定済
 * - データ駆動ブロック・不明 type は未設定にしない（false）
 */
import { describe, it, expect } from "vitest";
import { isBlockUnconfigured } from "@/components/liff/block-config-status";

describe("isBlockUnconfigured", () => {
  it("heading: text 空で未設定 / 入力で設定済", () => {
    expect(isBlockUnconfigured("heading", {})).toBe(true);
    expect(isBlockUnconfigured("heading", { text: "  " })).toBe(true); // 空白のみ
    expect(isBlockUnconfigured("heading", { text: "見出し" })).toBe(false);
  });
  it("free_text / text: body 空で未設定", () => {
    expect(isBlockUnconfigured("free_text", {})).toBe(true);
    expect(isBlockUnconfigured("free_text", { body: "本文" })).toBe(false);
    expect(isBlockUnconfigured("text", {})).toBe(true);
    expect(isBlockUnconfigured("text", { body: "旧本文" })).toBe(false);
  });
  it("image: image_url 空で未設定", () => {
    expect(isBlockUnconfigured("image", {})).toBe(true);
    expect(isBlockUnconfigured("image", { image_url: "https://x/a.png" })).toBe(false);
  });
  it("video: video_url 空で未設定", () => {
    expect(isBlockUnconfigured("video", {})).toBe(true);
    expect(isBlockUnconfigured("video", { video_url: "https://x/a.mp4" })).toBe(false);
  });
  it("button_link: ラベルと遷移先の両方が要る", () => {
    expect(isBlockUnconfigured("button_link", {})).toBe(true);
    expect(isBlockUnconfigured("button_link", { label: "購入" })).toBe(true);           // 遷移先なし
    expect(isBlockUnconfigured("button_link", { url: "https://x" })).toBe(true);          // ラベルなし
    expect(isBlockUnconfigured("button_link", { label: "購入", url: "https://x" })).toBe(false);
    expect(isBlockUnconfigured("button_link", { label: "進む", liff_page_id: "p1" })).toBe(false);
    expect(isBlockUnconfigured("button_link", { label: "受付", location_id: "l1" })).toBe(false);
  });
  it("accordion: title 空で未設定", () => {
    expect(isBlockUnconfigured("accordion", {})).toBe(true);
    expect(isBlockUnconfigured("accordion", { title: "STAGE 1" })).toBe(false);
  });
  it("warning: body 空で未設定", () => {
    expect(isBlockUnconfigured("warning", {})).toBe(true);
    expect(isBlockUnconfigured("warning", { body: "注意" })).toBe(false);
  });
  it("code_reader: label 空で未設定", () => {
    expect(isBlockUnconfigured("code_reader", {})).toBe(true);
    expect(isBlockUnconfigured("code_reader", { label: "チェックイン" })).toBe(false);
  });
  it("データ駆動・既定ありブロックは未設定にしない", () => {
    for (const t of ["divider", "progress", "character_list", "riddle_list", "checkin_history", "hint_list", "start_button"]) {
      expect(isBlockUnconfigured(t, {})).toBe(false);
    }
  });
  it("不明 type / null settings は安全（未設定にしない）", () => {
    expect(isBlockUnconfigured("totally_unknown", {})).toBe(false);
    expect(isBlockUnconfigured("heading", null)).toBe(true);
    expect(isBlockUnconfigured("divider", undefined)).toBe(false);
  });
});
