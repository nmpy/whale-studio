/**
 * src/__tests__/image-action-phase.test.ts
 *
 * 画像タップ「メッセージを送信する＋フェーズ遷移」(message_with_phase):
 *  - webhook の遷移先解決（matchImageActionPhaseTransition・純関数）
 *  - 送信 runtime（buildImageActionFlex が message action になる・phase_id は payload に載らない）
 */
import { describe, it, expect } from "vitest";
import { matchImageActionPhaseTransition, type ImagePhaseCandidate } from "@/lib/image-action-phase";
import { buildImageActionFlex } from "@/lib/line";

// webhook の normKw/normKwLoose に相当する簡易正規化（テスト用）。
const norm = { strict: (s: string) => s.trim(), loose: (s: string) => s.trim().toLowerCase().replace(/\s+/g, "") };

const img = (over: Partial<ImagePhaseCandidate>): ImagePhaseCandidate => ({
  id: "m1", messageType: "image", imageActionType: "message_with_phase",
  imageActionText: "次へ進む", imageActionPhaseId: "phase-2", ...over,
});

describe("matchImageActionPhaseTransition — 画像タップ送信テキスト → 遷移先フェーズ", () => {
  it("image + message_with_phase + text 一致 → 遷移先 phase を返す", () => {
    const r = matchImageActionPhaseTransition([img({})], "次へ進む", norm);
    expect(r).toEqual({ targetPhaseId: "phase-2", messageId: "m1", actionText: "次へ進む" });
  });

  it("謎のあるフェーズでも、image_action_text 一致なら遷移する（候補は image のみ・他メッセージは無視）", () => {
    const msgs: ImagePhaseCandidate[] = [
      { id: "pz", messageType: "text", imageActionType: null, imageActionText: null, imageActionPhaseId: null }, // 謎(別メッセージ)
      img({ id: "img1" }),
    ];
    const r = matchImageActionPhaseTransition(msgs, "次へ進む", norm);
    expect(r?.messageId).toBe("img1");
    expect(r?.targetPhaseId).toBe("phase-2");
  });

  it("非画像メッセージは対象外", () => {
    expect(matchImageActionPhaseTransition([img({ messageType: "text" })], "次へ進む", norm)).toBeNull();
  });

  it("imageActionType が message（=フェーズ遷移なし）は対象外", () => {
    expect(matchImageActionPhaseTransition([img({ imageActionType: "message" })], "次へ進む", norm)).toBeNull();
  });

  it("image_action_phase_id 未設定は遷移しない", () => {
    expect(matchImageActionPhaseTransition([img({ imageActionPhaseId: null })], "次へ進む", norm)).toBeNull();
    expect(matchImageActionPhaseTransition([img({ imageActionPhaseId: "" })], "次へ進む", norm)).toBeNull();
  });

  it("テキスト不一致（現在フェーズ文脈外のテキスト）には誤反応しない", () => {
    expect(matchImageActionPhaseTransition([img({})], "まったく別のテキスト", norm)).toBeNull();
  });

  it("loose 正規化で一致（空白/大小無視）", () => {
    const r = matchImageActionPhaseTransition([img({ imageActionText: "Go Next" })], "gonext", norm);
    expect(r?.targetPhaseId).toBe("phase-2");
  });

  it("複数候補のうち text 一致した最初のものを返す", () => {
    const msgs = [img({ id: "a", imageActionText: "A", imageActionPhaseId: "pa" }), img({ id: "b", imageActionText: "B", imageActionPhaseId: "pb" })];
    expect(matchImageActionPhaseTransition(msgs, "B", norm)?.messageId).toBe("b");
  });
});

describe("buildImageActionFlex — message_with_phase は LINE message action（phase_id は payload に載らない）", () => {
  type FlexAction = { type: string; label: string; text?: string };
  const heroAction = (flex: ReturnType<typeof buildImageActionFlex>): FlexAction | undefined =>
    (flex?.contents as { hero?: { action?: FlexAction } } | undefined)?.hero?.action;

  it("message_with_phase → action.type='message'・action.text=image_action_text", () => {
    const flex = buildImageActionFlex({
      imageUrl: "https://cdn.example.com/a.png",
      altText: "画像",
      imageAction: { type: "message_with_phase", text: "次へ進む", url: null, liffPageId: null, postbackData: null },
    });
    expect(flex).not.toBeNull();
    expect(flex!.type).toBe("flex");
    const action = heroAction(flex)!;
    expect(action.type).toBe("message");
    expect(action.text).toBe("次へ進む");
    // payload に phase_id 相当のフィールドが無い（CMS 側のみ保持）。
    expect(JSON.stringify(flex)).not.toContain("phase");
  });

  it("text が空なら null（通常 image にフォールバック）", () => {
    const flex = buildImageActionFlex({
      imageUrl: "https://cdn.example.com/a.png", altText: null,
      imageAction: { type: "message_with_phase", text: "", url: null, liffPageId: null, postbackData: null },
    });
    expect(flex).toBeNull();
  });

  it("message と message_with_phase は同じ message action になる（text 同じなら同形）", () => {
    const base = { imageUrl: "https://cdn.example.com/a.png", altText: "x" };
    const a = buildImageActionFlex({ ...base, imageAction: { type: "message", text: "go", url: null, liffPageId: null, postbackData: null } });
    const b = buildImageActionFlex({ ...base, imageAction: { type: "message_with_phase", text: "go", url: null, liffPageId: null, postbackData: null } });
    expect(heroAction(a)).toEqual(heroAction(b));
  });
});
