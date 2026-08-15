/**
 * src/__tests__/liff-hint-search.test.ts
 *
 * 検索型ヒントページ (page_type="hint_search") の純ロジックを検証する。
 *  - normalizeHintSearchText / tokenizeHintSearchQuery: 表記ゆれ吸収と分かち書き
 *  - normalizeHintSearchEntries: 壊れた settings_json でも落ちない / 空項目を出さない
 *  - searchHintEntries: 完全一致・部分一致・alias・複数ワード・ランキング・0 件
 *  - normalizeHintSearchGuide / resolveGuidePath: 質問ツリー
 *  - redactPlayerSettings: 公開 API がヒント本文を返さないこと（ネタバレ防止の要）
 *  - liffPageConfigSettingsSchema: hint_search_* の validation
 */
import { describe, it, expect } from "vitest";
import {
  normalizeHintSearchText,
  tokenizeHintSearchQuery,
  normalizeHintSearchEntries,
  normalizeHintSearchGuide,
  resolveGuidePath,
  searchHintEntries,
  spoilerLevelForHint,
  toDetail,
  toListItem,
  HINT_SEARCH_MAX_TOKENS,
} from "@/lib/liff/hint-search";
import { redactPlayerSettings, PLAYER_REDACTED_SETTINGS_KEYS } from "@/lib/liff/player-settings";
import { openedStatusText } from "@/components/liff/hint-search/opened-store";
import { liffPageConfigSettingsSchema } from "@/lib/validations";
import { normalizeLiffPageType } from "@/types";
import { HINT_SEARCH_COPY } from "@/components/liff/hint-search/copy";

// ── テスト用のヒントデータ ────────────────────────────────────
const ENTRIES_RAW = [
  {
    id: "e-keyboard",
    internal_title: "P7 - S.I.R.E.N施設特定後の次行動",
    search_result_label: "キーボードについて",
    list_title: "キーボード",
    category_label: "持ち物・道具",
    keywords: ["キーボード", "机"],
    aliases: ["keyboard", "きーぼーど"],
    hints: [{ level: 1, body: "ヒント1本文" }, { level: 2, body: "ヒント2本文" }],
    answer: "答え本文",
  },
  {
    id: "e-desk",
    search_result_label: "机の下にあるものについて",
    keywords: ["机", "デスク"],
    hints: [{ level: 1, body: "机のヒント" }],
  },
  {
    id: "e-person",
    search_result_label: "ある人物について",
    aliases: ["シャーリ・プラグマトン"],
    hints: [{ level: 1, body: "人物のヒント" }],
  },
  // 空項目（ラベルなし / 本文なし）はプレイヤー側に出さない
  { id: "e-empty-label", search_result_label: "   ", hints: [{ level: 1, body: "x" }] },
  { id: "e-empty-body",  search_result_label: "空っぽ", hints: [{ level: 1, body: "   " }] },
];

const entries = normalizeHintSearchEntries(ENTRIES_RAW);
const labelsOf = (q: string) => searchHintEntries(entries, q).map((m) => m.entry.label);

describe("normalizeHintSearchText — 表記ゆれ吸収", () => {
  it("前後の空白を除去する", () => {
    expect(normalizeHintSearchText("  キーボード  ")).toBe(normalizeHintSearchText("キーボード"));
  });
  it("大文字 / 小文字を同一視する", () => {
    expect(normalizeHintSearchText("Keyboard")).toBe(normalizeHintSearchText("keyboard"));
  });
  it("全角英数 → 半角に正規化する", () => {
    expect(normalizeHintSearchText("ＫＥＹ１")).toBe("key1");
  });
  it("半角カナ → 全角カナ → ひらがなに揃う", () => {
    expect(normalizeHintSearchText("ｷｰﾎﾞｰﾄﾞ")).toBe(normalizeHintSearchText("キーボード"));
  });
  it("カタカナ / ひらがなを同一視する（長音記号は保持）", () => {
    expect(normalizeHintSearchText("キーボード")).toBe("きーぼーど");
    expect(normalizeHintSearchText("きーぼーど")).toBe("きーぼーど");
  });
  it("非文字列は空文字（settings_json が壊れていても落ちない）", () => {
    expect(normalizeHintSearchText(undefined)).toBe("");
    expect(normalizeHintSearchText(null)).toBe("");
    expect(normalizeHintSearchText(42)).toBe("");
  });
});

describe("tokenizeHintSearchQuery — 複数ワード", () => {
  it("半角スペースで分割する", () => {
    expect(tokenizeHintSearchQuery("机 キーボード")).toEqual(["机", "きーぼーど"]);
  });
  it("全角スペースでも分割する", () => {
    expect(tokenizeHintSearchQuery("机　キーボード")).toEqual(["机", "きーぼーど"]);
  });
  it("空入力 / 空白のみは空配列", () => {
    expect(tokenizeHintSearchQuery("")).toEqual([]);
    expect(tokenizeHintSearchQuery("   　 ")).toEqual([]);
  });
  it("重複トークンは 1 つにまとめる", () => {
    expect(tokenizeHintSearchQuery("机 机 机")).toEqual(["机"]);
  });
  it("トークン数には上限がある（長文入力対策）", () => {
    const many = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    expect(tokenizeHintSearchQuery(many).length).toBe(HINT_SEARCH_MAX_TOKENS);
  });
  it("極端に長い 1 語も切り詰めて処理する（例外を投げない）", () => {
    expect(() => tokenizeHintSearchQuery("あ".repeat(50_000))).not.toThrow();
    expect(tokenizeHintSearchQuery("あ".repeat(50_000))[0].length).toBeLessThanOrEqual(100);
  });
});

describe("normalizeHintSearchEntries — 壊れたデータ耐性 / 空項目除外", () => {
  it("配列以外は空配列", () => {
    expect(normalizeHintSearchEntries(undefined)).toEqual([]);
    expect(normalizeHintSearchEntries({})).toEqual([]);
    expect(normalizeHintSearchEntries("x")).toEqual([]);
  });
  it("ラベルが空 / 本文も答えも空の項目は落とす", () => {
    const ids = entries.map((e) => e.id);
    expect(ids).not.toContain("e-empty-label");
    expect(ids).not.toContain("e-empty-body");
    expect(ids).toEqual(["e-keyboard", "e-desk", "e-person"]);
  });
  it("段階ヒントの level は配列順に 1 から振り直す", () => {
    const [e] = normalizeHintSearchEntries([
      { id: "x", search_result_label: "L", hints: [{ level: 9, body: "a" }, { level: 3, body: "b" }] },
    ]);
    expect(e.hints.map((h) => h.level)).toEqual([1, 2]);
  });
  it("段階ヒントが無くても答えがあれば残す", () => {
    const [e] = normalizeHintSearchEntries([
      { id: "x", search_result_label: "L", hints: [], answer: "答え" },
    ]);
    expect(e.answer).toBe("答え");
  });
  it("list_title 未設定なら search_result_label にフォールバックする", () => {
    const desk = entries.find((e) => e.id === "e-desk")!;
    expect(desk.listTitle).toBe("机の下にあるものについて");
  });
  it("id 未設定でも配列位置から安定 ID を振る", () => {
    const [e] = normalizeHintSearchEntries([{ search_result_label: "L", hints: [{ level: 1, body: "a" }] }]);
    expect(e.id).toBe("idx_0");
  });
});

describe("searchHintEntries — 一致条件", () => {
  it("完全一致でヒットする", () => {
    expect(labelsOf("キーボードについて")).toContain("キーボードについて");
  });
  it("部分一致でヒットする（登録: キーボード / 入力: キー）", () => {
    expect(labelsOf("キー")).toContain("キーボードについて");
  });
  it("部分一致でヒットする（登録: シャーリ・プラグマトン / 入力: シャーリ）", () => {
    expect(labelsOf("シャーリ")).toEqual(["ある人物について"]);
  });
  it("大文字 / 小文字の違いを吸収する", () => {
    expect(labelsOf("KEYBOARD")).toContain("キーボードについて");
  });
  it("全角 / 半角の違いを吸収する", () => {
    expect(labelsOf("ｷｰﾎﾞｰﾄﾞ")).toContain("キーボードについて");
  });
  it("前後の空白を無視する", () => {
    expect(labelsOf("   キーボード   ")).toContain("キーボードについて");
  });
  it("ひらがな入力でもカタカナ登録にヒットする", () => {
    expect(labelsOf("きーぼーど")).toContain("キーボードについて");
  });
  it("aliases でヒットする", () => {
    expect(labelsOf("keyboard")).toContain("キーボードについて");
  });
  it("複数件ヒットする（keywords 共有）", () => {
    expect(labelsOf("机").length).toBe(2);
  });
  it("0 件のときは空配列（勝手に類似候補を返さない）", () => {
    expect(labelsOf("そんな言葉はない")).toEqual([]);
  });
  it("空入力は 0 件（全件を返さない）", () => {
    expect(labelsOf("")).toEqual([]);
    expect(labelsOf("   ")).toEqual([]);
  });
  it("internal_title は検索対象に含めない（内部シナリオ名から漏らさない）", () => {
    expect(labelsOf("S.I.R.E.N")).toEqual([]);
    expect(labelsOf("P7")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// 表記ゆれをどこまで吸収するか（＝ UI の注記が約束してよい範囲）
//
// 初期画面の注記「ひらがな・カタカナ・全角・半角の違いは判定に影響しません。」が
// 実装と食い違わないよう、吸収する差分／しない差分をここで固定する。
// 漢字と読み仮名は **吸収しない**。運用は keywords / aliases への複数登録で行う
// （辞書・形態素解析・外部検索ライブラリは導入しない方針）。
// ─────────────────────────────────────────────────────────────────
describe("表記ゆれの吸収範囲 — UI 注記との整合", () => {
  const kanjiOnly = normalizeHintSearchEntries([
    { id: "k", search_result_label: "机について", keywords: ["机"], hints: [{ level: 1, body: "x" }] },
  ]);
  const both = normalizeHintSearchEntries([
    // 運用対応: 漢字表記と読み仮名の両方を登録する
    { id: "b", search_result_label: "机について", keywords: ["机", "つくえ"], aliases: ["デスク"], hints: [{ level: 1, body: "x" }] },
  ]);
  const hit = (entries: typeof kanjiOnly, q: string) => searchHintEntries(entries, q).length;

  it("注記に「漢字」を含めない（実装が漢字↔かなを吸収しないため）", () => {
    expect(HINT_SEARCH_COPY.inputNote).not.toContain("漢字");
    expect(HINT_SEARCH_COPY.inputNote).toBe("ひらがな・カタカナ・全角・半角の違いは判定に影響しません。");
  });

  it("漢字表記のみ登録 → 同じ漢字で HIT する", () => {
    expect(hit(kanjiOnly, "机")).toBe(1);
  });

  it("漢字表記のみ登録 → 読み仮名では HIT しない（吸収しないことを明示）", () => {
    expect(hit(kanjiOnly, "つくえ")).toBe(0);
    expect(hit(kanjiOnly, "ツクエ")).toBe(0);
  });

  it("漢字と読み仮名を両方 keywords 登録すれば、どちらでも HIT する", () => {
    expect(hit(both, "机")).toBe(1);
    expect(hit(both, "つくえ")).toBe(1);
    expect(hit(both, "ツクエ")).toBe(1);   // カタカナ差はここで吸収される
    expect(hit(both, "デスク")).toBe(1);   // aliases 経由
  });

  it("ひらがな / カタカナ差は吸収される", () => {
    const e = normalizeHintSearchEntries([
      { id: "x", search_result_label: "キーボードについて", keywords: ["キーボード"], hints: [{ level: 1, body: "y" }] },
    ]);
    expect(hit(e, "キーボード")).toBe(1);
    expect(hit(e, "きーぼーど")).toBe(1);
  });

  it("全角 / 半角差は吸収される（英数字・カナ・スペース）", () => {
    const e = normalizeHintSearchEntries([
      { id: "x", search_result_label: "PC1 について", keywords: ["PC1", "キーボード"], hints: [{ level: 1, body: "y" }] },
    ]);
    // 全角英数字 → 半角
    expect(hit(e, "ＰＣ１")).toBe(1);
    expect(hit(e, "PC1")).toBe(1);
    // 半角カナ → 全角カナ
    expect(hit(e, "ｷｰﾎﾞｰﾄﾞ")).toBe(1);
    // 全角スペース区切りでも分割される
    expect(hit(e, "ＰＣ１　キーボード")).toBe(1);
  });

  it("大文字 / 小文字差も吸収される（注記では触れていないが実装済み）", () => {
    const e = normalizeHintSearchEntries([
      { id: "x", search_result_label: "Keyboard", aliases: ["KEYBOARD"], hints: [{ level: 1, body: "y" }] },
    ]);
    expect(hit(e, "keyboard")).toBe(1);
    expect(hit(e, "KeYbOaRd")).toBe(1);
  });
});

describe("searchHintEntries — ランキング", () => {
  it("複数ワードは「両方に当たるもの」を上位にする", () => {
    // "机" は 2 件に当たるが、"キーボード" も当たるのは e-keyboard だけ。
    expect(labelsOf("机 キーボード")[0]).toBe("キーボードについて");
  });
  it("title 完全一致が keyword 部分一致より上に来る", () => {
    const ranked = normalizeHintSearchEntries([
      { id: "a", search_result_label: "部分だけ", keywords: ["キーボード関連"], hints: [{ level: 1, body: "x" }] },
      { id: "b", search_result_label: "キーボード", hints: [{ level: 1, body: "x" }] },
    ]);
    expect(searchHintEntries(ranked, "キーボード").map((m) => m.entry.id)).toEqual(["b", "a"]);
  });
  it("同スコアなら登録順を保つ（安定ソート）", () => {
    const same = normalizeHintSearchEntries([
      { id: "a", search_result_label: "机A", hints: [{ level: 1, body: "x" }] },
      { id: "b", search_result_label: "机B", hints: [{ level: 1, body: "x" }] },
    ]);
    expect(searchHintEntries(same, "机").map((m) => m.entry.id)).toEqual(["a", "b"]);
  });
});

describe("toDetail — プレイヤーへ渡す形", () => {
  it("答えの本文は含めず、有無だけを返す", () => {
    const detail = toDetail(entries.find((e) => e.id === "e-keyboard")!);
    expect(detail.hasAnswer).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("答え本文");
  });
  it("検索用キーワード / 別名は含めない", () => {
    const json = JSON.stringify(toDetail(entries.find((e) => e.id === "e-keyboard")!));
    expect(json).not.toContain("keyword");
    expect(json).not.toContain("きーぼーど");
  });
});

describe("toListItem — 全ヒント一覧が返す形", () => {
  const keyboard = entries.find((e) => e.id === "e-keyboard")!;

  it("id と プレイヤー向け表示タイトル (listTitle) だけを返す", () => {
    expect(toListItem(keyboard)).toEqual({ id: "e-keyboard", label: "キーボード" });
  });

  it("internal_title（フェーズ番号 / 内部シナリオ名）を返さない", () => {
    const json = JSON.stringify(entries.map(toListItem));
    expect(json).not.toContain("P7");
    expect(json).not.toContain("S.I.R.E.N");
    expect(json).not.toContain("internal");
  });

  it("段階ヒント本文・答えを返さない", () => {
    const json = JSON.stringify(entries.map(toListItem));
    expect(json).not.toContain("ヒント1本文");
    expect(json).not.toContain("ヒント2本文");
    expect(json).not.toContain("答え本文");
    expect(json).not.toContain("hints");
    expect(json).not.toContain("answer");
  });

  it("検索用キーワード・別名を返さない", () => {
    const json = JSON.stringify(entries.map(toListItem));
    expect(json).not.toContain("keyword");
    expect(json).not.toContain("シャーリ・プラグマトン");
  });

  it("list_title 未設定のヒントは search_result_label にフォールバックする", () => {
    expect(toListItem(entries.find((e) => e.id === "e-desk")!).label).toBe("机の下にあるものについて");
  });

  it("空項目は一覧にも出ない（検索結果と同じ除外規則）", () => {
    const ids = entries.map(toListItem).map((i) => i.id);
    expect(ids).toEqual(["e-keyboard", "e-desk", "e-person"]);
  });
});

describe("spoilerLevelForHint — ネタバレ度", () => {
  it("段階 1/2/3 が 低/中/高 になる", () => {
    expect(spoilerLevelForHint(1)).toBe("low");
    expect(spoilerLevelForHint(2)).toBe("medium");
    expect(spoilerLevelForHint(3)).toBe("high");
  });
});

describe("normalizeHintSearchGuide / resolveGuidePath — 質問ツリー", () => {
  const GUIDE = [
    {
      label: "手元のものの扱い方がわからない",
      question: "そのものについて、どこまで確認されましたか。",
      options: [
        { label: "まだ全体を見ていない", hint_id: "e-keyboard" },
        { label: "全体は見たが、意味が掴めない", hint_id: "e-desk" },
      ],
    },
    { label: "次に何をすればよいかわからない", hint_id: "e-person" },
    // 子も hint_id も無い行き止まりは出さない
    { label: "行き止まり" },
    // label が空の行も出さない
    { label: "   ", hint_id: "e-desk" },
  ];
  const root = normalizeHintSearchGuide(GUIDE);

  it("行き止まり / 空ラベルの選択肢は落とす", () => {
    expect(root.map((n) => n.label)).toEqual([
      "手元のものの扱い方がわからない",
      "次に何をすればよいかわからない",
    ]);
  });
  it("path=[] はルート（node なし）", () => {
    const r = resolveGuidePath(root, []);
    expect(r.ok).toBe(true);
    expect(r.node).toBeNull();
    expect(r.breadcrumb).toEqual([]);
  });
  it("path を辿るとパンくずが積み上がる", () => {
    const r = resolveGuidePath(root, [0, 1]);
    expect(r.ok).toBe(true);
    expect(r.breadcrumb).toEqual(["手元のものの扱い方がわからない", "全体は見たが、意味が掴めない"]);
    expect(r.node?.hintId).toBe("e-desk");
  });
  it("存在しない選択肢の path は ok=false", () => {
    expect(resolveGuidePath(root, [99]).ok).toBe(false);
    expect(resolveGuidePath(root, [1, 0]).ok).toBe(false);
  });
  it("配列以外でも落ちない", () => {
    expect(normalizeHintSearchGuide(undefined)).toEqual([]);
    expect(normalizeHintSearchGuide("x")).toEqual([]);
  });
});

describe("redactPlayerSettings — 公開 API からのネタバレ除去", () => {
  it("ヒント本文と質問ツリーを settings_json から落とす", () => {
    const out = redactPlayerSettings({
      header_title: "OPERATION",
      hint_search_entries: ENTRIES_RAW,
      hint_search_guide_options: [{ label: "手元のものの扱い方がわからない" }],
      hint_search_guide_question: "いま、どちらに近い状態でしょうか。",
    }) as Record<string, unknown>;
    expect(out.hint_search_entries).toBeUndefined();
    expect(out.hint_search_guide_options).toBeUndefined();
    // ネタバレにならない設定は残す
    expect(out.header_title).toBe("OPERATION");
    expect(out.hint_search_guide_question).toBe("いま、どちらに近い状態でしょうか。");
    // 本文・キーワード・答えが 1 文字も残らない
    const json = JSON.stringify(out);
    expect(json).not.toContain("ヒント1本文");
    expect(json).not.toContain("答え本文");
    expect(json).not.toContain("キーボードについて");
  });
  it("元のオブジェクトを書き換えない", () => {
    const src = { hint_search_entries: [{ search_result_label: "x", hints: [] }] };
    redactPlayerSettings(src);
    expect(src.hint_search_entries).toBeDefined();
  });
  it("オブジェクト以外はそのまま返す（壊れたデータで 500 にしない）", () => {
    expect(redactPlayerSettings(null)).toBeNull();
    expect(redactPlayerSettings([1, 2])).toEqual([1, 2]);
  });
  it("除去対象キーの一覧は空でない", () => {
    expect(PLAYER_REDACTED_SETTINGS_KEYS.length).toBeGreaterThan(0);
  });
});

describe("openedStatusText — ヒント一覧のステータス", () => {
  const base = { id: "x", label: "キーボード", updatedAt: 0 };
  it("一部だけ開示済みなら「表示済 ／ 残りN件」", () => {
    expect(openedStatusText({ ...base, revealedHints: 2, totalHints: 3, hasAnswer: false, answerRevealed: false }))
      .toBe("ヒント1・2を表示済 ／ 残り1件");
  });
  it("答えが未開示なら残り件数に含める", () => {
    expect(openedStatusText({ ...base, revealedHints: 1, totalHints: 1, hasAnswer: true, answerRevealed: false }))
      .toBe("ヒント1を表示済 ／ 残り1件");
  });
  it("すべて開示済みなら「すべて表示済」", () => {
    expect(openedStatusText({ ...base, revealedHints: 2, totalHints: 2, hasAnswer: true, answerRevealed: true }))
      .toBe("すべて表示済");
  });
});

describe("liffPageConfigSettingsSchema — hint_search_* の validation", () => {
  it("未指定でも success（既存ページ互換）", () => {
    expect(liffPageConfigSettingsSchema.safeParse({}).success).toBe(true);
  });
  it("空配列でも success", () => {
    expect(liffPageConfigSettingsSchema.safeParse({ hint_search_entries: [] }).success).toBe(true);
  });
  it("通常のヒント項目を受理する", () => {
    expect(liffPageConfigSettingsSchema.safeParse({ hint_search_entries: ENTRIES_RAW }).success).toBe(true);
  });
  it("段階ヒントが 4 段以上は reject", () => {
    const r = liffPageConfigSettingsSchema.safeParse({
      hint_search_entries: [{
        search_result_label: "L",
        hints: [1, 2, 3, 4].map((level) => ({ level: Math.min(level, 3), body: "x" })),
      }],
    });
    expect(r.success).toBe(false);
  });
  it("ネストした質問ツリーを受理する", () => {
    const r = liffPageConfigSettingsSchema.safeParse({
      hint_search_guide_question: "いま、どちらに近い状態でしょうか。",
      hint_search_guide_options: [
        { label: "A", question: "Q2", options: [{ label: "A-1", hint_id: "e1" }] },
        { label: "B", hint_id: "e2" },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("normalizeLiffPageType — 既存種別を壊さない", () => {
  it("hint_search を新種別として受理する", () => {
    expect(normalizeLiffPageType("hint_search")).toBe("hint_search");
  });
  it("既存の hint / hint_site は従来どおり hint のまま", () => {
    expect(normalizeLiffPageType("hint")).toBe("hint");
    expect(normalizeLiffPageType("hint_site")).toBe("hint");
  });
  it("未知の値は default", () => {
    expect(normalizeLiffPageType("hint_searchX")).toBe("default");
  });
});
