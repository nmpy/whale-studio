/**
 * src/__tests__/flex-keyword-check.test.ts
 * Flex action.text ↔ 応答キーワードの「フェーズズレ / 不在」検出（純ロジック）。
 */
import { describe, it, expect } from "vitest";
import {
  extractFlexMessageActionTexts,
  buildResponseKeywordPhaseIndex,
  findFlexKeywordPhaseIssues,
  normFlexKeyword,
} from "@/app/oas/[id]/works/[workId]/messages/_flex-keyword-check";

const flex = (texts: string[]) =>
  JSON.stringify({
    type: "bubble",
    body: {
      type: "box", layout: "vertical",
      contents: texts.map((t) => ({
        type: "button",
        action: { type: "message", label: "話しかける", text: t },
      })),
    },
  });

describe("extractFlexMessageActionTexts", () => {
  it("message-action の text を再帰収集（重複排除・出現順）", () => {
    expect(extractFlexMessageActionTexts(flex(["たこぴに話しかける", "カメチに話しかける", "たこぴに話しかける"])))
      .toEqual(["たこぴに話しかける", "カメチに話しかける"]);
  });
  it("uri/postback action は無視", () => {
    const j = JSON.stringify({ action: { type: "uri", uri: "https://x", label: "L" } });
    expect(extractFlexMessageActionTexts(j)).toEqual([]);
  });
  it("空 / 不正 JSON は []", () => {
    expect(extractFlexMessageActionTexts(null)).toEqual([]);
    expect(extractFlexMessageActionTexts("")).toEqual([]);
    expect(extractFlexMessageActionTexts("{not json")).toEqual([]);
  });
});

describe("buildResponseKeywordPhaseIndex", () => {
  it("kind=response のみ索引化・改行分割・正規化・phaseId=null=共通", () => {
    const idx = buildResponseKeywordPhaseIndex([
      { kind: "response", trigger_keyword: "たこぴに話しかける", phase: { id: "P_umi" } },
      { kind: "response", trigger_keyword: "ヘルプ\nhelp", phase: null }, // 共通
      { kind: "normal", trigger_keyword: "無視される", phase: { id: "P_x" } },
    ]);
    expect([...(idx.get("たこぴに話しかける") ?? [])]).toEqual(["P_umi"]);
    expect(idx.get("ヘルプ")?.has(null)).toBe(true);
    expect(idx.has("無視される")).toBe(false);
  });
  it("非配列/空でも落ちない", () => {
    expect(buildResponseKeywordPhaseIndex(null).size).toBe(0);
    expect(buildResponseKeywordPhaseIndex([]).size).toBe(0);
  });
});

describe("findFlexKeywordPhaseIssues", () => {
  // 応答キーワードは「海の仲間」フェーズ(P_umi)にのみ存在。Flex は「出会い」(P_deai) に在る。
  const index = buildResponseKeywordPhaseIndex([
    { kind: "response", trigger_keyword: "たこぴに話しかける", phase: { id: "P_umi" } },
    { kind: "response", trigger_keyword: "カメチに話しかける", phase: { id: "P_umi" } },
  ]);

  it("別フェーズにのみ存在 → wrong_phase（今回のバグ）", () => {
    const issues = findFlexKeywordPhaseIssues({
      flexJson: flex(["たこぴに話しかける", "カメチに話しかける"]),
      flexMessagePhaseId: "P_deai",
      index,
    });
    expect(issues.map((i) => i.status)).toEqual(["wrong_phase", "wrong_phase"]);
    expect(issues[0].otherPhaseIds).toEqual(["P_umi"]);
  });

  it("同フェーズに在る → 警告なし", () => {
    const issues = findFlexKeywordPhaseIssues({
      flexJson: flex(["たこぴに話しかける"]),
      flexMessagePhaseId: "P_umi",
      index,
    });
    expect(issues).toEqual([]);
  });

  it("どこにも無い → missing", () => {
    const issues = findFlexKeywordPhaseIssues({
      flexJson: flex(["くらげに話しかける"]),
      flexMessagePhaseId: "P_deai",
      index,
    });
    expect(issues).toEqual([{ text: "くらげに話しかける", status: "missing", otherPhaseIds: [] }]);
  });

  it("共通(phaseId=null)に在れば、どのフェーズでも警告なし", () => {
    const gIndex = buildResponseKeywordPhaseIndex([
      { kind: "response", trigger_keyword: "たこぴに話しかける", phase: null },
    ]);
    expect(findFlexKeywordPhaseIssues({ flexJson: flex(["たこぴに話しかける"]), flexMessagePhaseId: "P_deai", index: gIndex })).toEqual([]);
  });
});
