/**
 * src/__tests__/puzzle-hint.test.ts
 *
 * 問題ヒント QR の解決を「表示ラベル」ではなく postback の messageId + hintIndex で行う修正の regression。
 * バグ: 同一フェーズに同名ヒント（「ヒント①」）を持つ問題が複数あると、問題2のヒント①をタップしても
 *       先頭の問題1のヒント①が返ってしまう（matchHintFromPhase のラベル先頭一致）。
 * 修正後: messageId + hintIndex で「タップ元の問題」のヒントへ解決される。
 */
import { describe, it, expect } from "vitest";
import {
  buildPuzzleHintPostbackData, parsePuzzleHintPostback, PUZZLE_HINT_POSTBACK_ACTION,
  resolveHintItems, resolvePuzzleHint, type PuzzleHintMessageRow,
} from "@/lib/puzzle-hint";
import { buildQuickReplyFromItems } from "@/lib/line";
import { resolveDisplayQrItems } from "@/lib/hint-qr";
import type { QuickReplyItem } from "@/types";

// 問題行を作る（incorrect_quick_replies にヒントを格納）。
const puzzleRow = (hints: { label: string; hint_text: string }[]): PuzzleHintMessageRow => ({
  kind: "puzzle", hintMode: "always", quickReplies: null,
  incorrectQuickReplies: JSON.stringify(hints.map((h) => ({ action: "hint", label: h.label, hint_text: h.hint_text }))),
});

describe("postback data build/parse", () => {
  const MID = "0123abcd-4567-89ef-0123-456789abcdef";
  it("build→parse 往復で messageId / hintIndex が一致", () => {
    expect(parsePuzzleHintPostback(buildPuzzleHintPostbackData(MID, 0))).toEqual({ messageId: MID, hintIndex: 0 });
    expect(parsePuzzleHintPostback(buildPuzzleHintPostbackData(MID, 3))).toEqual({ messageId: MID, hintIndex: 3 });
  });
  it("action 識別子を含み、LINE postback data 上限300に十分収まる", () => {
    const d = buildPuzzleHintPostbackData(MID, 2);
    expect(d).toContain(`action=${PUZZLE_HINT_POSTBACK_ACTION}`);
    expect(d.length).toBeLessThan(300);
  });
  it("別 action / messageId 空 / hintIndex 不正 → null（legacy へ）", () => {
    expect(parsePuzzleHintPostback("action=resume_work&workId=x")).toBeNull();
    expect(parsePuzzleHintPostback("action=hint_back_to_puzzle&messageId=x")).toBeNull();
    expect(parsePuzzleHintPostback(`action=${PUZZLE_HINT_POSTBACK_ACTION}&messageId=&hintIndex=0`)).toBeNull();
    expect(parsePuzzleHintPostback(`action=${PUZZLE_HINT_POSTBACK_ACTION}&messageId=m&hintIndex=`)).toBeNull();
    expect(parsePuzzleHintPostback(`action=${PUZZLE_HINT_POSTBACK_ACTION}&messageId=m&hintIndex=-1`)).toBeNull();
    expect(parsePuzzleHintPostback(`action=${PUZZLE_HINT_POSTBACK_ACTION}&messageId=m&hintIndex=abc`)).toBeNull();
  });
});

describe("★ regression: 同一フェーズ・同名ヒントの問題が複数 → タップ元の問題のヒントが返る", () => {
  // phase A: 問題1（ヒント①=問題1のヒント①）/ 問題2（ヒント①=問題2のヒント①）
  const p1 = puzzleRow([{ label: "ヒント①", hint_text: "問題1のヒント①" }]);
  const p2 = puzzleRow([{ label: "ヒント①", hint_text: "問題2のヒント①" }]);

  it("問題1の hintIndex=0 → 問題1のヒント①", () => {
    expect(resolvePuzzleHint(p1, 0)?.hint_text).toBe("問題1のヒント①");
  });
  it("問題2の hintIndex=0 → 問題2のヒント①（問題1のヒントは返らない）", () => {
    const h = resolvePuzzleHint(p2, 0);
    expect(h?.hint_text).toBe("問題2のヒント①");
    expect(h?.hint_text).not.toBe("問題1のヒント①");
  });
  it("ラベルが同じ『ヒント①』でも、解決は messageId（行）で分離される", () => {
    expect(resolvePuzzleHint(p1, 0)?.label).toBe("ヒント①");
    expect(resolvePuzzleHint(p2, 0)?.label).toBe("ヒント①");
    expect(resolvePuzzleHint(p1, 0)?.hint_text).not.toBe(resolvePuzzleHint(p2, 0)?.hint_text);
  });
});

describe("同一問題内の ヒント①/② が index で正しく解決される", () => {
  const p = puzzleRow([
    { label: "ヒント①", hint_text: "H1" },
    { label: "ヒント②", hint_text: "H2" },
  ]);
  it("index 0 → ヒント① / index 1 → ヒント②", () => {
    expect(resolvePuzzleHint(p, 0)?.hint_text).toBe("H1");
    expect(resolvePuzzleHint(p, 1)?.hint_text).toBe("H2");
  });
  it("範囲外 index → null（500 にしない）", () => {
    expect(resolvePuzzleHint(p, 5)).toBeNull();
    expect(resolvePuzzleHint(p, 99)).toBeNull();
  });
  it("hintIndex の並びは表示（resolveDisplayQrItems）の hint 並びと一致する", () => {
    const display = resolveDisplayQrItems({
      kind: "puzzle", hintMode: "always", quickReplies: null,
      incorrectQuickReplies: JSON.parse(p.incorrectQuickReplies!) as QuickReplyItem[],
    }).filter((i) => i.action === "hint");
    const resolved = resolveHintItems(p);
    expect(resolved.map((h) => h.hint_text)).toEqual(display.map((h) => (h as { hint_text?: string }).hint_text));
  });
});

describe("非問題 / 空 / 不正 row は安全に空/null", () => {
  it("kind!=puzzle → ヒントなし（resolveHintItems=[] / resolvePuzzleHint=null）", () => {
    const row: PuzzleHintMessageRow = { kind: "normal", hintMode: "always", quickReplies: null, incorrectQuickReplies: puzzleRow([{ label: "ヒント①", hint_text: "x" }]).incorrectQuickReplies };
    expect(resolveHintItems(row)).toEqual([]);
    expect(resolvePuzzleHint(row, 0)).toBeNull();
  });
  it("不正 JSON → 空（throw しない）", () => {
    expect(resolveHintItems({ kind: "puzzle", hintMode: "always", incorrectQuickReplies: "{壊れ" })).toEqual([]);
  });
});

describe("buildQuickReplyFromItems: 問題のヒント QR が postback（messageId + hintIndex）になる", () => {
  const display = resolveDisplayQrItems({
    kind: "puzzle", hintMode: "always", quickReplies: null,
    incorrectQuickReplies: JSON.parse(puzzleRow([
      { label: "ヒント①", hint_text: "H1" }, { label: "ヒント②", hint_text: "H2" },
    ]).incorrectQuickReplies!) as QuickReplyItem[],
  });

  it("sourceMessageId 指定時: hint は postback（data に messageId + 連番 hintIndex）", () => {
    const qr = buildQuickReplyFromItems(display, { sourceMessageId: "msg-2" })!;
    const acts = qr.items.map((i) => i.action);
    expect(acts.every((a) => a.type === "postback")).toBe(true);
    const datas = acts.map((a) => (a as { data: string }).data);
    expect(parsePuzzleHintPostback(datas[0])).toEqual({ messageId: "msg-2", hintIndex: 0 });
    expect(parsePuzzleHintPostback(datas[1])).toEqual({ messageId: "msg-2", hintIndex: 1 });
    // displayText / label は表示ラベルのまま（ユーザー向け表示名は不変）
    expect(qr.items[0].action.type === "postback" && (qr.items[0].action as { displayText?: string }).displayText).toBe("ヒント①");
  });

  it("sourceMessageId 未指定（legacy）: hint は message action（label 送信）＝既存互換", () => {
    const qr = buildQuickReplyFromItems(display)!;
    expect(qr.items[0].action.type).toBe("message");
    expect((qr.items[0].action as { text?: string }).text).toBe("ヒント①");
  });
});

// ── 不正解（wrong-answer）パスのヒント QR も messageId で解決する（webhook route.ts の修正） ──
//   不正解時は puzzles[0] の incorrect_quick_replies をそのまま buildQuickReplyFromItems へ渡す。
//   always モードでは sourceMessageId（=puzzles[0].id）を付与して postback 化し、ラベル一致 fallback
//   （matchHintFromPhase の先頭一致）を踏まない。index は raw incorrect_quick_replies の hint 出現順 =
//   resolveHintItems（resolveDisplayQrItems→hint filter・順序保存）と一致する。
describe("★ regression: 不正解時のヒント QR も messageId で解決（ラベル非依存・index 整合）", () => {
  it("always モード: 不正解ヒント QR は postback（messageId + hintIndex）になる", () => {
    const items = JSON.parse(puzzleRow([{ label: "ヒント①", hint_text: "H1" }]).incorrectQuickReplies!) as QuickReplyItem[];
    const qr = buildQuickReplyFromItems(items, { sourceMessageId: "puzzle-1" })!;
    expect(qr.items[0].action.type).toBe("postback");
    expect(parsePuzzleHintPostback((qr.items[0].action as { data: string }).data)).toEqual({ messageId: "puzzle-1", hintIndex: 0 });
  });

  it("同名『ヒント①』でも、不正解パスが付与する messageId で別問題のヒントに解決される", () => {
    const p1 = puzzleRow([{ label: "ヒント①", hint_text: "問題1のヒント①" }]);
    const p2 = puzzleRow([{ label: "ヒント①", hint_text: "問題2のヒント①" }]);
    // webhook 不正解パス相当: 各問題の incorrect_quick_replies + 自分の messageId で postback 生成。
    const pb1 = parsePuzzleHintPostback((buildQuickReplyFromItems(JSON.parse(p1.incorrectQuickReplies!), { sourceMessageId: "p1" })!.items[0].action as { data: string }).data)!;
    const pb2 = parsePuzzleHintPostback((buildQuickReplyFromItems(JSON.parse(p2.incorrectQuickReplies!), { sourceMessageId: "p2" })!.items[0].action as { data: string }).data)!;
    expect(pb1.messageId).toBe("p1");
    expect(pb2.messageId).toBe("p2");
    // hintIndex は resolveHintItems と一致 → それぞれの問題本文へ解決（ラベルが同じでも取り違えない）。
    expect((resolvePuzzleHint(p1, pb1.hintIndex) as { hint_text?: string })?.hint_text).toBe("問題1のヒント①");
    expect((resolvePuzzleHint(p2, pb2.hintIndex) as { hint_text?: string })?.hint_text).toBe("問題2のヒント①");
  });

  it("複数ヒント: 不正解パスの index が resolveHintItems と一致する（ヒント①=0 / ヒント②=1）", () => {
    const p = puzzleRow([{ label: "ヒント①", hint_text: "H1" }, { label: "ヒント②", hint_text: "H2" }]);
    const qr = buildQuickReplyFromItems(JSON.parse(p.incorrectQuickReplies!), { sourceMessageId: "p" })!;
    const idx0 = parsePuzzleHintPostback((qr.items[0].action as { data: string }).data)!.hintIndex;
    const idx1 = parsePuzzleHintPostback((qr.items[1].action as { data: string }).data)!.hintIndex;
    expect((resolvePuzzleHint(p, idx0) as { hint_text?: string })?.hint_text).toBe("H1");
    expect((resolvePuzzleHint(p, idx1) as { hint_text?: string })?.hint_text).toBe("H2");
  });

  it("on_wrong モード: sourceMessageId を渡さない（legacy message action 維持）＝既存挙動を壊さない", () => {
    // webhook は hintMode==="on_wrong" のとき sourceMessageId を渡さない（resolveHintItems が hint を表示しないため）。
    const items = JSON.parse(puzzleRow([{ label: "ヒント①", hint_text: "x" }]).incorrectQuickReplies!) as QuickReplyItem[];
    const qr = buildQuickReplyFromItems(items)!; // sourceMessageId なし
    expect(qr.items[0].action.type).toBe("message");
  });
});
