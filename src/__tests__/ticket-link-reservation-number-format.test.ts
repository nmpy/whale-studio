/**
 * src/__tests__/ticket-link-reservation-number-format.test.ts
 *
 * 予約番号のハイフン自動挿入（入力途中の表示整形）と、区切り無し 6 桁の受理。
 *
 * 背景:
 *   実運用の予約番号は「数字 6 桁を 3-3 で区切る」形（例 123-456）。
 *   ユーザーが区切りを省いて `123456` と入力すると
 *   「予約番号の形式が正しくありません。」になっていた。
 *   → 入力欄では 4 桁目から自動でハイフンを挿入し、
 *      正規化側も**ちょうど 6 桁**のときだけ区切りを補完する。
 */
import { describe, it, expect } from "vitest";
import {
  formatReservationNumberInput,
  normalizeReservationNumber,
  isNormalizedReservationNumber,
  isCompleteReservationNumberInput,
  RESERVATION_NUMBER_MAX_LENGTH,
} from "@/lib/ticket-link/reservation-number";

describe("formatReservationNumberInput — 入力途中の自動整形", () => {
  it("1〜3 桁ではハイフンを入れない", () => {
    expect(formatReservationNumberInput("1")).toBe("1");
    expect(formatReservationNumberInput("12")).toBe("12");
    expect(formatReservationNumberInput("123")).toBe("123");
  });

  it("4 桁目からハイフンが入る", () => {
    expect(formatReservationNumberInput("1234")).toBe("123-4");
    expect(formatReservationNumberInput("12345")).toBe("123-45");
    expect(formatReservationNumberInput("123456")).toBe("123-456");
  });

  it("6 桁を超える数字は入力されない（7 桁目以降を捨てる）", () => {
    expect(formatReservationNumberInput("1234567")).toBe("123-456");
    expect(formatReservationNumberInput("123456789")).toBe("123-456");
  });

  it("全角数字は半角へ正規化する", () => {
    expect(formatReservationNumberInput("１２３４５６")).toBe("123-456");
    expect(formatReservationNumberInput("１２３－４５６")).toBe("123-456");
  });

  it("空白・ハイフン・英字・記号は落とす（不正な文字を残さない）", () => {
    expect(formatReservationNumberInput("123 456")).toBe("123-456");
    expect(formatReservationNumberInput("123-456")).toBe("123-456");
    expect(formatReservationNumberInput("abc123def456")).toBe("123-456");
    expect(formatReservationNumberInput("12#3$45%6")).toBe("123-456");
    expect(formatReservationNumberInput("---")).toBe("");
  });

  it("バックスペースで自然に削除できる（末尾ハイフンを残さない）", () => {
    // "123-456" から 1 文字ずつ末尾を削っていく想定。
    expect(formatReservationNumberInput("123-45")).toBe("123-45");
    expect(formatReservationNumberInput("123-4")).toBe("123-4");
    // "123-4" の末尾を消すと入力値は "123-" → 数字 3 桁 → ハイフンも消える
    expect(formatReservationNumberInput("123-")).toBe("123");
    expect(formatReservationNumberInput("12")).toBe("12");
    expect(formatReservationNumberInput("")).toBe("");
  });

  it("null / undefined は空文字", () => {
    expect(formatReservationNumberInput(null)).toBe("");
    expect(formatReservationNumberInput(undefined)).toBe("");
  });

  it("整形結果は常に表示上の最大文字数以内", () => {
    expect(RESERVATION_NUMBER_MAX_LENGTH).toBe(7);
    for (const v of ["1", "1234", "123456", "1234567890", "１２３４５６７"]) {
      expect(formatReservationNumberInput(v).length).toBeLessThanOrEqual(RESERVATION_NUMBER_MAX_LENGTH);
    }
  });

  it("整形済みの値を再度整形しても変わらない（冪等）", () => {
    for (const v of ["", "12", "123", "123-4", "123-456"]) {
      expect(formatReservationNumberInput(formatReservationNumberInput(v))).toBe(formatReservationNumberInput(v));
    }
  });
});

describe("normalizeReservationNumber — 区切り無し 6 桁の受理（拡張）", () => {
  it("123456 → 123-456", () => {
    expect(normalizeReservationNumber("123456")).toBe("123-456");
  });

  it("全角 １２３４５６ → 123-456", () => {
    expect(normalizeReservationNumber("１２３４５６")).toBe("123-456");
  });

  it("全角・半角混在も正規化できる", () => {
    expect(normalizeReservationNumber("１23４56")).toBe("123-456");
    expect(normalizeReservationNumber("12３-４56")).toBe("123-456");
  });

  it("補完結果は正規形として妥当", () => {
    expect(isNormalizedReservationNumber(normalizeReservationNumber("123456")!)).toBe(true);
  });
});

describe("normalizeReservationNumber — 既存挙動を壊さない（後方互換）", () => {
  it("既にハイフン付きの予約番号はそのまま", () => {
    expect(normalizeReservationNumber("123-456")).toBe("123-456");
    expect(normalizeReservationNumber("  123-456  ")).toBe("123-456");
    expect(normalizeReservationNumber("123--456")).toBe("123-456");
  });

  it("空白区切り / 異体ハイフンは従来どおり", () => {
    expect(normalizeReservationNumber("123 456")).toBe("123-456");
    expect(normalizeReservationNumber("123　456")).toBe("123-456");
    expect(normalizeReservationNumber("123ー456")).toBe("123-456");
    expect(normalizeReservationNumber("123–456")).toBe("123-456");
    expect(normalizeReservationNumber("123−456")).toBe("123-456");
    expect(normalizeReservationNumber("１２３－４５６")).toBe("123-456");
  });

  it("桁数の異なる区切り付きは従来どおり受理（3-3 以外も壊さない）", () => {
    expect(normalizeReservationNumber("12-34")).toBe("12-34");
    expect(normalizeReservationNumber("12345678-1234")).toBe("12345678-1234");
  });

  it("6 桁以外の区切り無し数字は従来どおり null（区切り位置を推測しない）", () => {
    expect(normalizeReservationNumber("123")).toBeNull();
    expect(normalizeReservationNumber("12345")).toBeNull();
    expect(normalizeReservationNumber("1234567")).toBeNull();
    expect(normalizeReservationNumber("12345678")).toBeNull();
  });

  it("不正値は従来どおり null（不完全な入力を送信できない）", () => {
    expect(normalizeReservationNumber("abc")).toBeNull();
    expect(normalizeReservationNumber("1-2")).toBeNull();
    expect(normalizeReservationNumber("123-abc")).toBeNull();
    expect(normalizeReservationNumber("")).toBeNull();
    expect(normalizeReservationNumber(null)).toBeNull();
    expect(normalizeReservationNumber(undefined)).toBeNull();
  });
});

describe("送信値は必ず正規形になる", () => {
  it("入力欄の整形結果を正規化すると 123-456 になる（API へ送る値）", () => {
    for (const typed of ["123456", "123-456", "123 456", "１２３４５６", "１２３－４５６", "1234567"]) {
      const displayed = formatReservationNumberInput(typed);
      expect(normalizeReservationNumber(displayed)).toBe("123-456");
    }
  });

  it("不完全な入力は送信をブロックできる（桁数完了 + 正規化の AND）", () => {
    const canSubmit = (typed: string) => {
      const displayed = formatReservationNumberInput(typed);
      return isCompleteReservationNumberInput(displayed) && !!normalizeReservationNumber(displayed);
    };
    for (const typed of ["", "1", "12", "123", "1234", "12345"]) {
      expect(canSubmit(typed)).toBe(false);
    }
    expect(canSubmit("123456")).toBe(true);
  });

  it("【重要】5 桁の途中入力 12345 は整形すると 123-45 になり正規形は通るが、桁数判定で弾く", () => {
    const displayed = formatReservationNumberInput("12345");
    expect(displayed).toBe("123-45");
    // 照合キーの正規形（\d{2,8}-\d{2,8}）としては妥当になってしまう
    expect(normalizeReservationNumber(displayed)).toBe("123-45");
    // 手動入力 UI は 6 桁固定なので完了判定で拒否する
    expect(isCompleteReservationNumberInput(displayed)).toBe(false);
  });
});

describe("isCompleteReservationNumberInput — 6 桁完了判定", () => {
  it("6 桁そろっていれば true（区切りの有無を問わない）", () => {
    expect(isCompleteReservationNumberInput("123-456")).toBe(true);
    expect(isCompleteReservationNumberInput("123456")).toBe(true);
    expect(isCompleteReservationNumberInput("１２３４５６")).toBe(true);
  });
  it("6 桁未満 / 空 は false", () => {
    for (const v of ["", "1", "12", "123", "123-4", "123-45", null, undefined]) {
      expect(isCompleteReservationNumberInput(v)).toBe(false);
    }
  });
});
