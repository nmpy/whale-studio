// src/__tests__/phase-flow/build-graph.test.ts
// フェーズフロー（読み取り専用ビュー）のデータ変換・レイアウトの純ロジックテスト。
import { describe, it, expect } from "vitest";
import { buildFlowGraph, edgeToneAndLabel } from "@/app/oas/[id]/works/[workId]/scenario/_flow/build-graph";
import { layoutFlow } from "@/app/oas/[id]/works/[workId]/scenario/_flow/layout";
import type { PhaseWithCounts, TransitionWithPhases, PhaseType } from "@/types";

function mkPhase(id: string, over: Partial<PhaseWithCounts> = {}): PhaseWithCounts {
  return {
    id,
    work_id: "w1",
    phase_type: (over.phase_type ?? "normal") as PhaseType,
    name: over.name ?? `phase-${id}`,
    description: null,
    start_trigger: null,
    resume_summary: null,
    sort_order: over.sort_order ?? 0,
    is_active: over.is_active ?? true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    _count: over._count ?? { messages: 0, transitionsFrom: 0 },
    ...over,
  };
}
function mkTr(id: string, from: string, to: string, over: Partial<TransitionWithPhases> = {}): TransitionWithPhases {
  return {
    id, work_id: "w1", from_phase_id: from, to_phase_id: to,
    label: over.label ?? "", condition: over.condition ?? null, flag_condition: over.flag_condition ?? null,
    sort_order: over.sort_order ?? 0,
    ...over,
  } as TransitionWithPhases;
}
const href = (id: string) => `/oas/o1/works/w1/phases/${id}`;

describe("buildFlowGraph — ノード生成・分類・件数", () => {
  it("既存フェーズからノードを生成する（件数・href・種別）", () => {
    const phases = [mkPhase("a", { phase_type: "start", name: "開始", _count: { messages: 2, transitionsFrom: 1 } })];
    const g = buildFlowGraph(phases, [], href);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]).toMatchObject({ id: "a", phaseType: "start", name: "開始", msgCount: 2, isStart: true, isEnding: false, href: "/oas/o1/works/w1/phases/a" });
  });

  it("開始・通常・終了・未接続を分類する", () => {
    const phases = [
      mkPhase("s", { phase_type: "start" }),
      mkPhase("n", { phase_type: "normal" }),
      mkPhase("e", { phase_type: "ending" }),
      mkPhase("iso", { phase_type: "normal" }), // どの遷移にも現れない → 未接続
    ];
    const trs = [mkTr("t1", "s", "n"), mkTr("t2", "n", "e")];
    const g = buildFlowGraph(phases, trs, href);
    const by = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    expect(by.s.isStart).toBe(true);
    expect(by.e.isEnding).toBe(true);
    expect(by.iso.isUnconnected).toBe(true);
    expect(by.s.isUnconnected).toBe(false); // 出次数があるので接続
    expect(by.n.isUnconnected).toBe(false);
  });

  it("分岐数 = 出次数、メッセージ件数 = _count.messages", () => {
    const phases = [mkPhase("a", { _count: { messages: 5, transitionsFrom: 0 } }), mkPhase("b"), mkPhase("c")];
    const trs = [mkTr("t1", "a", "b"), mkTr("t2", "a", "c")]; // a から 2 分岐
    const g = buildFlowGraph(phases, trs, href);
    const a = g.nodes.find((n) => n.id === "a")!;
    expect(a.branchCount).toBe(2);
    expect(a.msgCount).toBe(5);
  });

  it("下書き（is_active=false）を判定する", () => {
    const g = buildFlowGraph([mkPhase("a", { is_active: false })], [], href);
    expect(g.nodes[0].isDraft).toBe(true);
  });

  it("既存遷移から接続線を生成する", () => {
    const g = buildFlowGraph([mkPhase("a"), mkPhase("b")], [mkTr("t1", "a", "b")], href);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ id: "t1", source: "a", target: "b" });
  });

  it("壊れた遷移参照（削除済みフェーズ）は線を除外し警告を返す・クラッシュしない", () => {
    const g = buildFlowGraph([mkPhase("a")], [mkTr("t1", "a", "ghost"), mkTr("t2", "missing", "a")], href);
    expect(g.edges).toHaveLength(0);
    expect(g.warnings).toHaveLength(2);
    expect(g.warnings[0]).not.toContain("phase-"); // 本文/名前を含めない
  });

  it("循環参照・自己参照でもクラッシュせずエッジを生成する", () => {
    const phases = [mkPhase("a"), mkPhase("b")];
    const trs = [mkTr("t1", "a", "b"), mkTr("t2", "b", "a"), mkTr("t3", "a", "a")]; // a→b→a と自己参照
    const g = buildFlowGraph(phases, trs, href);
    expect(g.edges).toHaveLength(3);
    expect(g.nodes.every((n) => !n.isUnconnected)).toBe(true);
  });

  it("フェーズ0件なら空グラフ", () => {
    const g = buildFlowGraph([], [], href);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });
});

describe("buildFlowGraph — 未接続判定は完全孤立のみ（片方向は接続扱い）", () => {
  it("入次数のみ / 出次数のみのノードは未接続にしない", () => {
    const phases = [mkPhase("a"), mkPhase("inOnly"), mkPhase("outOnly")];
    const trs = [mkTr("t1", "a", "inOnly"), mkTr("t2", "outOnly", "a")];
    const by = Object.fromEntries(buildFlowGraph(phases, trs, href).nodes.map((n) => [n.id, n]));
    expect(by.inOnly.isUnconnected).toBe(false);  // 入次数のみ（終了フェーズ相当）
    expect(by.outOnly.isUnconnected).toBe(false);  // 出次数のみ（開始フェーズ相当）
  });
  it("合流（複数 → 1）でも全ノード接続・エッジ2本", () => {
    const g = buildFlowGraph([mkPhase("a"), mkPhase("b"), mkPhase("c")], [mkTr("t1", "a", "c"), mkTr("t2", "b", "c")], href);
    expect(g.edges).toHaveLength(2);
    expect(g.nodes.every((n) => !n.isUnconnected)).toBe(true);
  });
  it("複数開始・複数終了を許容する", () => {
    const phases = [mkPhase("s1", { phase_type: "start" }), mkPhase("s2", { phase_type: "start" }), mkPhase("e1", { phase_type: "ending" }), mkPhase("e2", { phase_type: "ending" })];
    const trs = [mkTr("t1", "s1", "e1"), mkTr("t2", "s2", "e2")];
    const g = buildFlowGraph(phases, trs, href);
    expect(g.nodes.filter((n) => n.isStart)).toHaveLength(2);
    expect(g.nodes.filter((n) => n.isEnding)).toHaveLength(2);
    expect(g.nodes.every((n) => !n.isUnconnected)).toBe(true);
  });
});

describe("buildFlowGraph — 壊れた参照・重複・件数の境界", () => {
  it("壊れた from のみ / to のみをそれぞれ除外し、正常な線は残す", () => {
    const phases = [mkPhase("a"), mkPhase("b")];
    const g = buildFlowGraph(phases, [mkTr("ok", "a", "b"), mkTr("badFrom", "ghost", "b"), mkTr("badTo", "a", "ghost")], href);
    expect(g.edges.map((e) => e.id)).toEqual(["ok"]);
    expect(g.warnings).toHaveLength(2);
  });
  it("全 transition が壊れていても空エッジで完走（クラッシュしない）", () => {
    const g = buildFlowGraph([mkPhase("a")], [mkTr("t1", "x", "y"), mkTr("t2", "a", "z")], href);
    expect(g.edges).toHaveLength(0);
    expect(g.nodes).toHaveLength(1);
  });
  it("分岐数は壊れた出遷移を数えない（描画される線と一致）", () => {
    const g = buildFlowGraph([mkPhase("a", { _count: { messages: 0, transitionsFrom: 3 } })], [mkTr("t1", "a", "ghost")], href);
    expect(g.nodes[0].branchCount).toBe(0); // _count.transitionsFrom=3 に釣られない
  });
  it("同一 from/to でも別 transition は別エッジ（分岐数2）", () => {
    const g = buildFlowGraph([mkPhase("a"), mkPhase("b")], [mkTr("t1", "a", "b", { label: "正解" }), mkTr("t2", "a", "b", { label: "不正解" })], href);
    expect(g.edges).toHaveLength(2);
    expect(g.nodes.find((n) => n.id === "a")!.branchCount).toBe(2);
  });
  it("transition id 重複は 1 エッジに統合（重複線を作らない）", () => {
    const g = buildFlowGraph([mkPhase("a"), mkPhase("b")], [mkTr("dup", "a", "b"), mkTr("dup", "a", "b")], href);
    expect(g.edges).toHaveLength(1);
  });
  it("フェーズ1件でも成立する", () => {
    const g = buildFlowGraph([mkPhase("solo")], [], href);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0].isUnconnected).toBe(true);
  });
  it("入力配列の順序が変わってもノード/エッジ集合は不変（安定）", () => {
    const phases = [mkPhase("a"), mkPhase("b"), mkPhase("c")];
    const trs = [mkTr("t1", "a", "b"), mkTr("t2", "b", "c")];
    const g1 = buildFlowGraph(phases, trs, href);
    const g2 = buildFlowGraph([...phases].reverse(), [...trs].reverse(), href);
    expect(new Set(g2.nodes.map((n) => n.id))).toEqual(new Set(g1.nodes.map((n) => n.id)));
    expect(new Set(g2.edges.map((e) => e.id))).toEqual(new Set(g1.edges.map((e) => e.id)));
  });
});

describe("edgeToneAndLabel — 条件からラベル・トーン", () => {
  it("正解→ok / 不正解→ng / ヒント→warn", () => {
    expect(edgeToneAndLabel({ label: "正解", condition: null, flag_condition: null }).tone).toBe("ok");
    expect(edgeToneAndLabel({ label: "不正解A", condition: null, flag_condition: null }).tone).toBe("ng");
    expect(edgeToneAndLabel({ label: "ヒント使用", condition: null, flag_condition: null }).tone).toBe("warn");
  });
  it("ラベル無しは自動遷移（muted）、条件があれば条件ラベル", () => {
    expect(edgeToneAndLabel({ label: "", condition: null, flag_condition: null })).toEqual({ label: "自動遷移", tone: "muted" });
    expect(edgeToneAndLabel({ label: "", condition: "score>=10", flag_condition: null }).label).toContain("score>=10");
    expect(edgeToneAndLabel({ label: "", condition: null, flag_condition: "flags.x" }).label).toBe("フラグ条件");
  });
  it("既知キーワードを含まないラベルは中立(muted)表示・ラベルはそのまま", () => {
    const r = edgeToneAndLabel({ label: "ルートA", condition: null, flag_condition: null });
    expect(r.tone).toBe("muted");   // 誤ったカテゴリ（緑/赤/橙）へ分類しない
    expect(r.label).toBe("ルートA"); // 保存された文言をそのまま表示
  });
});

describe("layoutFlow — dagre 決定論・縦横", () => {
  const ids = ["a", "b", "c"];
  const edges = [{ source: "a", target: "b" }, { source: "a", target: "c" }];
  it("同じ入力に対して常に同じ座標（決定論的）", () => {
    const p1 = layoutFlow(ids, edges, "LR");
    const p2 = layoutFlow(ids, edges, "LR");
    for (const id of ids) expect(p2.get(id)).toEqual(p1.get(id));
  });
  it("縦(TB)と横(LR)で配置が変わる", () => {
    const tb = layoutFlow(ids, edges, "TB");
    const lr = layoutFlow(ids, edges, "LR");
    // 少なくとも 1 ノードは座標が異なる
    expect(ids.some((id) => tb.get(id)!.x !== lr.get(id)!.x || tb.get(id)!.y !== lr.get(id)!.y)).toBe(true);
  });
  it("孤立ノードにも座標が付与される（画面から消えない）", () => {
    const pos = layoutFlow(["a", "iso"], [], "LR");
    expect(pos.get("iso")).toBeDefined();
    expect(Number.isFinite(pos.get("iso")!.x)).toBe(true);
  });
});
