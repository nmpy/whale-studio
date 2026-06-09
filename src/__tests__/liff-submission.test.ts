// src/__tests__/liff-submission.test.ts
import { describe, it, expect } from "vitest";
import {
  buildSubmissionAnswers,
  extractAnswerBlocks,
  aggregateByQuestion,
  buildSubmissionsCsv,
  mapAnswerType,
  answerValueToText,
  type SubmissionRow,
} from "@/lib/liff/submission";
import type { SurveyItem } from "@/types";

const items: SurveyItem[] = [
  { id: "q1", question: "満足度", input_type: "radio", options: ["満足", "普通", "不満"] },
  { id: "q2", question: "好きな機能", input_type: "checkbox", options: ["A", "B", "C"] },
  { id: "q3", question: "感想", input_type: "textarea" },
  { question: "氏名", input_type: "text" }, // id 無し → q3 index... idx=3 → "q3"? no, idx-based key
];

describe("mapAnswerType", () => {
  it("radio→singleChoice / checkbox→multipleChoice / text系→text", () => {
    expect(mapAnswerType("radio")).toBe("singleChoice");
    expect(mapAnswerType("checkbox")).toBe("multipleChoice");
    expect(mapAnswerType("text")).toBe("text");
    expect(mapAnswerType("textarea")).toBe("text");
    expect(mapAnswerType(undefined)).toBe("text");
  });
});

describe("buildSubmissionAnswers", () => {
  it("survey_items + 回答マップ → ブロック配列（空回答はスキップ）", () => {
    const blocks = buildSubmissionAnswers(items, { q1: "満足", q2: ["A", "C"], q3: "", q4: "（無関係）" });
    // q3 は空 → スキップ。id無し設問(idx3)は key "q3"... 実際は items[3].id 無し→`q3`
    const ids = blocks.map((b) => b.blockId);
    expect(ids).toContain("q1");
    expect(ids).toContain("q2");
    const q1 = blocks.find((b) => b.blockId === "q1")!;
    expect(q1).toMatchObject({ blockType: "survey", label: "満足度", answerType: "singleChoice", value: "満足" });
    const q2 = blocks.find((b) => b.blockId === "q2")!;
    expect(q2.answerType).toBe("multipleChoice");
    expect(q2.value).toEqual(["A", "C"]);
  });

  it("items / answers が無くても落ちない", () => {
    expect(buildSubmissionAnswers(undefined, null)).toEqual([]);
    expect(buildSubmissionAnswers([], {})).toEqual([]);
  });
});

describe("extractAnswerBlocks（防御的）", () => {
  it("{ blocks: [...] } 形式", () => {
    const r = extractAnswerBlocks({ blocks: [{ blockId: "q1", blockType: "survey", label: "満足度", answerType: "singleChoice", value: "満足" }] });
    expect(r).toHaveLength(1);
    expect(r[0].value).toBe("満足");
  });
  it("直接の配列も受理", () => {
    expect(extractAnswerBlocks([{ blockId: "x", label: "L", value: "v" }])).toHaveLength(1);
  });
  it("未知の answerType は text に丸める / value 欠損は空文字 / 配列は文字列化", () => {
    const r = extractAnswerBlocks({ blocks: [{ blockId: "a", answerType: "weird" }, { blockId: "b", value: [1, 2] }] });
    expect(r[0].answerType).toBe("text");
    expect(r[0].value).toBe("");
    expect(r[1].value).toEqual(["1", "2"]);
  });
  it("不正な入力（null / 文字列 / 数値）→ 空配列", () => {
    expect(extractAnswerBlocks(null)).toEqual([]);
    expect(extractAnswerBlocks("x")).toEqual([]);
    expect(extractAnswerBlocks({ foo: 1 })).toEqual([]);
  });
});

describe("aggregateByQuestion", () => {
  const rows: SubmissionRow[] = [
    { lineUserId: "U1", displayName: "A", createdAt: "2026-06-01T00:00:00Z", blocks: [
      { blockId: "q1", blockType: "survey", label: "満足度", answerType: "singleChoice", value: "満足" },
      { blockId: "q2", blockType: "survey", label: "感想", answerType: "text", value: "良かった" },
    ]},
    { lineUserId: "U2", displayName: "B", createdAt: "2026-06-02T00:00:00Z", blocks: [
      { blockId: "q1", blockType: "survey", label: "満足度", answerType: "singleChoice", value: "満足" },
      { blockId: "q2", blockType: "survey", label: "感想", answerType: "text", value: "" },
    ]},
  ];
  it("選択式は選択肢ごとの件数 + パーセント（多い順）", () => {
    const agg = aggregateByQuestion(rows);
    const q1 = agg.find((a) => a.blockId === "q1")!;
    expect(q1.answerType).toBe("singleChoice");
    expect(q1.responseCount).toBe(2);
    expect(q1.choices).toEqual([{ value: "満足", count: 2, percent: 100 }]);
  });
  it("自由記述は空を除いて一覧化", () => {
    const agg = aggregateByQuestion(rows);
    const q2 = agg.find((a) => a.blockId === "q2")!;
    expect(q2.texts).toHaveLength(1);
    expect(q2.texts![0].value).toBe("良かった");
    expect(q2.responseCount).toBe(1);
  });
});

describe("buildSubmissionsCsv", () => {
  it("BOM 付き + ヘッダー + 回答1ブロック=1行", () => {
    const csv = buildSubmissionsCsv([
      { lineUserId: "U1", displayName: "なみ", createdAt: "2026-06-01T00:00:00Z", blocks: [
        { blockId: "q1", blockType: "survey", label: "満足度", answerType: "singleChoice", value: "満足" },
      ]},
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(csv).toContain("回答日時,LINE userId,表示名,設問タイトル,回答,blockId,answerType");
    expect(csv).toContain("満足度");
    expect(csv).toContain("なみ");
  });
  it("カンマ/改行/引用符はエスケープされる", () => {
    const csv = buildSubmissionsCsv([
      { lineUserId: null, displayName: 'a,b"c', createdAt: "t", blocks: [
        { blockId: "q", blockType: "survey", label: "自由", answerType: "text", value: "1行目\n2行目" },
      ]},
    ]);
    expect(csv).toContain('"a,b""c"');
    expect(csv).toContain('"1行目\n2行目"');
  });
  it("回答ゼロの submission も1行出る", () => {
    const csv = buildSubmissionsCsv([{ lineUserId: "U", displayName: null, createdAt: "t", blocks: [] }]);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines).toHaveLength(2); // header + 1
  });
});

describe("answerValueToText", () => {
  it("配列は / 区切り", () => {
    expect(answerValueToText(["A", "B"])).toBe("A / B");
    expect(answerValueToText("x")).toBe("x");
  });
});
