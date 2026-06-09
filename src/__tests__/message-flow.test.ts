/**
 * src/__tests__/message-flow.test.ts
 *
 * メッセージ管理の分岐ルール（src/lib/message-flow.ts）を検証する。
 *
 * 検証観点:
 *   - shouldOfferResumeChoice: 途中再開 ON/OFF と進行状態の組み合わせ
 *       （webhook で sendResumeChoice を出すかどうかの判定）
 *   - nextTransitionDisabledByPuzzle: 謎・問題の正解時アクション=フェーズ遷移のとき
 *       「このメッセージの後の遷移」を無効化するか
 *   - updateWorkSchema が resume_enabled を受理すること
 */

import { describe, it, expect } from "vitest";
import { shouldOfferResumeChoice, nextTransitionDisabledByPuzzle } from "@/lib/message-flow";
import { updateWorkSchema } from "@/lib/validations";

describe("shouldOfferResumeChoice（途中再開の選択肢を出すか）", () => {
  const midProgress = { hasProgress: true, reachedEnding: false, currentPhaseId: "p1" };

  it("resumeEnabled=true かつ進行中 → true（従来挙動: 再開選択肢を表示）", () => {
    expect(shouldOfferResumeChoice({ resumeEnabled: true, ...midProgress })).toBe(true);
  });

  it("resumeEnabled=undefined（旧データ）かつ進行中 → true（互換で ON 扱い）", () => {
    expect(shouldOfferResumeChoice({ resumeEnabled: undefined, ...midProgress })).toBe(true);
  });

  it("resumeEnabled=false → 進行中でも false（選択肢を出さない＝最初から開始に寄せる）", () => {
    expect(shouldOfferResumeChoice({ resumeEnabled: false, ...midProgress })).toBe(false);
  });

  it("未開始（progress なし）→ false", () => {
    expect(shouldOfferResumeChoice({ resumeEnabled: true, hasProgress: false, reachedEnding: false, currentPhaseId: null })).toBe(false);
  });

  it("エンディング到達済み → false（最初から扱い）", () => {
    expect(shouldOfferResumeChoice({ resumeEnabled: true, hasProgress: true, reachedEnding: true, currentPhaseId: "p1" })).toBe(false);
  });

  it("currentPhaseId が null → false", () => {
    expect(shouldOfferResumeChoice({ resumeEnabled: true, hasProgress: true, reachedEnding: false, currentPhaseId: null })).toBe(false);
  });
});

describe("nextTransitionDisabledByPuzzle（謎の正解時遷移と後の遷移の競合）", () => {
  it("謎 + 正解時=フェーズ遷移のみ → 無効化 true", () => {
    expect(nextTransitionDisabledByPuzzle({ isPuzzle: true, correctAction: "transition" })).toBe(true);
  });

  it("謎 + 正解時=テキスト＋フェーズ遷移 → 無効化 true", () => {
    expect(nextTransitionDisabledByPuzzle({ isPuzzle: true, correctAction: "text_and_transition" })).toBe(true);
  });

  it("謎 + 正解時=テキストのみ → 無効化しない false（後の遷移は編集可能）", () => {
    expect(nextTransitionDisabledByPuzzle({ isPuzzle: true, correctAction: "text" })).toBe(false);
  });

  it("謎でない（通常メッセージ）→ correctAction に関わらず false", () => {
    expect(nextTransitionDisabledByPuzzle({ isPuzzle: false, correctAction: "transition" })).toBe(false);
    expect(nextTransitionDisabledByPuzzle({ isPuzzle: false, correctAction: null })).toBe(false);
  });

  it("正解時アクションを遷移以外へ戻すと再び編集可能（false）になる", () => {
    expect(nextTransitionDisabledByPuzzle({ isPuzzle: true, correctAction: "transition" })).toBe(true);
    expect(nextTransitionDisabledByPuzzle({ isPuzzle: true, correctAction: "text" })).toBe(false);
  });
});

describe("updateWorkSchema は resume_enabled を受理する", () => {
  it("resume_enabled=true / false を parse できる", () => {
    expect(updateWorkSchema.parse({ resume_enabled: true })).toMatchObject({ resume_enabled: true });
    expect(updateWorkSchema.parse({ resume_enabled: false })).toMatchObject({ resume_enabled: false });
  });

  it("resume_enabled 省略時は undefined（変更なし）", () => {
    expect(updateWorkSchema.parse({ title: "x" }).resume_enabled).toBeUndefined();
  });

  it("boolean 以外は reject", () => {
    expect(() => updateWorkSchema.parse({ resume_enabled: "yes" })).toThrow();
  });
});
