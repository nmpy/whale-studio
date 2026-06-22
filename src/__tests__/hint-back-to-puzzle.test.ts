/**
 * src/__tests__/hint-back-to-puzzle.test.ts
 *
 * ヒント導線 QR「問題に戻る」タップ → 問題再表示の照合（不正解判定より前に処理する）。
 * バグ: 「問題に戻る」が message action のテキストとして問題の回答扱いになり不正解が送られていた。
 */
import { describe, it, expect } from "vitest";
import { matchBackToPuzzle, DEFAULT_BACK_TO_PUZZLE_LABEL, type BackToPuzzleCandidate } from "@/lib/hint-back-to-puzzle";
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

  it("複数問題があるフェーズでは最初に一致した問題を返す", () => {
    const msgs = [puzzle({ id: "a" }), puzzle({ id: "b" })];
    expect(matchBackToPuzzle(msgs, "問題に戻る", norm)?.messageId).toBe("a");
  });

  it("正規化（前後空白）で一致する", () => {
    expect(matchBackToPuzzle([puzzle()], "  問題に戻る  ", norm)?.messageId).toBe("pz-1");
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
