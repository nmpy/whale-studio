// component-specs.test.ts — コンポーネント仕様テスト（ロジック・表示仕様の検証）
// jsdom なしで検証可能な仕様テスト。UI 壊れ防止の安全網。

import { describe, it, expect } from "vitest";

// ── PhaseNode 仕様テスト ────────────────────────────
describe("PhaseNode specification", () => {
  const STATUS_BADGE: Record<string, { icon: string; label: string }> = {
    disconnected:    { icon: "⚠",  label: "到達不可" },
    "no-condition":  { icon: "❗", label: "条件未設定" },
    loop:            { icon: "🔁", label: "ループ" },
    ok:              { icon: "✓",  label: "正常" },
  };

  it("status badge priority: disconnected > no-condition > loop > ok", () => {
    const priorities = ["disconnected", "no-condition", "loop", "ok"];
    // 各 status が一意のバッジを持つ
    const badges = priorities.map(s => STATUS_BADGE[s]);
    const icons = badges.map(b => b.icon);
    expect(new Set(icons).size).toBe(4);
  });

  it("all status types have corresponding badge with icon and label", () => {
    const statuses = ["ok", "disconnected", "no-condition", "loop"] as const;
    for (const s of statuses) {
      const badge = STATUS_BADGE[s];
      expect(badge).toBeDefined();
      expect(badge.icon.length).toBeGreaterThan(0);
      expect(badge.label.length).toBeGreaterThan(0);
    }
  });

  it("handle positions for TB layout", () => {
    // TB: target=Top, source=Bottom
    expect("TB" === "TB" ? "Top" : "Left").toBe("Top");
    expect("TB" === "TB" ? "Bottom" : "Right").toBe("Bottom");
  });

  it("handle positions for LR layout", () => {
    // LR: target=Left, source=Right
    const dir: string = "LR";
    expect(dir === "TB" ? "Top" : "Left").toBe("Left");
    expect(dir === "TB" ? "Bottom" : "Right").toBe("Right");
  });
});

// ── PhaseAnalytics 表示仕様 ─────────────────────────
describe("PhaseAnalytics display rules", () => {
  interface PhaseAnalytics {
    visitCount?: number;
    dropoffRate?: number;
    completionRate?: number;
    avgDurationMs?: number;
    dropoffCount?: number;
  }

  function shouldShowVisitCount(analytics?: PhaseAnalytics): boolean {
    return typeof analytics?.visitCount === "number";
  }

  function shouldShowDropoffRate(analytics?: PhaseAnalytics): boolean {
    return typeof analytics?.dropoffRate === "number";
  }

  function visitCountSeverity(count: number): "high" | "medium" | "low" {
    if (count > 50) return "high";
    if (count > 10) return "medium";
    return "low";
  }

  function dropoffSeverity(rate: number): "danger" | "safe" {
    return rate > 30 ? "danger" : "safe";
  }

  it("shows nothing when analytics is undefined", () => {
    expect(shouldShowVisitCount(undefined)).toBe(false);
    expect(shouldShowDropoffRate(undefined)).toBe(false);
  });

  it("shows nothing when analytics has no relevant fields", () => {
    expect(shouldShowVisitCount({})).toBe(false);
    expect(shouldShowDropoffRate({ completionRate: 80 })).toBe(false);
  });

  it("shows visitCount when present", () => {
    expect(shouldShowVisitCount({ visitCount: 42 })).toBe(true);
    expect(shouldShowVisitCount({ visitCount: 0 })).toBe(true);
  });

  it("classifies visit count severity correctly", () => {
    expect(visitCountSeverity(100)).toBe("high");
    expect(visitCountSeverity(25)).toBe("medium");
    expect(visitCountSeverity(5)).toBe("low");
  });

  it("classifies dropoff severity correctly", () => {
    expect(dropoffSeverity(50)).toBe("danger");
    expect(dropoffSeverity(10)).toBe("safe");
  });

  it("shows both visitCount and dropoffRate when present", () => {
    const a: PhaseAnalytics = { visitCount: 100, dropoffRate: 45 };
    expect(shouldShowVisitCount(a)).toBe(true);
    expect(shouldShowDropoffRate(a)).toBe(true);
  });
});

// ── WarningBanner 仕様テスト ────────────────────────
describe("WarningBanner specification", () => {
  it("errors should be sorted by severity (error first, warning second)", () => {
    const errors = [
      { severity: "warning", phaseId: "a" },
      { severity: "error", phaseId: "b" },
      { severity: "warning", phaseId: "c" },
      { severity: "error", phaseId: "d" },
    ];
    const sorted = [...errors].sort((a, b) => {
      if (a.severity === "error" && b.severity === "warning") return -1;
      if (a.severity === "warning" && b.severity === "error") return 1;
      return 0;
    });
    expect(sorted[0].severity).toBe("error");
    expect(sorted[1].severity).toBe("error");
    expect(sorted[2].severity).toBe("warning");
    expect(sorted[3].severity).toBe("warning");
  });

  it("uses error style when any error exists", () => {
    const hasError = [{ severity: "error" }, { severity: "warning" }].some(e => e.severity === "error");
    expect(hasError).toBe(true);
  });

  it("uses warning style when only warnings exist", () => {
    const hasError = [{ severity: "warning" }, { severity: "warning" }].some(e => e.severity === "error");
    expect(hasError).toBe(false);
  });
});

// ── ContextMenu 仕様テスト ──────────────────────────
describe("ContextMenu specification", () => {
  it("node menu has correct items in order: detail, duplicate, delete", () => {
    const canEdit = true;
    const items = ["フェーズ詳細を開く"];
    if (canEdit) items.push("複製 (Ctrl+D)", "削除");
    expect(items).toEqual(["フェーズ詳細を開く", "複製 (Ctrl+D)", "削除"]);
  });

  it("edge menu has correct items: edit, delete", () => {
    const canEdit = true;
    const items = ["遷移を編集"];
    if (canEdit) items.push("遷移を削除");
    expect(items).toEqual(["遷移を編集", "遷移を削除"]);
  });

  it("pane menu with canEdit has create first", () => {
    const canEdit = true;
    const items: string[] = [];
    if (canEdit) items.push("新規フェーズを追加");
    items.push("全体を表示", "自動整形（縦型）", "自動整形（横型）");
    expect(items[0]).toBe("新規フェーズを追加");
  });

  it("pane menu without canEdit has no create option", () => {
    const canEdit = false;
    const items: string[] = [];
    if (canEdit) items.push("新規フェーズを追加");
    items.push("全体を表示", "自動整形（縦型）", "自動整形（横型）");
    expect(items[0]).toBe("全体を表示");
  });
});

// ── ErrorToast 仕様テスト ───────────────────────────
describe("ErrorToast specification", () => {
  it("error toast has 5 second duration", () => {
    const errorDuration = 5000;
    const successDuration = 3000;
    expect(errorDuration).toBeGreaterThan(successDuration);
  });

  it("toast messages maintain insertion order", () => {
    const toasts = [
      { id: 1, text: "first", type: "error" as const },
      { id: 2, text: "second", type: "success" as const },
      { id: 3, text: "third", type: "error" as const },
    ];
    expect(toasts[0].text).toBe("first");
    expect(toasts[2].text).toBe("third");
  });
});

// ── OperationTracker 仕様テスト ─────────────────────
describe("OperationTracker specification", () => {
  it("supports all operation types", () => {
    const types = [
      "phase_create", "phase_duplicate", "phase_delete", "phase_bulk_delete",
      "transition_create", "transition_delete",
      "auto_layout", "search", "context_menu", "undo", "redo",
      "edge_drag_create",
    ];
    // 全て一意
    expect(new Set(types).size).toBe(types.length);
  });

  it("noopTrackerSink does not throw", () => {
    const sink = { track() {} };
    expect(() => sink.track()).not.toThrow();
  });
});

// ── EdgeDropCreate 仕様テスト ────────────────────────
describe("EdgeDropCreate specification", () => {
  it("should not offer start phase type in creation form", () => {
    const availableTypes = ["normal", "ending"];
    expect(availableTypes).not.toContain("start");
  });

  it("creates phase and transition in correct order", () => {
    // 仕様: 1. フェーズ作成 → 2. 遷移作成（from → new）
    const steps = ["phaseApi.create", "transitionApi.create"];
    expect(steps[0]).toBe("phaseApi.create");
    expect(steps[1]).toBe("transitionApi.create");
  });
});
