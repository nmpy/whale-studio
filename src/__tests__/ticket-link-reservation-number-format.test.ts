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
  parseTicketLinkReservationNumberInput,
  ticketLinkReservationNumberErrorMessage,
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

describe("parseTicketLinkReservationNumberInput — ticket_link 専用の厳格判定", () => {
  it("許可された表現はすべて 123-456 に正規化される", () => {
    for (const v of ["123456", "123-456", "123 456", "123　456", "１２３４５６", "１２３－４５６", "123ー456", " 123-456 "]) {
      const r = parseTicketLinkReservationNumberInput(v);
      expect(r.ok).toBe(true);
      if (r.ok) { expect(r.normalized).toBe("123-456"); expect(r.formatted).toBe("123-456"); }
    }
  });

  it("英字・不正記号は invalid_character として拒否（数字だけ抜くと6桁でも通さない）", () => {
    for (const v of ["abc123def456", "123a456", "123/456", "123_456", "123.456", "#123456", "123456円"]) {
      const r = parseTicketLinkReservationNumberInput(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid_character");
    }
  });

  it("文字種は正しいが 6 桁以上で 3-3 にならないものは invalid_format", () => {
    for (const v of ["1234-56", "12-3456", "1234567", "12345678", "12345678-1234"]) {
      const r = parseTicketLinkReservationNumberInput(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid_format");
    }
  });

  it("数字が 6 桁未満なら incomplete（区切りの有無を問わない）", () => {
    // "12-34" は区切り付きだが数字は 4 桁 → 入力途中として扱う（文言は「数字6桁で入力してください」）。
    for (const v of ["", "  ", "1", "12", "123", "123-4", "123-45", "12-34"]) {
      const r = parseTicketLinkReservationNumberInput(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("incomplete");
    }
  });

  it("いずれの拒否理由でも ok=false のため送信されない（12-34 / 123-45 を含む）", () => {
    for (const v of ["12-34", "123-45", "1234-56", "abc123def456", "123/456"]) {
      expect(parseTicketLinkReservationNumberInput(v).ok).toBe(false);
    }
  });

  it("null / undefined は incomplete", () => {
    expect(parseTicketLinkReservationNumberInput(null)).toEqual({ ok: false, reason: "incomplete" });
    expect(parseTicketLinkReservationNumberInput(undefined)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("エラー文言は理由ごとに出し分ける（内部情報を含めない）", () => {
    expect(ticketLinkReservationNumberErrorMessage("invalid_character")).toContain("数字とハイフンのみ");
    expect(ticketLinkReservationNumberErrorMessage("invalid_format")).toContain("数字6桁");
    expect(ticketLinkReservationNumberErrorMessage("incomplete")).toContain("数字6桁");
  });
});

describe("不正文字は「削除して6桁」でも送信できない", () => {
  it("abc123def456 は表示整形すると 123-456 になるが、厳格判定は拒否する", () => {
    expect(formatReservationNumberInput("abc123def456")).toBe("123-456"); // 表示だけは数字が残る
    const r = parseTicketLinkReservationNumberInput("abc123def456");      // 生値の判定は拒否
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_character");
  });
});

describe("ticket_link 以外の経路（共通 CANONICAL）は壊さない", () => {
  it("normalizeReservationNumber は 3-3 以外も従来どおり受理し続ける", () => {
    expect(normalizeReservationNumber("12-34")).toBe("12-34");
    expect(normalizeReservationNumber("12345678-1234")).toBe("12345678-1234");
  });
  it("厳格判定は ticket_link 専用で、共通関数の戻り値を変えない", () => {
    expect(normalizeReservationNumber("123456")).toBe("123-456");
    expect(parseTicketLinkReservationNumberInput("12-34").ok).toBe(false);
    expect(normalizeReservationNumber("12-34")).toBe("12-34"); // 共通側は据え置き
  });
});

describe("confirm 処理と draft API が同じ厳格条件を共有する", () => {
  // confirmTicketLink / draft route はいずれも parseTicketLinkReservationNumberInput を通す。
  // ここでは「確定処理へ渡りうる値」を同じ関数で判定し、条件が一致することを固定する。
  it("ドラフトに不正値が残っていても確定条件を満たさない", () => {
    for (const stored of ["abc123def456", "123/456", "12-34", "123-45", "1234-56", "1234567"]) {
      expect(parseTicketLinkReservationNumberInput(stored).ok).toBe(false);
    }
  });
  it("正規形は確定条件を満たす", () => {
    const r = parseTicketLinkReservationNumberInput("123-456");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized).toBe("123-456");
  });
});
