// @vitest-environment jsdom
// src/__tests__/liff-theme-render.test.tsx
//
// フォントテーマ / カラーモードが実際に renderer の root DOM へ届いているかの描画テスト。
// helpers の単体テスト (liff-theme-settings.test.ts) が通っていても、
// renderer が liffRootClass を root に付け忘れていれば実機では反映されないため、
// 共通シェル (LiffPageShell) と代表 renderer (FaqRenderer) の 2 経路を押さえる。

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { LiffPageShell } from "@/components/liff/ui/LiffPageShell";
import { FaqRenderer } from "@/components/liff/FaqRenderer";
import type { LiffPageConfig, LiffPageConfigSettings } from "@/types";

afterEach(cleanup);

const S = (o: Record<string, unknown>): LiffPageConfigSettings => o as LiffPageConfigSettings;

/** root（= .liff-font を持つ最上位要素）の class を取る。 */
function rootClass(container: HTMLElement): string {
  const root = container.querySelector(".liff-font");
  expect(root).not.toBeNull();
  return root!.className;
}

describe("LiffPageShell — root class への反映", () => {
  it("未設定なら従来どおりテーマ class が付かない", () => {
    const { container } = render(<LiffPageShell settings={undefined}>本文</LiffPageShell>);
    const cls = rootClass(container);
    expect(cls).toContain("liff-font");
    expect(cls).not.toMatch(/liff-font-theme--/);
    expect(cls).not.toMatch(/liff-color-mode-/);
  });

  it("font_theme が root class に出る", () => {
    const { container } = render(
      <LiffPageShell settings={S({ font_theme: "rounded" })}>本文</LiffPageShell>,
    );
    expect(rootClass(container)).toContain("liff-font-theme--rounded");
  });

  it("color_mode が root class に出る", () => {
    const { container } = render(
      <LiffPageShell settings={S({ color_mode: "dark" })}>本文</LiffPageShell>,
    );
    expect(rootClass(container)).toContain("liff-color-mode-dark");
  });

  it("フォントとカラーは同時に適用できる", () => {
    const { container } = render(
      <LiffPageShell settings={S({ font_theme: "classic", color_mode: "sepia" })}>本文</LiffPageShell>,
    );
    const cls = rootClass(container);
    expect(cls).toContain("liff-font-theme--classic");
    expect(cls).toContain("liff-color-mode-sepia");
  });

  it("不正値は既定（class なし）に落ちる", () => {
    const { container } = render(
      <LiffPageShell settings={S({ font_theme: "comic", color_mode: "neon" })}>本文</LiffPageShell>,
    );
    const cls = rootClass(container);
    expect(cls).not.toMatch(/liff-font-theme--/);
    expect(cls).not.toMatch(/liff-color-mode-/);
  });

  it("root は背景・文字色をトークン経由で指定している（モード切替が効く前提）", () => {
    const { container } = render(<LiffPageShell settings={S({ color_mode: "dark" })}>本文</LiffPageShell>);
    const cls = rootClass(container);
    expect(cls).toContain("bg-[color:var(--liff-background)]");
    expect(cls).toContain("text-[color:var(--liff-primary-text)]");
  });
});

describe("FaqRenderer — 既存 renderer にも同じ経路で届く", () => {
  const config = (settings: LiffPageConfigSettings): LiffPageConfig =>
    ({
      id: "p1",
      page_type: "faq",
      title: "よくある質問",
      description: null,
      settings_json: { faq_items: [{ question: "Q1", answer: "A1" }], ...settings },
    }) as unknown as LiffPageConfig;

  it("未設定は従来どおり（テーマ class なし）かつ本文は描画される", () => {
    const { container } = render(<FaqRenderer config={config({})} />);
    expect(screen.getByText("Q1")).toBeTruthy();
    const cls = rootClass(container);
    expect(cls).not.toMatch(/liff-font-theme--|liff-color-mode-/);
  });

  it("color_mode / font_theme が root に付く", () => {
    const { container } = render(
      <FaqRenderer config={config(S({ color_mode: "bordeaux", font_theme: "modern" }))} />,
    );
    const cls = rootClass(container);
    expect(cls).toContain("liff-color-mode-bordeaux");
    expect(cls).toContain("liff-font-theme--modern");
  });

  it("旧 font_preset だけのページも表示され、対応する新 class になる", () => {
    const { container } = render(<FaqRenderer config={config(S({ font_preset: "serif" }))} />);
    expect(screen.getByText("Q1")).toBeTruthy();
    expect(rootClass(container)).toContain("liff-font-theme--classic");
  });
});
