/**
 * src/__tests__/qr-transition-check.test.ts
 * QR Step3=メッセージ の別フェーズ警告判定（純ロジック）。
 */
import { describe, it, expect } from "vitest";
import {
  isQrCrossPhaseMessageTarget,
  resolveQrTargetMessagePhaseId,
  QR_CROSS_PHASE_WARNING,
} from "@/app/oas/[id]/works/[workId]/messages/_qr-transition-check";

const TM = [
  { id: "m_deai", phase_id: "P_deai" },
  { id: "m_umi",  phase_id: "P_umi" },
  { id: "m_nophase", phase_id: null },
];

describe("isQrCrossPhaseMessageTarget", () => {
  it("1. message + 同一フェーズ → 警告なし", () => {
    expect(isQrCrossPhaseMessageTarget({ targetType: "message", targetMessageId: "m_deai", transitionMessages: TM, currentPhaseId: "P_deai" })).toBe(false);
  });
  it("2. message + 別フェーズ → 警告あり", () => {
    expect(isQrCrossPhaseMessageTarget({ targetType: "message", targetMessageId: "m_umi", transitionMessages: TM, currentPhaseId: "P_deai" })).toBe(true);
  });
  it("3. phase 遷移 → 警告なし", () => {
    expect(isQrCrossPhaseMessageTarget({ targetType: "phase", targetMessageId: undefined, transitionMessages: TM, currentPhaseId: "P_deai" })).toBe(false);
  });
  it("4. targetMessage 未選択 → 警告なし", () => {
    expect(isQrCrossPhaseMessageTarget({ targetType: "message", targetMessageId: undefined, transitionMessages: TM, currentPhaseId: "P_deai" })).toBe(false);
  });
  it("5. 遷移先メッセージの phaseId 不明（null/未登録）→ 落ちない・警告なし", () => {
    expect(isQrCrossPhaseMessageTarget({ targetType: "message", targetMessageId: "m_nophase", transitionMessages: TM, currentPhaseId: "P_deai" })).toBe(false);
    expect(isQrCrossPhaseMessageTarget({ targetType: "message", targetMessageId: "missing", transitionMessages: TM, currentPhaseId: "P_deai" })).toBe(false);
    expect(isQrCrossPhaseMessageTarget({ targetType: "message", targetMessageId: "m_umi", transitionMessages: null, currentPhaseId: "P_deai" })).toBe(false);
  });
  it("編集中メッセージにフェーズが無い → 警告なし（曖昧）", () => {
    expect(isQrCrossPhaseMessageTarget({ targetType: "message", targetMessageId: "m_umi", transitionMessages: TM, currentPhaseId: null })).toBe(false);
  });
});

describe("resolveQrTargetMessagePhaseId", () => {
  it("選択メッセージのフェーズ ID を返す（無ければ null）", () => {
    expect(resolveQrTargetMessagePhaseId("m_umi", TM)).toBe("P_umi");
    expect(resolveQrTargetMessagePhaseId("m_nophase", TM)).toBeNull();
    expect(resolveQrTargetMessagePhaseId(undefined, TM)).toBeNull();
  });
});

describe("QR_CROSS_PHASE_WARNING 文言", () => {
  it("6. 「フェーズは変わらない」「次フェーズへ進めたい場合はフェーズを選択」の趣旨を含む", () => {
    expect(QR_CROSS_PHASE_WARNING).toContain("現在フェーズは変わらない");
    expect(QR_CROSS_PHASE_WARNING).toContain("「フェーズへ進む」に変更");
  });
});
