// @vitest-environment jsdom
/**
 * src/__tests__/liff-single-page-chrome.test.tsx
 *
 * LiffSinglePageRenderer の「ページ Chrome（見出し / Powered by / ルート背景）」の担当分けを固定する。
 *
 * ticket_link だけは renderer 側のシェルが見出しとフッターを自前で描画するため、
 * 親側では出さない（= 二重描画しない）。他の page_type は従来どおり親が描画する。
 * この分岐は共有ファイルにあるため、他画面への非影響をここで担保する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LiffSinglePageRenderer, type LiffSinglePage } from "@/components/liff/LiffSinglePageRenderer";

vi.mock("@line/liff", () => ({
  default: { closeWindow: () => {}, isInClient: () => true, getAccessToken: () => "test-token" },
}));

beforeEach(() => {
  // ticket_link の renderer は初期表示で /config を叩く。ここでは API 挙動ではなく
  // 「誰が見出し / フッターを描画するか」を見たいので、解決しない fetch を挿して
  // 読み込み中の描画（見出しとフッターは出る）で判定する。
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makePage(over: Partial<LiffSinglePage>): LiffSinglePage {
  return {
    id: "page-1",
    title: null,
    description: null,
    page_type: "default",
    is_enabled: true,
    settings_json: {},
    blocks: [],
    ...over,
  };
}

function renderPage(page: LiffSinglePage) {
  const r = render(
    <LiffSinglePageRenderer workId="w1" workTitle="OPERATION ; BELKISSH" page={page} onBack={() => {}} />,
  );
  const root = r.container.querySelector("div.liff-font") as HTMLElement;
  return { ...r, root };
}

const CREDIT = "Powered by Whale Studio";

describe("他の page_type: ページ見出しと Powered by は親側が描画する", () => {
  for (const pageType of ["faq", "survey"]) {
    it(`${pageType}: page.title と Powered by が従来どおり表示される`, () => {
      const { root } = renderPage(makePage({ page_type: pageType, title: `${pageType} のタイトル` }));

      expect(screen.getAllByText(`${pageType} のタイトル`)).toHaveLength(1);
      expect(screen.getAllByText(CREDIT)).toHaveLength(1);
      // ページ見出しは親の liff-player-main ブロックが持つ（= ticket_link 側のシェルではない）
      expect(root.querySelector(".liff-player-main h2")?.textContent).toBe(`${pageType} のタイトル`);
    });

    it(`${pageType}: ticket_link 専用の Chrome / クラスが適用されない`, () => {
      const { root, container } = renderPage(makePage({ page_type: pageType, title: "t" }));

      expect(container.querySelector(".liff-ticket-link-page")).toBeNull();
      expect(container.querySelector(".liff-tl-input")).toBeNull();
      // ルート背景は従来クラスのまま（モバイル白への差し替えは ticket_link 限定）
      expect(root.className).toContain("bg-[color:var(--liff-background)]");
      expect(root.className).not.toContain("bg-[color:var(--liff-surface)]");
      expect(root.className).not.toContain("sm:bg-");
    });
  }
});

describe("ticket_link: 見出しと Powered by が二重表示されない", () => {
  it("page.title が設定されていても「チケット連携」は 1 回だけ", () => {
    const { container } = renderPage(makePage({ page_type: "ticket_link", title: "チケット連携" }));

    expect(screen.getAllByText("チケット連携")).toHaveLength(1);
    expect(screen.getAllByText(CREDIT)).toHaveLength(1);
    // 親側の見出しブロックは描画されない（renderer 側のシェルが担当する）
    expect(container.querySelector(".liff-player-main h2")).toBeNull();
    expect(container.querySelector(".liff-ticket-link-page")).not.toBeNull();
  });

  it("page.title 未設定でも既定文言「チケット連携」を 1 回だけ出す", () => {
    renderPage(makePage({ page_type: "ticket_link", title: null }));

    expect(screen.getAllByText("チケット連携")).toHaveLength(1);
    expect(screen.getAllByText(CREDIT)).toHaveLength(1);
  });

  it("ページ説明は親と renderer で二重に出ない", () => {
    renderPage(makePage({
      page_type: "ticket_link",
      title: "チケット連携",
      description: "ご購入いただいたチケットをLINEアカウントと連携します。",
    }));
    // 読み込み中は説明を出さない。少なくとも 2 回描画されることはない。
    expect(screen.queryAllByText("ご購入いただいたチケットをLINEアカウントと連携します。").length)
      .toBeLessThanOrEqual(1);
  });
});

describe("ticket_link: モバイルで下端まで白背景が続く（100vh と 100dvh の差を埋める）", () => {
  it("ルートはモバイル白 + sm 以上で従来背景へ戻る", () => {
    const { root } = renderPage(makePage({ page_type: "ticket_link", title: "チケット連携" }));

    // base variant = モバイル: 白
    expect(root.className).toContain("bg-[color:var(--liff-surface)]");
    // sm 以上: 従来の外側背景（Tailwind は sm: を base より後に出力するため生成順に依存しない）
    expect(root.className).toContain("sm:bg-[color:var(--liff-background)]");
    // base に薄い背景が残っていない（残っていると同一ユーティリティ族が競合する）
    expect(root.className).not.toMatch(/(^|\s)bg-\[color:var\(--liff-background\)\]/);
    // 高さ指定は親が min-h-screen、子シェルが 100dvh。親子で同じプロパティを二重に持たない
    expect(root.className).toContain("min-h-screen");
    expect(root.className).not.toContain("min-h-[100dvh]");
  });
});
