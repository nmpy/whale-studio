// src/__tests__/ticket-link-reservation-number.test.ts
//
// 予約番号の正規化・抽出・マスクの単体テスト（DOM 非依存）。

import { describe, it, expect } from "vitest";
import {
  normalizeReservationNumber,
  isNormalizedReservationNumber,
  extractReservationNumberCandidates,
  maskReservationNumber,
} from "@/lib/ticket-link/reservation-number";

describe("normalizeReservationNumber", () => {
  it("すでに正規形ならそのまま返す", () => {
    expect(normalizeReservationNumber("123-456")).toBe("123-456");
  });

  it("全角数字と全角ハイフンを半角へ正規化する", () => {
    expect(normalizeReservationNumber("１２３－４５６")).toBe("123-456");
  });

  it("空白区切りをハイフンとして扱う", () => {
    expect(normalizeReservationNumber("123 456")).toBe("123-456");
    expect(normalizeReservationNumber("123　456")).toBe("123-456");
  });

  it("長音符・各種ダッシュをハイフンへ統一する", () => {
    expect(normalizeReservationNumber("123ー456")).toBe("123-456");
    expect(normalizeReservationNumber("123–456")).toBe("123-456");
    expect(normalizeReservationNumber("123−456")).toBe("123-456");
  });

  it("前後の空白を除去する", () => {
    expect(normalizeReservationNumber("  123-456  ")).toBe("123-456");
  });

  it("連続ハイフンを畳む", () => {
    expect(normalizeReservationNumber("123--456")).toBe("123-456");
  });

  it("期待する形でなければ null を返す（推測で補完しない）", () => {
    expect(normalizeReservationNumber("abc")).toBeNull();
    expect(normalizeReservationNumber("123")).toBeNull();      // 区切りが無い
    expect(normalizeReservationNumber("1-2")).toBeNull();      // 桁が短すぎる
    expect(normalizeReservationNumber("123-abc")).toBeNull();  // 数字以外を含む
    expect(normalizeReservationNumber("")).toBeNull();
    expect(normalizeReservationNumber(null)).toBeNull();
    expect(normalizeReservationNumber(undefined)).toBeNull();
  });
});

describe("isNormalizedReservationNumber", () => {
  it("正規形のみ true", () => {
    expect(isNormalizedReservationNumber("123-456")).toBe(true);
    expect(isNormalizedReservationNumber("123 456")).toBe(false);
    expect(isNormalizedReservationNumber("123")).toBe(false);
  });
});

describe("extractReservationNumberCandidates", () => {
  it("前後に文章があっても抽出する", () => {
    expect(extractReservationNumberCandidates("予約番号は123-456です")).toEqual(["123-456"]);
  });

  it("単体送信も抽出する", () => {
    expect(extractReservationNumberCandidates("123-456")).toEqual(["123-456"]);
  });

  it("全角で送られても抽出する", () => {
    expect(extractReservationNumberCandidates("予約番号は１２３－４５６です")).toEqual(["123-456"]);
  });

  it("候補が複数あるときは全件返す（呼び出し側が自動確定しない）", () => {
    const got = extractReservationNumberCandidates("123-456 と 789-012 のどちらかです");
    expect(got).toEqual(["123-456", "789-012"]);
    expect(got.length).toBeGreaterThan(1);
  });

  it("同じ番号が複数回出ても重複排除する", () => {
    expect(extractReservationNumberCandidates("123-456 ですね。123-456 で合ってます")).toEqual(["123-456"]);
  });

  it("一般会話を誤検知しない", () => {
    expect(extractReservationNumberCandidates("こんにちは、今日はよろしくお願いします")).toEqual([]);
    expect(extractReservationNumberCandidates("ヒントをください")).toEqual([]);
    expect(extractReservationNumberCandidates("")).toEqual([]);
    expect(extractReservationNumberCandidates(null)).toEqual([]);
  });

  it("日付らしき並びを候補にしない", () => {
    expect(extractReservationNumberCandidates("公演は2026-08に開催です")).toEqual([]);
    expect(extractReservationNumberCandidates("12-25 に行きます")).toEqual([]);
  });

  it("電話番号らしき長い並びを候補にしない", () => {
    expect(extractReservationNumberCandidates("連絡先は03-12345678 です")).toEqual([]);
  });
});

describe("maskReservationNumber", () => {
  it("ハイフン以降を伏せる", () => {
    expect(maskReservationNumber("123-456")).toBe("123-***");
  });

  it("値が無いときはダッシュを返す", () => {
    expect(maskReservationNumber(null)).toBe("—");
    expect(maskReservationNumber("")).toBe("—");
  });
});
