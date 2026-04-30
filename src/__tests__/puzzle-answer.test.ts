import { describe, it, expect } from "vitest";
import { checkPuzzleAnswer, parseAnswerMatchType } from "@/lib/puzzle-answer";

// answer_match_type の組み合わせ：
//   - 照合条件: "exact" | "partial"（必須・どちらか1つ）
//   - 正規化:   "normalize_width" | "ignore_punctuation"（任意・複数可）

describe("parseAnswerMatchType", () => {
  it("null/undefined は ['exact']", () => {
    expect(parseAnswerMatchType(null)).toEqual(["exact"]);
    expect(parseAnswerMatchType(undefined)).toEqual(["exact"]);
  });

  it("空文字は ['exact']", () => {
    expect(parseAnswerMatchType("")).toEqual(["exact"]);
  });

  it("不正な JSON は ['exact']", () => {
    expect(parseAnswerMatchType("not-json")).toEqual(["exact"]);
  });

  it("配列が直接渡された場合はそのまま返す", () => {
    expect(parseAnswerMatchType(["partial"])).toEqual(["partial"]);
  });

  it("JSON 文字列の配列をパース", () => {
    expect(parseAnswerMatchType('["partial","ignore_punctuation"]')).toEqual([
      "partial",
      "ignore_punctuation",
    ]);
  });

  it("空配列は ['exact'] にフォールバック", () => {
    expect(parseAnswerMatchType("[]")).toEqual(["exact"]);
    expect(parseAnswerMatchType([])).toEqual(["exact"]);
  });
});

describe("checkPuzzleAnswer (exact)", () => {
  it("答え 桜 / 入力 桜 → true", () => {
    expect(checkPuzzleAnswer("桜", "桜", ["exact"])).toBe(true);
  });

  it("答え 桜 / 入力 答えは桜です → false", () => {
    expect(checkPuzzleAnswer("答えは桜です", "桜", ["exact"])).toBe(false);
  });

  it("matchTypes が空配列でも exact 扱いで照合する", () => {
    expect(checkPuzzleAnswer("桜", "桜", [])).toBe(true);
    expect(checkPuzzleAnswer("答えは桜です", "桜", [])).toBe(false);
  });

  it("前後空白は無視される", () => {
    expect(checkPuzzleAnswer("  桜  ", "桜", ["exact"])).toBe(true);
  });

  it("NFKC 正規化により全角英字も完全一致", () => {
    expect(checkPuzzleAnswer("ＨＥＬＬＯ", "HELLO", ["exact"])).toBe(true);
  });
});

describe("checkPuzzleAnswer (partial)", () => {
  it("答え 桜 / 入力 答えは桜です → true", () => {
    expect(checkPuzzleAnswer("答えは桜です", "桜", ["partial"])).toBe(true);
  });

  it("答え 桜 / 入力 さくらです → false（ひらがな変換は対象外）", () => {
    expect(checkPuzzleAnswer("さくらです", "桜", ["partial"])).toBe(false);
  });

  it("答えと入力が一致するときも true", () => {
    expect(checkPuzzleAnswer("桜", "桜", ["partial"])).toBe(true);
  });

  it("答え HELLO / 入力 答えはＨＥＬＬＯです / 全角半角無視ON → true", () => {
    expect(
      checkPuzzleAnswer("答えはＨＥＬＬＯです", "HELLO", [
        "partial",
        "normalize_width",
      ]),
    ).toBe(true);
  });

  it("答え 桜 / 入力 答えは「桜」です。 / 句読点無視ON → true", () => {
    expect(
      checkPuzzleAnswer("答えは「桜」です。", "桜", [
        "partial",
        "ignore_punctuation",
      ]),
    ).toBe(true);
  });

  it("答えに句読点を含む場合でも、ignore_punctuation で除去後 includes できる", () => {
    expect(
      checkPuzzleAnswer("正解は答え！", "答え！", [
        "partial",
        "ignore_punctuation",
      ]),
    ).toBe(true);
  });
});

describe("checkPuzzleAnswer (空文字ガード)", () => {
  it("答えが空文字なら常に false", () => {
    expect(checkPuzzleAnswer("何でもいい", "", ["exact"])).toBe(false);
    expect(checkPuzzleAnswer("何でもいい", "", ["partial"])).toBe(false);
  });

  it("入力が空文字なら常に false", () => {
    expect(checkPuzzleAnswer("", "桜", ["exact"])).toBe(false);
    expect(checkPuzzleAnswer("", "桜", ["partial"])).toBe(false);
  });

  it("ignore_punctuation 後に空文字になる場合も false", () => {
    expect(
      checkPuzzleAnswer("。、！", "桜", ["partial", "ignore_punctuation"]),
    ).toBe(false);
  });
});

describe("checkPuzzleAnswer (既存挙動の互換)", () => {
  it("旧形式 ['exact','ignore_punctuation'] でも動作する", () => {
    expect(
      checkPuzzleAnswer("桜。", "桜", ["exact", "ignore_punctuation"]),
    ).toBe(true);
  });

  it("旧形式 ['normalize_width'] のみでも完全一致として扱う", () => {
    expect(checkPuzzleAnswer("ＨＥＬＬＯ", "HELLO", ["normalize_width"])).toBe(true);
  });
});
