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

// ── 複数正解（answers）対応 ──────────────────────────────
import {
  parsePuzzleAnswers,
  resolveAnswerCandidates,
  checkPuzzleAnswerAny,
} from "@/lib/puzzle-answer";

describe("parsePuzzleAnswers", () => {
  it("null/undefined/空文字は []", () => {
    expect(parsePuzzleAnswers(null)).toEqual([]);
    expect(parsePuzzleAnswers(undefined)).toEqual([]);
    expect(parsePuzzleAnswers("")).toEqual([]);
  });
  it("JSON 配列文字列を string[] に変換し trim・空除外する", () => {
    expect(parsePuzzleAnswers('["りんご"," 林檎 ",""]')).toEqual(["りんご", "林檎"]);
  });
  it("配列をそのまま受け取り trim・空除外する", () => {
    expect(parsePuzzleAnswers(["apple", "  ", "リンゴ"])).toEqual(["apple", "リンゴ"]);
  });
  it("不正な JSON は []", () => {
    expect(parsePuzzleAnswers("not-json")).toEqual([]);
  });
});

describe("resolveAnswerCandidates", () => {
  it("単一 answer と answers を統合し重複除外する", () => {
    expect(resolveAnswerCandidates("りんご", '["林檎","りんご","リンゴ"]')).toEqual([
      "りんご", "林檎", "リンゴ",
    ]);
  });
  it("answer のみ（後方互換: 既存単一データ）", () => {
    expect(resolveAnswerCandidates("桜", null)).toEqual(["桜"]);
  });
  it("answers のみ", () => {
    expect(resolveAnswerCandidates(null, ["a", "b"])).toEqual(["a", "b"]);
  });
  it("どちらも空なら []", () => {
    expect(resolveAnswerCandidates("", null)).toEqual([]);
  });
});

describe("checkPuzzleAnswerAny", () => {
  const candidates = ["りんご", "林檎", "リンゴ", "apple"];
  it("いずれかに完全一致すれば正解", () => {
    expect(checkPuzzleAnswerAny("林檎", candidates, ["exact"])).toBe(true);
    expect(checkPuzzleAnswerAny("ａｐｐｌｅ", candidates, ["exact"])).toBe(true); // NFKC（全角→半角）
  });
  it("どれにも一致しなければ不正解", () => {
    expect(checkPuzzleAnswerAny("みかん", candidates, ["exact"])).toBe(false);
  });
  it("候補が空なら常に false", () => {
    expect(checkPuzzleAnswerAny("りんご", [], ["exact"])).toBe(false);
  });
  it("partial 指定でいずれかが部分一致すれば正解", () => {
    expect(checkPuzzleAnswerAny("私はりんごが好き", candidates, ["partial"])).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// 部分一致の許容範囲（完全包含 / 長さ別の連続一致率）
//   仕様: normalizePuzzleAnswerText / isPuzzleAnswerAccepted /
//         getLongestContiguousOverlapLength / judgePuzzleAnswer
//   ※ partial（部分一致許容トグル）配下でのみ有効。exact は不変。
// ═══════════════════════════════════════════════════════════
import {
  normalizePuzzleAnswerText,
  getLongestContiguousOverlapLength,
  isPuzzleAnswerAccepted,
  judgePuzzleAnswer,
  judgePuzzleAnswerAny,
} from "@/lib/puzzle-answer";

describe("normalizePuzzleAnswerText（回答照合専用の強い正規化）", () => {
  it("NFKC + 小文字化 + 前後空白削除", () => {
    expect(normalizePuzzleAnswerText("  ＨＥＬＬＯ  ")).toBe("hello");
  });
  it("スペース・改行・タブを除去する", () => {
    expect(normalizePuzzleAnswerText("a b\tc\nd")).toBe("abcd");
    expect(normalizePuzzleAnswerText("全角　空白　除去")).toBe("全角空白除去"); // 全角スペース(U+3000)除去
  });
  it("比較に不要な記号（、。！？・.,:：-ー 等）を除去する", () => {
    expect(normalizePuzzleAnswerText("答え、です。！")).toBe("答えです");
    expect(normalizePuzzleAnswerText("HUMANITY:P2")).toBe("humanityp2");
    expect(normalizePuzzleAnswerText("東-京ー都")).toBe("東京都");
  });
  it("日本語・英数字の本体は残す", () => {
    expect(normalizePuzzleAnswerText("りんご123abc")).toBe("りんご123abc");
  });
  it("空・記号のみは空文字になる", () => {
    expect(normalizePuzzleAnswerText("")).toBe("");
    expect(normalizePuzzleAnswerText("。、！ ")).toBe("");
  });
});

describe("getLongestContiguousOverlapLength（最長共通連続部分文字列）", () => {
  it("連続一致の長さを返す（生文字列。正規化前提ではない）", () => {
    // 生の "オペレーションベル"(ー 含む 9文字) は "オペレーションベルキッシュ" の接頭 9文字
    expect(getLongestContiguousOverlapLength("オペレーションベル", "オペレーションベルキッシュ")).toBe(9);
    expect(getLongestContiguousOverlapLength("abcXYZ", "XYZdef")).toBe(3);
  });
  it("非連続の寄せ集めは数えない（連続のみ）", () => {
    // "aXbXc" と "abc" の共通は連続では 1 文字まで（a/b/c は非連続）
    expect(getLongestContiguousOverlapLength("aXbXc", "abc")).toBe(1);
  });
  it("空文字は 0", () => {
    expect(getLongestContiguousOverlapLength("", "abc")).toBe(0);
    expect(getLongestContiguousOverlapLength("abc", "")).toBe(0);
  });
});

describe("isPuzzleAnswerAccepted — 完全包含は正解", () => {
  it("正解 鍵 / 入力 答えは鍵です → 正解", () => {
    expect(isPuzzleAnswerAccepted("答えは鍵です", ["鍵"])).toBe(true);
  });
  it("正解 HUMANITY:P2 / 入力 humanity p2 → 正解（小文字化・記号/空白除去で完全包含）", () => {
    expect(isPuzzleAnswerAccepted("humanity p2", ["HUMANITY:P2"])).toBe(true);
  });
  it("正解 東京 / 入力 答えは東京です → 正解", () => {
    expect(isPuzzleAnswerAccepted("答えは東京です", ["東京"])).toBe(true);
  });
  it("自然文（〜だと思います / たぶん〜）でも核心を含めば正解", () => {
    expect(isPuzzleAnswerAccepted("オペレーションベルキッシュだと思います", ["オペレーションベルキッシュ"])).toBe(true);
    expect(isPuzzleAnswerAccepted("たぶんオペレーションベルキッシュ", ["オペレーションベルキッシュ"])).toBe(true);
  });
});

describe("isPuzzleAnswerAccepted — 短い答え（1〜4文字は完全包含のみ）", () => {
  it("正解 鍵 / 入力 か → 不正解", () => {
    expect(isPuzzleAnswerAccepted("か", ["鍵"])).toBe(false);
  });
  it("正解 東京 / 入力 東 → 不正解（部分一致は許容しない）", () => {
    expect(isPuzzleAnswerAccepted("東", ["東京"])).toBe(false);
  });
  it("正解 りんご / 入力 り → 不正解", () => {
    expect(isPuzzleAnswerAccepted("り", ["りんご"])).toBe(false);
  });
  it("正解 東京 / 入力 答えは東京です → 正解（完全包含は 1〜4文字でも可）", () => {
    expect(isPuzzleAnswerAccepted("答えは東京です", ["東京"])).toBe(true);
  });
});

describe("isPuzzleAnswerAccepted — 5〜7文字（80% 以上の連続一致）", () => {
  // 正解 6 文字 → 必要連続 = ceil? 6*0.8=4.8 → 5 文字以上の連続一致で正解
  it("6文字の答え / 5文字の連続を含む → 正解（5/6=83%）", () => {
    expect(isPuzzleAnswerAccepted("秘密の合言", ["秘密の合言葉"])).toBe(true);
  });
  it("6文字の答え / 4文字の連続しか含まない → 不正解（4/6=67% < 80%）", () => {
    expect(isPuzzleAnswerAccepted("秘密の合", ["秘密の合言葉"])).toBe(false);
  });
  it("5文字の答え / 4文字の連続を含む → 正解（4/5=80%）", () => {
    expect(isPuzzleAnswerAccepted("パスワードだよ", ["パスワード"])).toBe(true); // 完全包含
    expect(isPuzzleAnswerAccepted("アイウエ", ["アイウエオ"])).toBe(true); // 4/5=80%
  });
  it("5文字の答え / 3文字の連続しか含まない → 不正解（3/5=60% < 80%）", () => {
    expect(isPuzzleAnswerAccepted("アイウ", ["アイウエオ"])).toBe(false);
  });
});

describe("isPuzzleAnswerAccepted — 8文字以上（50% 以上の連続一致）", () => {
  it("オペレーションベルキッシュ / 入力 オペレーションベル → 正解（正規化後 8/12≈67% ≥ 50%）", () => {
    // 長音符 ー は正規化で除去されるため 正解=12文字 / 連続一致=8文字。
    expect(isPuzzleAnswerAccepted("オペレーションベル", ["オペレーションベルキッシュ"])).toBe(true);
  });
  it("10文字の答え / 5文字の連続を含む → 正解（5/10=50%）", () => {
    expect(isPuzzleAnswerAccepted("アイウエオ", ["アイウエオカキクケコ"])).toBe(true);
  });
  it("10文字の答え / 4文字の連続しか含まない → 不正解（4/10=40% < 50%）", () => {
    expect(isPuzzleAnswerAccepted("アイウエ", ["アイウエオカキクケコ"])).toBe(false);
  });
});

describe("isPuzzleAnswerAccepted — 非連続一致は NG", () => {
  it("答えの文字が入力中に散らばっていても連続条件を満たさなければ不正解", () => {
    // 答え "あいうえおかき"(7文字, 80%=5.6→6連続必要) を 1 文字ずつ分断
    expect(isPuzzleAnswerAccepted("あXいXうXえXおXかXき", ["あいうえおかき"])).toBe(false);
    // 8文字以上でも、最長連続が閾値未満なら不正解（10文字・最長連続4 → 4/10=40% < 50%）
    expect(isPuzzleAnswerAccepted("アイウエXオカキク", ["アイウエオカキクケコ"])).toBe(false);
  });
});

describe("isPuzzleAnswerAccepted — 複数候補・別解", () => {
  it("いずれか 1 候補で条件を満たせば正解", () => {
    expect(isPuzzleAnswerAccepted("答えはりんごです", ["みかん", "りんご", "ぶどう"])).toBe(true);
  });
  it("短い別解（1〜4文字）は完全包含のみ（部分一致は誤判定回避で不許容）", () => {
    // "京" 単独入力は別解 "東京"(2文字) に対して部分一致にならない
    expect(isPuzzleAnswerAccepted("京", ["東京", "みやこ"])).toBe(false);
    // ただし完全包含なら短い別解でも正解
    expect(isPuzzleAnswerAccepted("答えは東京", ["東京"])).toBe(true);
  });
  it("どの候補も満たさなければ不正解", () => {
    expect(isPuzzleAnswerAccepted("ばなな", ["みかん", "りんご"])).toBe(false);
  });
});

describe("judgePuzzleAnswer — 正解理由の判別", () => {
  it("完全一致 → reason=exact", () => {
    const j = judgePuzzleAnswer("鍵", ["鍵"]);
    expect(j).toEqual({ accepted: true, reason: "exact", matchedCandidate: "鍵" });
  });
  it("完全包含 → reason=inclusion", () => {
    const j = judgePuzzleAnswer("答えは鍵です", ["鍵"]);
    expect(j.accepted).toBe(true);
    expect(j.reason).toBe("inclusion");
  });
  it("部分一致 → reason=partial", () => {
    const j = judgePuzzleAnswer("オペレーションベル", ["オペレーションベルキッシュ"]);
    expect(j.accepted).toBe(true);
    expect(j.reason).toBe("partial");
  });
  it("不正解 → reason=null / matchedCandidate=null", () => {
    expect(judgePuzzleAnswer("東", ["東京"])).toEqual({
      accepted: false,
      reason: null,
      matchedCandidate: null,
    });
  });
});

describe("judgePuzzleAnswerAny — matchTypes 連携", () => {
  it("exact モードでは完全包含/部分一致を許容しない（従来どおり）", () => {
    expect(judgePuzzleAnswerAny("答えは鍵です", ["鍵"], ["exact"]).accepted).toBe(false);
    const j = judgePuzzleAnswerAny("鍵", ["鍵"], ["exact"]);
    expect(j).toEqual({ accepted: true, reason: "exact", matchedCandidate: "鍵" });
  });
  it("partial モードでは新しい許容ルールが効く", () => {
    expect(judgePuzzleAnswerAny("答えは鍵です", ["鍵"], ["partial"]).accepted).toBe(true);
    expect(judgePuzzleAnswerAny("オペレーションベル", ["オペレーションベルキッシュ"], ["partial"]).reason).toBe("partial");
  });
});
