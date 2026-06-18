// src/__tests__/phase-transitions.test.ts
//
// フェーズ管理（シナリオ）画面の「次のフェーズへ進む導線があるか」判定の検証。
// QR / 分岐 / 謎正解後 / 自由入力後 / 到着トリガー / 別フェーズのメッセージ参照などを
// 横断して到達性を判定し、5通…ではなく「フェーズ外へ進めるか」を正しく見る。

import { describe, it, expect } from "vitest";
import {
  getOutgoingPhaseTargets,
  hasOutgoingTransitionFromPhase,
  analyzePhaseTransitions,
  type ScenarioData,
  type MessageLite,
} from "@/lib/phase-transitions";

const phases = (...ids: [string, string][]): ScenarioData["phases"] =>
  ids.map(([id, type]) => ({ id, phase_type: type }));

// 出会い(p1, start) / ゆかいな仲間たち(p2, normal) / 終わり(p3, ending)
const BASE = phases(["p1", "start"], ["p2", "normal"], ["p3", "ending"]);

function data(messages: MessageLite[], transitions: ScenarioData["transitions"] = []): ScenarioData {
  return { phases: BASE, transitions, messages };
}

describe("getOutgoingPhaseTargets", () => {
  it("明示 transition（from p1 → p2）があれば遷移あり", () => {
    const d = data([], [{ from_phase_id: "p1", to_phase_id: "p2" }]);
    expect([...getOutgoingPhaseTargets("p1", d).validTargets]).toEqual(["p2"]);
    expect(hasOutgoingTransitionFromPhase("p1", d)).toBe(true);
  });

  it("メッセージの QR の target_phase_id だけで別フェーズへ → 遷移あり", () => {
    const d = data([
      { id: "m1", phase_id: "p1", quick_replies: [{ target_phase_id: "p2" }] },
    ]);
    expect(getOutgoingPhaseTargets("p1", d).validTargets.has("p2")).toBe(true);
  });

  it("QR の target_message_id が別フェーズのメッセージを指す → 遷移あり（出会いの実ケース）", () => {
    const d = data([
      { id: "m1", phase_id: "p1", quick_replies: [{ target_type: "message", target_message_id: "m2" }] },
      { id: "m2", phase_id: "p2" }, // 遷移先メッセージは p2 に属する
    ]);
    expect(getOutgoingPhaseTargets("p1", d).validTargets.has("p2")).toBe(true);
  });

  it("ユーザー入力分岐（QR の value が transition ラベルに一致）→ 遷移あり", () => {
    const d = data(
      [{ id: "m1", phase_id: "p1", quick_replies: [{ label: "すすむ", value: "すすむ" }] }],
      [{ from_phase_id: "p1", to_phase_id: "p2", label: "すすむ" }],
    );
    expect(getOutgoingPhaseTargets("p1", d).validTargets.has("p2")).toBe(true);
  });

  it("自由入力後の応答メッセージが別フェーズ → 遷移あり", () => {
    const d = data([
      { id: "m1", phase_id: "p1", free_input_next_message_id: "m2" },
      { id: "m2", phase_id: "p2" },
    ]);
    expect(getOutgoingPhaseTargets("p1", d).validTargets.has("p2")).toBe(true);
  });

  it("謎の正解後フェーズ（correct_next_phase_id）だけ → 遷移あり", () => {
    const d = data([{ id: "m1", phase_id: "p1", correct_next_phase_id: "p2" }]);
    expect(getOutgoingPhaseTargets("p1", d).validTargets.has("p2")).toBe(true);
  });

  it("到着トリガーの遷移先（checkin_trigger_next_phase_id）だけ → 遷移あり", () => {
    const d = data([{ id: "m1", phase_id: "p1", checkin_trigger_next_phase_id: "p2" }]);
    expect(getOutgoingPhaseTargets("p1", d).validTargets.has("p2")).toBe(true);
  });

  it("同一フェーズ内の next_message しかない → フェーズ外遷移なし", () => {
    const d = data([
      { id: "m1", phase_id: "p1", next_message_id: "m2" },
      { id: "m2", phase_id: "p1" }, // 同じ p1
    ]);
    expect(getOutgoingPhaseTargets("p1", d).validTargets.size).toBe(0);
    expect(hasOutgoingTransitionFromPhase("p1", d)).toBe(false);
  });

  it("無効化された QR（enabled=false）にだけ遷移先 → 遷移なし", () => {
    const d = data([
      { id: "m1", phase_id: "p1", quick_replies: [{ enabled: false, target_phase_id: "p2" }] },
    ]);
    expect(getOutgoingPhaseTargets("p1", d).validTargets.size).toBe(0);
  });

  it("無効化されたメッセージ（is_active=false）にだけ遷移先 → 遷移なし", () => {
    const d = data([
      { id: "m1", phase_id: "p1", is_active: false, correct_next_phase_id: "p2" },
    ]);
    expect(getOutgoingPhaseTargets("p1", d).validTargets.size).toBe(0);
  });

  it("存在しない phaseId を参照 → valid ではなく invalid に入る", () => {
    const d = data([{ id: "m1", phase_id: "p1", correct_next_phase_id: "ghost" }]);
    const r = getOutgoingPhaseTargets("p1", d);
    expect(r.validTargets.size).toBe(0);
    expect(r.invalidTargets.has("ghost")).toBe(true);
  });

  it("自フェーズ自身への遷移はフェーズ外遷移にカウントしない", () => {
    const d = data([{ id: "m1", phase_id: "p1", correct_next_phase_id: "p1" }]);
    expect(getOutgoingPhaseTargets("p1", d).validTargets.size).toBe(0);
  });
});

describe("analyzePhaseTransitions", () => {
  it("出会い(p1)が QR→別フェーズのメッセージ経由で p2 へ進める → deadEnd 警告を出さない", () => {
    const d = data([
      { id: "m1", phase_id: "p1", quick_replies: [{ target_type: "message", target_message_id: "m2" }] },
      { id: "m2", phase_id: "p2" },
    ]);
    const r = analyzePhaseTransitions(d);
    expect(r.deadEndPhaseIds.has("p1")).toBe(false);
  });

  it("本当に次フェーズへの導線が無い通常フェーズ → deadEnd 警告を出す", () => {
    // p2(normal) に外向き導線なし
    const d = data([{ id: "m1", phase_id: "p2" }], [{ from_phase_id: "p1", to_phase_id: "p2" }]);
    const r = analyzePhaseTransitions(d);
    expect(r.deadEndPhaseIds.has("p2")).toBe(true);
  });

  it("ending フェーズ / 終了は deadEnd 警告の対象外", () => {
    const d = data([], [{ from_phase_id: "p1", to_phase_id: "p3" }]);
    const r = analyzePhaseTransitions(d);
    expect(r.deadEndPhaseIds.has("p3")).toBe(false); // p3 は ending
  });

  it("存在しないフェーズ参照は invalidTargets に出る（警告が消えない）", () => {
    const d = data([{ id: "m1", phase_id: "p2", correct_next_phase_id: "ghost" }]);
    const r = analyzePhaseTransitions(d);
    expect(r.invalidTargets.get("p2")?.has("ghost")).toBe(true);
    // 有効な外向き導線が無いので deadEnd 警告も維持される
    expect(r.deadEndPhaseIds.has("p2")).toBe(true);
  });

  it("どこからも到達できない通常フェーズ → orphan 警告", () => {
    // p1(start)→p3(ending) のみ。p2 へ入る導線なし。
    const d = data([], [{ from_phase_id: "p1", to_phase_id: "p3" }]);
    const r = analyzePhaseTransitions(d);
    expect(r.orphanPhaseIds.has("p2")).toBe(true);
    expect(r.orphanPhaseIds.has("p1")).toBe(false); // start は対象外
  });

  it("フェーズが1つだけのときは deadEnd / orphan を出さない", () => {
    const single: ScenarioData = { phases: phases(["only", "normal"]), transitions: [], messages: [] };
    const r = analyzePhaseTransitions(single);
    expect(r.deadEndPhaseIds.size).toBe(0);
    expect(r.orphanPhaseIds.size).toBe(0);
  });
});
