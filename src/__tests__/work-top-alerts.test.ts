// src/__tests__/work-top-alerts.test.ts
import { describe, it, expect } from "vitest";
import { computeWorkTopAlerts, type WorkTopAlertInput } from "@/lib/work-top-alerts";

const base = (over: Partial<WorkTopAlertInput> = {}): WorkTopAlertInput => ({
  publishStatus: "draft",
  hasStartTrigger: true,
  characters: 1,
  phases: 1,
  messages: 1,
  basePath: "/oas/o/works/w",
  ...over,
});

const keys = (input: WorkTopAlertInput) => computeWorkTopAlerts(input).map((a) => a.key);
const byKey = (input: WorkTopAlertInput, k: string) => computeWorkTopAlerts(input).find((a) => a.key === k);

describe("computeWorkTopAlerts", () => {
  it("全て揃っていれば success 1件のみ", () => {
    const a = computeWorkTopAlerts(base());
    expect(a).toHaveLength(1);
    expect(a[0].tone).toBe("success");
  });

  it("公開中でメッセージ0 → warning（公開中の文言）", () => {
    const al = byKey(base({ publishStatus: "active", messages: 0 }), "no_messages")!;
    expect(al.tone).toBe("warning");
    expect(al.title).toContain("公開中");
    expect(al.cta?.href).toBe("/oas/o/works/w/messages");
  });

  it("非公開でメッセージ0 → info（推奨トーン）", () => {
    const al = byKey(base({ publishStatus: "draft", messages: 0 }), "no_messages")!;
    expect(al.tone).toBe("info");
    expect(al.title).not.toContain("公開中");
  });

  it("公開中で開始トリガー未設定 → warning", () => {
    const al = byKey(base({ publishStatus: "active", hasStartTrigger: false }), "no_start_trigger")!;
    expect(al.tone).toBe("warning");
    expect(al.title).toContain("公開中");
    expect(al.cta?.label).toBe("開始トリガーを設定する");
  });

  it("非公開で開始トリガー未設定 → info（設定すると安定）", () => {
    const al = byKey(base({ publishStatus: "draft", hasStartTrigger: false }), "no_start_trigger")!;
    expect(al.tone).toBe("info");
    expect(al.detail).toContain("公開後の導線が安定");
  });

  it("フェーズ0 → warning/info（公開状態でトーンが変わる）", () => {
    expect(byKey(base({ publishStatus: "active", phases: 0 }), "no_phases")!.tone).toBe("warning");
    expect(byKey(base({ publishStatus: "draft", phases: 0 }), "no_phases")!.tone).toBe("info");
  });

  it("キャラクター0 → info（任意寄り）", () => {
    expect(byKey(base({ characters: 0 }), "no_characters")!.tone).toBe("info");
  });

  it("複数欠けていれば複数アラート・success は出ない", () => {
    const k = keys(base({ publishStatus: "active", hasStartTrigger: false, characters: 0, phases: 0, messages: 0 }));
    expect(k).toEqual(["no_phases", "no_messages", "no_characters", "no_start_trigger"]);
    expect(k).not.toContain("all_ok");
  });

  it("CTA href は basePath から組み立てる", () => {
    const al = byKey(base({ phases: 0, basePath: "/oas/A/works/B" }), "no_phases")!;
    expect(al.cta?.href).toBe("/oas/A/works/B/scenario");
  });
});
