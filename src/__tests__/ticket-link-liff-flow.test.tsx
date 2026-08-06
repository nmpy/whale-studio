// @vitest-environment jsdom
/**
 * src/__tests__/ticket-link-liff-flow.test.tsx
 *
 * LIFF「チケット連携」画面のデザイン更新で **既存フローを壊していない** ことを DOM で検証する。
 *
 * 検証対象は「いつ API を呼ぶか / 何を送るか / 何を表示するか」であって、
 * API 実装そのものではない（API は fetch をモックして呼び出しを観測する）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { TicketLinkRenderer } from "@/components/liff/TicketLinkRenderer";

const closeWindow = vi.fn();
const isInClient = vi.fn(() => true);
vi.mock("@line/liff", () => ({
  default: {
    closeWindow: () => closeWindow(),
    isInClient: () => isInClient(),
    getAccessToken: () => "test-token",
  },
}));

const CONFIG = {
  manualInputAvailable: true,
  imageInputAvailable: false,
  ticketTypes: [
    { ticketTypeKey: "private_1", ticketTypeLabel: "1名様貸切チケット", participantCount: 1 },
    { ticketTypeKey: "private_2", ticketTypeLabel: "2名様貸切チケット", participantCount: 2 },
  ],
  workTitle: "OPERATION ; BELKISSH",
  report: { enabled: false, label: "報告する", message: "報告する" },
  completionMessage: "予約情報との照合後、\n連携状態が反映されます。",
  performanceDateTimeText: "運営確認後に反映されます",
  draft: null,
  links: [],
};

interface Call { path: string; method: string; body: Record<string, unknown> }

/** 呼び出しを記録しつつ、path ごとの応答を返す fetch モック。 */
function makeFetch(overrides: Record<string, () => Promise<Response> | Response> = {}) {
  const calls: Call[] = [];
  const json = (data: unknown, ok = true, status = 200) =>
    ({ ok, status, json: async () => (ok ? { success: true, data } : data) }) as unknown as Response;

  const impl = (async (url: string, init: RequestInit) => {
    const path = String(url).replace("/api/liff/works/w1/ticket-link", "");
    calls.push({ path, method: init.method ?? "GET", body: JSON.parse(String(init.body ?? "{}")) });
    const o = overrides[path];
    if (o) return o();
    if (path === "/config") return json(CONFIG);
    if (path === "/draft") {
      const key = calls.at(-1)!.body.ticketTypeKey;
      const count = CONFIG.ticketTypes.find((t) => t.ticketTypeKey === key)?.participantCount ?? 1;
      return json({ draftId: "d1", step: "TICKET_REVIEW", participantCount: count });
    }
    if (path === "/draft/code-names") return json({ draftId: "d1", step: "FINAL_REVIEW" });
    if (path === "/confirm") return json({ statusLabel: "運営確認待ち", alreadyRegistered: false });
    return json({});
  }) as unknown as typeof fetch;

  return { impl, calls, json };
}

function renderScreen(fetchImpl: typeof fetch) {
  return render(
    <TicketLinkRenderer
      workId="w1"
      fetchImpl={fetchImpl}
      getAccessToken={async () => "test-token"}
      pageTitle="チケット連携"
      pageDescription={null}
    />,
  );
}

const btn = (name: string | RegExp) => screen.getByRole("button", { name });

/** 画面1 → 入力 → 種別 / 名前 / 予約番号を埋める。 */
async function fillForm(reservationNumber = "123456", ticketTypeKey = "private_1") {
  await screen.findByRole("button", { name: "手動で入力" });
  fireEvent.click(btn("手動で入力"));
  fireEvent.change(screen.getByLabelText(/チケット種別/), { target: { value: ticketTypeKey } });
  fireEvent.change(screen.getByLabelText(/お名前/), { target: { value: "なみぽよ" } });
  fireEvent.change(screen.getByLabelText(/予約番号/), { target: { value: reservationNumber } });
}

beforeEach(() => { closeWindow.mockClear(); isInClient.mockClear(); });
afterEach(() => cleanup());

describe("画面1: 連携方法の選択", () => {
  it("初期表示から「手動で入力」で入力画面へ進める", async () => {
    const f = makeFetch();
    renderScreen(f.impl);
    fireEvent.click(await screen.findByRole("button", { name: "手動で入力" }));
    expect(screen.getByText("チケット情報をご入力ください。")).toBeTruthy();
    expect(screen.getByText("1 / 4")).toBeTruthy();
  });

  it("スクリーンショットからの登録は無効（準備中）で押せない", async () => {
    const f = makeFetch();
    renderScreen(f.impl);
    const b = await screen.findByRole("button", { name: /スクリーンショットから登録（準備中）/ });
    expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(b.getAttribute("aria-disabled")).toBe("true");
  });

  it("入口では API は config 取得しか呼ばない", async () => {
    const f = makeFetch();
    renderScreen(f.impl);
    await screen.findByRole("button", { name: "手動で入力" });
    expect(f.calls.map((c) => c.path)).toEqual(["/config"]);
  });
});

describe("画面2: チケット情報入力", () => {
  it("対象公演は編集不可で表示される", async () => {
    const f = makeFetch();
    renderScreen(f.impl);
    await fillForm();
    // input ではなく静的テキストとして描画する（disabled で薄くしない）
    expect(screen.getAllByText("OPERATION ; BELKISSH").length).toBeGreaterThan(0);
    expect(screen.queryByDisplayValue("OPERATION ; BELKISSH")).toBeNull();
  });

  it("チケット種別を選択でき、内部値は安定キーのまま", async () => {
    const f = makeFetch();
    renderScreen(f.impl);
    await fillForm("123456", "private_2");
    expect((screen.getByLabelText(/チケット種別/) as HTMLSelectElement).value).toBe("private_2");
  });

  it("必須項目が未入力なら確認画面へ進まず、API も呼ばない", async () => {
    const f = makeFetch();
    renderScreen(f.impl);
    await screen.findByRole("button", { name: "手動で入力" });
    fireEvent.click(btn("手動で入力"));
    fireEvent.click(btn("この内容で進む"));

    await screen.findByText("チケット種別を選択してください。");
    expect(f.calls.map((c) => c.path)).toEqual(["/config"]);
    expect(screen.queryByText("以下の内容で登録します。よろしければ「この内容で登録」を押してください。")).toBeNull();
  });

  it("お名前が未入力なら進めない", async () => {
    const f = makeFetch();
    renderScreen(f.impl);
    await screen.findByRole("button", { name: "手動で入力" });
    fireEvent.click(btn("手動で入力"));
    fireEvent.change(screen.getByLabelText(/チケット種別/), { target: { value: "private_1" } });
    fireEvent.change(screen.getByLabelText(/予約番号/), { target: { value: "123456" } });
    fireEvent.click(btn("この内容で進む"));

    await screen.findByText("お名前を入力してください。");
    expect(f.calls.map((c) => c.path)).toEqual(["/config"]);
  });

  it("予約番号は既存ルールで整形・正規化して送信される（全角も可）", async () => {
    const f = makeFetch();
    renderScreen(f.impl);
    await fillForm("１２３４５６");
    expect((screen.getByLabelText(/予約番号/) as HTMLInputElement).value).toBe("123-456");

    fireEvent.click(btn("この内容で進む"));
    await waitFor(() => expect(f.calls.some((c) => c.path === "/draft")).toBe(true));
    expect(f.calls.find((c) => c.path === "/draft")!.body.reservationNumber).toBe("123-456");
  });

  it("桁数不足のまま進もうとすると欄の直下にエラーを出し、送信しない", async () => {
    const f = makeFetch();
    renderScreen(f.impl);
    await fillForm("12345");
    fireEvent.click(btn("この内容で進む"));

    await screen.findByText("予約番号は数字6桁で入力してください。");
    expect(f.calls.filter((c) => c.path === "/draft")).toHaveLength(0);
  });

  it("必須項目は属性でも必須と分かる", async () => {
    const f = makeFetch();
    renderScreen(f.impl);
    await fillForm();
    for (const label of [/チケット種別/, /お名前/, /予約番号/]) {
      const el = screen.getByLabelText(label);
      expect(el.getAttribute("aria-required")).toBe("true");
      expect(el.hasAttribute("required")).toBe(true);
    }
  });

  it("お名前未入力のエラーは aria で欄に紐付き、その欄へフォーカスが移る", async () => {
    const f = makeFetch();
    renderScreen(f.impl);
    await screen.findByRole("button", { name: "手動で入力" });
    fireEvent.click(btn("手動で入力"));
    fireEvent.change(screen.getByLabelText(/チケット種別/), { target: { value: "private_1" } });
    fireEvent.change(screen.getByLabelText(/予約番号/), { target: { value: "123456" } });
    fireEvent.click(btn("この内容で進む"));

    const name = await screen.findByLabelText(/お名前/);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toBe("ticket-link-name-error");
    expect(document.getElementById("ticket-link-name-error")?.textContent)
      .toBe("お名前を入力してください。");
    expect(document.activeElement).toBe(name);
    // 入力し直すとエラー状態が解ける
    fireEvent.change(name, { target: { value: "なみぽよ" } });
    expect(name.hasAttribute("aria-invalid")).toBe(false);
    expect(name.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("画面3: 登録内容の確認", () => {
  async function goToFinal(f: ReturnType<typeof makeFetch>) {
    renderScreen(f.impl);
    await fillForm("123456", "private_2");
    fireEvent.click(btn("この内容で進む"));                 // → review
    await screen.findByText("2 / 4");
    fireEvent.click(btn("この内容で進む"));                 // → codeNames
    await screen.findByText("3 / 4");
    fireEvent.change(screen.getByLabelText("プレイヤー1"), { target: { value: "アルファ" } });
    fireEvent.change(screen.getByLabelText("プレイヤー2"), { target: { value: "ブラボー" } });
    fireEvent.click(btn("登録内容を確認する"));             // → final
    await screen.findByText("4 / 4");
  }

  it("確認画面に入力内容が正しく表示される", async () => {
    const f = makeFetch();
    renderScreen(f.impl);
    await fillForm("123456", "private_2");
    fireEvent.click(btn("この内容で進む"));

    await screen.findByText("2 / 4");
    const card = screen.getByText("チケット種別").closest("dl")!;
    expect(within(card).getByText("2名様貸切チケット")).toBeTruthy();
    expect(within(card).getByText("なみぽよ")).toBeTruthy();
    expect(within(card).getByText("123-456")).toBeTruthy();
    expect(within(card).getByText("運営確認後に反映されます")).toBeTruthy();
  });

  it("チケット種別の人数に応じたコードネーム欄が出る", async () => {
    const f = makeFetch();
    renderScreen(f.impl);
    await fillForm("123456", "private_2");
    fireEvent.click(btn("この内容で進む"));
    await screen.findByText("2 / 4");
    fireEvent.click(btn("この内容で進む"));
    await screen.findByText("3 / 4");
    expect(screen.getByLabelText("プレイヤー1")).toBeTruthy();
    expect(screen.getByLabelText("プレイヤー2")).toBeTruthy();
  });

  it("戻って修正すると入力値が保持されている", async () => {
    const f = makeFetch();
    renderScreen(f.impl);
    await fillForm("123456", "private_2");
    fireEvent.click(btn("この内容で進む"));
    await screen.findByText("2 / 4");

    fireEvent.click(btn("戻って修正する"));
    await screen.findByText("1 / 4");
    expect((screen.getByLabelText(/チケット種別/) as HTMLSelectElement).value).toBe("private_2");
    expect((screen.getByLabelText(/お名前/) as HTMLInputElement).value).toBe("なみぽよ");
    expect((screen.getByLabelText(/予約番号/) as HTMLInputElement).value).toBe("123-456");
  });

  it("戻る操作では登録 API を呼ばない", async () => {
    const f = makeFetch();
    await goToFinal(f);
    fireEvent.click(btn("戻って修正する"));
    await screen.findByText("3 / 4");
    expect(f.calls.filter((c) => c.path === "/confirm")).toHaveLength(0);
  });

  it("「この内容で登録」を押したときにだけ /confirm が呼ばれる", async () => {
    const f = makeFetch();
    await goToFinal(f);
    expect(f.calls.filter((c) => c.path === "/confirm")).toHaveLength(0);

    fireEvent.click(btn("この内容で登録"));
    await waitFor(() => expect(f.calls.filter((c) => c.path === "/confirm")).toHaveLength(1));
    expect(f.calls.find((c) => c.path === "/confirm")!.body.draftId).toBe("d1");
  });

  it("登録中は二重送信されない", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => { release = r; });
    const f = makeFetch({
      "/confirm": async () => {
        await gate;
        return { ok: true, status: 200, json: async () => ({ success: true, data: { statusLabel: "運営確認待ち", alreadyRegistered: false } }) } as unknown as Response;
      },
    });
    await goToFinal(f);

    const b = btn("この内容で登録");
    fireEvent.click(b);
    await screen.findByRole("button", { name: /登録しています/ });
    fireEvent.click(screen.getByRole("button", { name: /登録しています/ }));
    fireEvent.click(screen.getByRole("button", { name: /登録しています/ }));

    release!();
    await screen.findByText("チケット連携を受け付けました");
    expect(f.calls.filter((c) => c.path === "/confirm")).toHaveLength(1);
  });

  it("API 失敗時は完了画面へ進まず、確認画面にエラーを出す", async () => {
    const f = makeFetch({
      "/confirm": () => ({
        ok: false, status: 500,
        json: async () => ({ success: false, error: { message: "" } }),
      }) as unknown as Response,
    });
    await goToFinal(f);
    fireEvent.click(btn("この内容で登録"));

    await screen.findByText("チケット連携を登録できませんでした。時間をおいて再度お試しください。");
    expect(screen.queryByText("チケット連携を受け付けました")).toBeNull();
    expect(screen.getByText("4 / 4")).toBeTruthy();

    // 支援技術へ通知される（色だけに依存しない）
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("チケット連携を登録できませんでした。時間をおいて再度お試しください。");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
  });

  it("API エラーの枠線は danger 一色で、カード枠線色と競合しない", async () => {
    const f = makeFetch({
      "/confirm": () => ({
        ok: false, status: 500,
        json: async () => ({ success: false, error: { message: "登録できませんでした。" } }),
      }) as unknown as Response,
    });
    await goToFinal(f);
    fireEvent.click(btn("この内容で登録"));

    const alert = await screen.findByRole("alert");
    const borderColors = alert.className.match(/border-\[color:[^\]]+\]/g) ?? [];
    // border-color ユーティリティは 1 つだけ = Tailwind の生成順に勝敗が左右されない
    expect(borderColors).toEqual(["border-[color:var(--liff-danger,#E22B2B)]"]);
    expect(alert.className).not.toContain("--liff-ui-card-border");
  });

  it("API がエラー文言を返した場合はそれを優先する", async () => {
    const f = makeFetch({
      "/confirm": () => ({
        ok: false, status: 409,
        json: async () => ({ success: false, error: { message: "すでに登録済みの予約番号です。" } }),
      }) as unknown as Response,
    });
    await goToFinal(f);
    fireEvent.click(btn("この内容で登録"));
    await screen.findByText("すでに登録済みの予約番号です。");
    expect(screen.queryByText("チケット連携を受け付けました")).toBeNull();
  });
});

describe("画面4: 登録受付完了", () => {
  async function complete(f: ReturnType<typeof makeFetch>) {
    renderScreen(f.impl);
    await fillForm("123456", "private_1");
    fireEvent.click(btn("この内容で進む"));
    await screen.findByText("2 / 4");
    fireEvent.click(btn("この内容で進む"));
    await screen.findByText("3 / 4");
    fireEvent.click(btn("登録内容を確認する"));
    await screen.findByText("4 / 4");
    fireEvent.click(btn("この内容で登録"));
    await screen.findByText("チケット連携を受け付けました");
  }

  it("完了画面に「運営確認待ち」と対象公演 / 予約番号が出る", async () => {
    const f = makeFetch();
    await complete(f);
    expect(screen.getByText("運営確認待ち")).toBeTruthy();
    const card = screen.getByText("連携状態").closest("dl")!;
    expect(within(card).getByText("OPERATION ; BELKISSH")).toBeTruthy();
    expect(within(card).getByText("123-456")).toBeTruthy();
  });

  it("完了画面には個人名を再表示しない", async () => {
    const f = makeFetch();
    await complete(f);
    expect(screen.queryByText("なみぽよ")).toBeNull();
  });

  it("「閉じる」は既存の LIFF 終了処理を呼び、データを再送しない", async () => {
    const f = makeFetch();
    await complete(f);
    const before = f.calls.length;

    fireEvent.click(btn("閉じる"));
    await waitFor(() => expect(closeWindow).toHaveBeenCalledTimes(1));
    expect(f.calls.length).toBe(before);
  });
});

describe("読み込み失敗", () => {
  it("config が取れないときは永続ローディングにせずエラーを出す", async () => {
    const f = makeFetch({
      "/config": () => ({
        ok: false, status: 403,
        json: async () => ({ success: false, error: { message: "この機能は現在ご利用いただけません。" } }),
      }) as unknown as Response,
    });
    renderScreen(f.impl);
    await screen.findByText("この機能は現在ご利用いただけません。");
    expect(screen.queryByText("読み込み中...")).toBeNull();
  });
});
