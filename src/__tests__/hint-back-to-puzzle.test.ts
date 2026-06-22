/**
 * src/__tests__/hint-back-to-puzzle.test.ts
 *
 * ヒント導線 QR「問題に戻る」タップ → 問題再表示の照合（不正解判定より前に処理する）。
 * バグ: 「問題に戻る」が message action のテキストとして問題の回答扱いになり不正解が送られていた。
 */
import { describe, it, expect } from "vitest";
import { matchBackToPuzzle, DEFAULT_BACK_TO_PUZZLE_LABEL, buildBackToPuzzlePostbackData, parseBackToPuzzlePostback, BACK_TO_PUZZLE_POSTBACK_ACTION, type BackToPuzzleCandidate } from "@/lib/hint-back-to-puzzle";
import { buildQuickReplyFromItems } from "@/lib/line";
import { resolveDisplayQrItems } from "@/lib/hint-qr";

const norm = { strict: (s: string) => s.trim(), loose: (s: string) => s.trim().toLowerCase().replace(/\s+/g, "") };

const HINTS = (over: Record<string, unknown> = {}) => JSON.stringify([
  { action: "hint", label: "ヒント①", value: "ヒント１", hint_text: "ヒントじゃ。", ...over },
]);

const puzzle = (over: Partial<BackToPuzzleCandidate> = {}): BackToPuzzleCandidate => ({
  id: "pz-1", kind: "puzzle", incorrectQuickReplies: HINTS(), ...over,
});

describe("matchBackToPuzzle — 「問題に戻る」タップ照合", () => {
  it("ケース1: 既定ラベル「問題に戻る」をタップ → 戻る対象の問題 messageId を返す（不正解にしない）", () => {
    const r = matchBackToPuzzle([puzzle()], "問題に戻る", norm);
    expect(r).toEqual({ messageId: "pz-1", cancelLabel: DEFAULT_BACK_TO_PUZZLE_LABEL });
  });

  it("カスタム hint_cancel_label（例: もどる）をタップ → 一致する", () => {
    const r = matchBackToPuzzle([puzzle({ incorrectQuickReplies: HINTS({ hint_cancel_label: "もどる" }) })], "もどる", norm);
    expect(r?.messageId).toBe("pz-1");
  });

  it("カスタム設定があっても既定「問題に戻る」（既存データ互換）でも一致する", () => {
    const r = matchBackToPuzzle([puzzle({ incorrectQuickReplies: HINTS({ hint_cancel_label: "もどる" }) })], "問題に戻る", norm);
    expect(r?.messageId).toBe("pz-1");
  });

  it("ケース3: 通常の誤答テキストは「問題に戻る」照合に一致しない（不正解フローへ流す）", () => {
    expect(matchBackToPuzzle([puzzle()], "ほし", norm)).toBeNull();
    expect(matchBackToPuzzle([puzzle()], "まったく違う回答", norm)).toBeNull();
  });

  it("非問題メッセージ（kind!=puzzle）は対象外", () => {
    expect(matchBackToPuzzle([puzzle({ kind: "normal" })], "問題に戻る", norm)).toBeNull();
  });

  it("ヒント未設定の問題（incorrect_quick_replies に hint 無し）は対象外", () => {
    expect(matchBackToPuzzle([puzzle({ incorrectQuickReplies: JSON.stringify([{ action: "text", label: "x" }]) })], "問題に戻る", norm)).toBeNull();
    expect(matchBackToPuzzle([puzzle({ incorrectQuickReplies: null })], "問題に戻る", norm)).toBeNull();
  });

  it("ケースC: 候補が1つだけなら既存互換で再表示（messageId 返却）", () => {
    expect(matchBackToPuzzle([puzzle({ id: "only" })], "問題に戻る", norm)?.messageId).toBe("only");
  });

  it("ケースD: 同一ラベルの問題が複数・frontier 無し → 先頭固定にせず null（誤った問題を再表示しない）", () => {
    const msgs = [puzzle({ id: "a" }), puzzle({ id: "b" })];
    expect(matchBackToPuzzle(msgs, "問題に戻る", norm)).toBeNull();
  });

  it("ケースA(fallback): 複数候補でも frontier（直近送信）で1つに絞れれば、その問題＝直前に出題された問題を返す", () => {
    const msgs = [puzzle({ id: "p1" }), puzzle({ id: "p2" })];
    // ユーザーは p2 のヒントを見ている → frontier に p2 がある
    expect(matchBackToPuzzle(msgs, "問題に戻る", norm, ["p2"])?.messageId).toBe("p2");
    expect(matchBackToPuzzle(msgs, "問題に戻る", norm, ["p1"])?.messageId).toBe("p1");
  });

  it("複数候補が両方 frontier にある等で絞れない → null（誤表示しない）", () => {
    const msgs = [puzzle({ id: "p1" }), puzzle({ id: "p2" })];
    expect(matchBackToPuzzle(msgs, "問題に戻る", norm, ["p1", "p2"])).toBeNull();
  });

  it("正規化（前後空白）で一致する", () => {
    expect(matchBackToPuzzle([puzzle()], "  問題に戻る  ", norm)?.messageId).toBe("pz-1");
  });
});

describe("ケースB: postback「問題に戻る」の data 組み立て/解析（回答判定に流さない・messageId 指定）", () => {
  const UUID = "0123abcd-4567-89ef-0123-456789abcdef";

  it("build → parse の往復で messageId が一致する", () => {
    const data = buildBackToPuzzlePostbackData(UUID);
    expect(parseBackToPuzzlePostback(data)).toEqual({ messageId: UUID });
  });

  it("data は action=hint_back_to_puzzle を含み、LINE postback data 上限300文字に十分収まる", () => {
    const data = buildBackToPuzzlePostbackData(UUID);
    expect(data).toContain(`action=${BACK_TO_PUZZLE_POSTBACK_ACTION}`);
    expect(data.length).toBeLessThan(300);
  });

  it("別 action の postback は null（既存 postback 処理を壊さない）", () => {
    expect(parseBackToPuzzlePostback("action=resume_work&workId=x&mode=resume")).toBeNull();
    expect(parseBackToPuzzlePostback("START")).toBeNull();
    expect(parseBackToPuzzlePostback("")).toBeNull();
  });

  it("action は一致するが messageId 空/欠落 → null（no-op で通常処理へ戻れる）", () => {
    expect(parseBackToPuzzlePostback(`action=${BACK_TO_PUZZLE_POSTBACK_ACTION}`)).toBeNull();
    expect(parseBackToPuzzlePostback(`action=${BACK_TO_PUZZLE_POSTBACK_ACTION}&messageId=`)).toBeNull();
    expect(parseBackToPuzzlePostback(`action=${BACK_TO_PUZZLE_POSTBACK_ACTION}&messageId=%20%20`)).toBeNull();
  });
});

describe("ケース2: 再表示される問題には同じヒント QR が付く（buildKeywordMessages 経路と同じ合成）", () => {
  it("kind=puzzle / hint_mode=always / incorrect_quick_replies → ヒント QR が再付与される", () => {
    // 再表示は buildMessageChain → buildKeywordMessages → resolveDisplayQrItems の経路を通る。
    // ここでは合成結果（ヒント QR が付く）を直接検証する。
    const items = resolveDisplayQrItems({
      kind: "puzzle", hintMode: "always", quickReplies: null,
      incorrectQuickReplies: JSON.parse(HINTS()) as never,
    });
    const qr = buildQuickReplyFromItems(items)!;
    expect(qr.items.map((i) => i.action.type)).toContain("message");
    expect(qr.items.some((i) => (i.action as { label?: string }).label === "ヒント①")).toBe(true);
  });
});
