// @vitest-environment jsdom
/**
 * src/__tests__/liff-hint-search-render.test.tsx
 *
 * 検索型ヒントページ (page_type="hint_search") の描画とネタバレ防止を検証する。
 *
 * ここで担保したいのは「CSS で隠しているだけではない」こと。
 * 初期画面の DOM に、ヒントタイトル / 本文 / 固有名詞 / 質問ツリーの選択肢が
 * **1 文字も存在しない**ことを HTML 文字列レベルで確認する。
 *
 * preview=true でローカル検索クライアントを使い、実 API を叩かずに状態遷移を通す
 * （検索ロジックはサーバーと同一実装を共有しているため、判定結果は実機と一致する）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { HintSearchRenderer } from "@/components/liff/HintSearchRenderer";
import {
  normalizeHintSearchEntries,
  searchHintEntries,
  toDetail,
  toListItem,
  toResultItem,
} from "@/lib/liff/hint-search";

// 未来の展開を含む「絶対に先出ししてはいけない」文字列。
const SECRET = {
  listTitle:   "キーボード",
  resultLabel: "キーボードについて",
  hint1:       "机の上だけでなく、目線より低い位置もご確認ください。",
  hint2:       "引き出しの中にもう一つ同じ形のものがあります。",
  answer:      "キーボードの裏に合言葉が刻印されています。",
  person:      "シャーリ・プラグマトン",
  category:    "持ち物・道具",
  guideOption: "手元のものの扱い方がわからない",
  guideChild:  "まだ全体を見ていない",
};

const PREVIEW_SOURCE = {
  entries: [
    {
      id: "e-keyboard",
      internal_title: "P7 - S.I.R.E.N施設特定後の次行動",
      search_result_label: SECRET.resultLabel,
      list_title: SECRET.listTitle,
      category_label: SECRET.category,
      keywords: ["キーボード", "机"],
      aliases: ["keyboard"],
      hints: [{ level: 1, body: SECRET.hint1 }, { level: 2, body: SECRET.hint2 }],
      answer: SECRET.answer,
    },
    {
      id: "e-desk",
      search_result_label: "机の下にあるものについて",
      keywords: ["机"],
      hints: [{ level: 1, body: "机の下のヒント" }],
    },
    {
      id: "e-person",
      search_result_label: "ある人物について",
      aliases: [SECRET.person],
      hints: [{ level: 1, body: "人物のヒント" }],
    },
  ],
  guideQuestion: "いま、どちらに近い状態でしょうか。",
  guideOptions: [
    {
      label: SECRET.guideOption,
      question: "そのものについて、どこまで確認されましたか。",
      options: [{ label: SECRET.guideChild, hint_id: "e-keyboard" }],
    },
  ],
};

function renderPage() {
  return render(
    <HintSearchRenderer
      workId="w1"
      pageId="p1"
      preview
      previewSource={PREVIEW_SOURCE}
    />,
  );
}

/** 現在の DOM 全体の HTML。ネタバレ検査は必ずこれに対して行う。 */
function html(): string {
  return document.body.innerHTML;
}

async function search(term: string) {
  fireEvent.change(screen.getByLabelText("お困りの内容を入力してください"), { target: { value: term } });
  fireEvent.click(screen.getByRole("button", { name: /ヒントを探す|もう一度探す/ }));
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("初期画面 — 検索するまで情報を増やさない", () => {
  it("仕様どおりの見出し / 説明 / ラベル / placeholder が出る", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "ヒントページ" })).toBeTruthy();
    expect(screen.getByText("お困りの内容にあてはまるキーワードをご入力ください。該当するヒントのみを表示します。")).toBeTruthy();
    expect(screen.getByLabelText("お困りの内容を入力してください")).toBeTruthy();
    expect(screen.getByPlaceholderText("例：さがしているものの名前")).toBeTruthy();
    expect(screen.getByRole("button", { name: "ヒントを探す" })).toBeTruthy();
  });

  it("ヒントタイトル / 本文 / 答え / 固有名詞が DOM に 1 文字も無い", () => {
    renderPage();
    const source = html();
    for (const secret of Object.values(SECRET)) {
      expect(source).not.toContain(secret);
    }
  });

  it("質問ツリーの選択肢も、押すまでは DOM に無い", () => {
    renderPage();
    expect(html()).not.toContain(SECRET.guideOption);
    expect(screen.getByRole("button", { name: "キーワードがわからない場合" })).toBeTruthy();
  });

  it("入力欄に label が結び付いていて、Enter でも検索できる", async () => {
    renderPage();
    const input = screen.getByLabelText("お困りの内容を入力してください") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "キーボード" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("キーワードを確認しました")).toBeTruthy();
  });
});

describe("0 件", () => {
  it("指定文言のエラーと「入力のヒント」2 項目が出る", async () => {
    renderPage();
    await search("そんな言葉はない");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("該当するヒントが見つかりませんでした。言葉を変えてお試しください。");
    expect(screen.getByText("入力のヒント")).toBeTruthy();
    expect(screen.getByText("お探しのものの「名前」をそのままご入力ください")).toBeTruthy();
    expect(screen.getByText("見つけたい場所や人物名でも検索できます")).toBeTruthy();
    expect(screen.getByRole("button", { name: "もう一度探す" })).toBeTruthy();
  });

  it("入力欄が error 状態になり、そのまま編集して再検索できる", async () => {
    renderPage();
    await search("そんな言葉はない");
    const input = await screen.findByLabelText("お困りの内容を入力してください") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.className).toContain("liff-box-input--error");
    expect(input.value).toBe("そんな言葉はない");

    fireEvent.change(input, { target: { value: "キーボード" } });
    fireEvent.click(screen.getByRole("button", { name: "ヒントを探す" }));
    expect(await screen.findByText("キーワードを確認しました")).toBeTruthy();
  });

  it("空入力ではエラー文言を出し、ヒントは一切出さない", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "ヒントを探す" }));
    expect((await screen.findByRole("alert")).textContent).toBe("キーワードを入力してください。");
    expect(html()).not.toContain(SECRET.hint1);
  });
});

describe("1 件一致 → 段階ヒント → 答え", () => {
  it("確認見出し・入力内容・ヒント1 を出し、ヒント2 の本文は出さない", async () => {
    renderPage();
    await search("キーボード");
    expect(await screen.findByText("キーワードを確認しました")).toBeTruthy();
    expect(screen.getByText("入力した内容")).toBeTruthy();
    expect(screen.getByText("キーボード")).toBeTruthy();
    expect(screen.getByText(SECRET.hint1)).toBeTruthy();
    // 次の段階はボタンだけ。本文は DOM に無い。
    expect(html()).not.toContain(SECRET.hint2);
    expect(screen.getByRole("button", { name: "もう少し踏み込んだヒントを見る" })).toBeTruthy();
  });

  it("ネタバレ度バッジが段階ごとに出る", async () => {
    renderPage();
    await search("キーボード");
    await screen.findByText(SECRET.hint1);
    expect(screen.getByText("ネタバレ度 低")).toBeTruthy();
    expect(screen.getByText("ネタバレ度 中")).toBeTruthy();
  });

  it("踏み込んだヒントを押すとヒント2 の本文が出る", async () => {
    renderPage();
    await search("キーボード");
    fireEvent.click(await screen.findByRole("button", { name: "もう少し踏み込んだヒントを見る" }));
    expect(await screen.findByText(SECRET.hint2)).toBeTruthy();
  });

  it("答えは確認画面で同意するまで DOM に出ない", async () => {
    renderPage();
    await search("キーボード");
    await screen.findByText(SECRET.hint1);
    expect(html()).not.toContain(SECRET.answer);

    fireEvent.click(screen.getByRole("button", { name: "答えを見る（ネタバレを含みます）" }));
    expect(await screen.findByRole("heading", { name: "答えを表示します" })).toBeTruthy();
    // 確認画面でもまだ本文は出さない
    expect(html()).not.toContain(SECRET.answer);

    // 同意チェックを入れるまで実行ボタンは押せない
    const confirm = screen.getByRole("button", { name: "答えを見る" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("ネタバレを含むことを理解しました"));
    expect((screen.getByRole("button", { name: "答えを見る" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "答えを見る" }));
    expect(await screen.findByText(SECRET.answer)).toBeTruthy();
  });

  it("確認画面で「やめておく」を押すと答えは出ないまま詳細へ戻る", async () => {
    renderPage();
    await search("キーボード");
    fireEvent.click(await screen.findByRole("button", { name: "答えを見る（ネタバレを含みます）" }));
    fireEvent.click(await screen.findByRole("button", { name: "やめておく" }));
    expect(await screen.findByText(SECRET.hint1)).toBeTruthy();
    expect(html()).not.toContain(SECRET.answer);
  });
});

describe("複数件一致", () => {
  it("勝手に 1 件へ進まず候補を並べ、本文は出さない", async () => {
    renderPage();
    await search("机");
    expect(await screen.findByRole("heading", { name: "該当するヒントが複数見つかりました" })).toBeTruthy();
    expect(screen.getByText("お困りの内容に近いものを選択してください。")).toBeTruthy();
    expect(screen.getByRole("button", { name: SECRET.resultLabel })).toBeTruthy();
    expect(screen.getByRole("button", { name: "机の下にあるものについて" })).toBeTruthy();
    // 候補一覧の時点では本文なし
    expect(html()).not.toContain(SECRET.hint1);
  });

  it("候補を選ぶと詳細へ進み、検索結果へ戻れる", async () => {
    renderPage();
    await search("机");
    fireEvent.click(await screen.findByRole("button", { name: SECRET.resultLabel }));
    expect(await screen.findByText(SECRET.hint1)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "検索結果に戻る" }));
    expect(await screen.findByRole("heading", { name: "該当するヒントが複数見つかりました" })).toBeTruthy();
  });
});

describe("見たヒント（開封済みのみ）", () => {
  it("何も開いていなければ空状態で、ヒントタイトルは出ない", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "これまでに見たヒント" }));
    expect(await screen.findByRole("heading", { name: "見たヒント" })).toBeTruthy();
    expect(screen.getByText(/まだ見たヒントはありません/)).toBeTruthy();
    expect(html()).not.toContain(SECRET.listTitle);
    expect(html()).not.toContain(SECRET.hint1);
  });

  it("開いたヒントだけが一覧に載り、開示状況が表示される", async () => {
    renderPage();
    await search("キーボード");
    await screen.findByText(SECRET.hint1);
    fireEvent.click(screen.getByRole("button", { name: "別のキーワードで探す" }));
    fireEvent.click(await screen.findByRole("button", { name: "これまでに見たヒント" }));

    expect(await screen.findByRole("heading", { name: "見たヒント" })).toBeTruthy();
    expect(screen.getByText(SECRET.listTitle)).toBeTruthy();
    expect(screen.getByText("ヒント1を表示済 ／ 残り2件")).toBeTruthy();
    // 未開封の他のヒントは一覧にも載らない
    expect(html()).not.toContain("机の下にあるものについて");
    expect(html()).not.toContain("ある人物について");
  });

  it("一覧から詳細へ入ると開示段階が復元される", async () => {
    renderPage();
    await search("キーボード");
    fireEvent.click(await screen.findByRole("button", { name: "もう少し踏み込んだヒントを見る" }));
    await screen.findByText(SECRET.hint2);
    fireEvent.click(screen.getByRole("button", { name: "別のキーワードで探す" }));
    fireEvent.click(await screen.findByRole("button", { name: "これまでに見たヒント" }));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(SECRET.listTitle) }));

    expect(await screen.findByText(SECRET.hint2)).toBeTruthy();
    expect(screen.getByRole("button", { name: "見たヒントへ戻る" })).toBeTruthy();
  });
});

describe("キーワードがわからない場合（質問ツリー）", () => {
  it("押して初めて質問と選択肢が出る。子の選択肢はまだ出ない", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "キーワードがわからない場合" }));
    expect(await screen.findByRole("heading", { name: "いま、どちらに近い状態でしょうか。" })).toBeTruthy();
    expect(screen.getByRole("button", { name: SECRET.guideOption })).toBeTruthy();
    expect(screen.getByText("選ばなかった話題の内容は表示されません。安心してお進みください。")).toBeTruthy();
    // 1 階層ずつしか取らないので、子の選択肢とヒント本文はまだ DOM に無い
    expect(html()).not.toContain(SECRET.guideChild);
    expect(html()).not.toContain(SECRET.hint1);
  });

  it("選択肢を辿るとヒントに到達し、パンくずが出る", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "キーワードがわからない場合" }));
    fireEvent.click(await screen.findByRole("button", { name: SECRET.guideOption }));
    expect(await screen.findByRole("heading", { name: "そのものについて、どこまで確認されましたか。" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: SECRET.guideChild }));
    expect(await screen.findByText(SECRET.hint1)).toBeTruthy();
    expect(screen.getByText(`${SECRET.guideOption} › ${SECRET.guideChild}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "最初の質問に戻る" })).toBeTruthy();
  });

  it("「ひとつ前に戻る」で質問1へ、ルートでは検索画面へ戻る", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "キーワードがわからない場合" }));
    fireEvent.click(await screen.findByRole("button", { name: SECRET.guideOption }));
    fireEvent.click(await screen.findByRole("button", { name: "ひとつ前に戻る" }));
    expect(await screen.findByRole("heading", { name: "いま、どちらに近い状態でしょうか。" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "キーワード入力に戻る" }));
    expect(await screen.findByRole("heading", { name: "ヒントページ" })).toBeTruthy();
  });
});

describe("連打対策", () => {
  it("検索ボタンを連打しても表示が壊れない", async () => {
    renderPage();
    const input = screen.getByLabelText("お困りの内容を入力してください");
    fireEvent.change(input, { target: { value: "キーボード" } });
    const button = screen.getByRole("button", { name: "ヒントを探す" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByText("キーワードを確認しました")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText(SECRET.hint1).length).toBe(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// 全ヒント一覧（= 「ヒント一覧を見る」導線）
//
// ここだけは preview（ローカル検索）ではなく **実機と同じ API 経路** で検証する。
// 「list API がいつ呼ばれるか / 何を返すか」がネタバレ防止の要件そのものなので、
// fetch を差し替えてリクエスト本文を直接観測する。
// レスポンスはサーバー route と同じ純関数 (toListItem / toDetail / …) で組み立て、
// 「テスト用に都合の良い形」を作らない。
// ─────────────────────────────────────────────────────────────────

const SERVER_ENTRIES = normalizeHintSearchEntries(PREVIEW_SOURCE.entries);

/** 送信されたリクエスト本文（mode 付き）を時系列で記録する。 */
let sentBodies: Array<Record<string, unknown>> = [];

function stubApi() {
  sentBodies = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    sentBodies.push(body);

    const ok = (data: unknown) =>
      ({ ok: true, json: async () => ({ success: true, data }) }) as unknown as Response;

    switch (body.mode) {
      case "list":
        return ok({ items: SERVER_ENTRIES.map(toListItem) });
      case "search": {
        const matches = searchHintEntries(SERVER_ENTRIES, String(body.q ?? ""));
        return ok({
          items:  matches.map((m) => toResultItem(m.entry)),
          detail: matches.length === 1 ? toDetail(matches[0].entry) : null,
        });
      }
      case "detail": {
        const e = SERVER_ENTRIES.find((x) => x.id === body.id);
        return ok({ detail: e ? toDetail(e) : null });
      }
      case "answer": {
        const e = SERVER_ENTRIES.find((x) => x.id === body.id);
        return ok({ answer: e?.answer ?? "" });
      }
      default:
        return ok({});
    }
  }));
}

const modesSent = () => sentBodies.map((b) => b.mode);

function renderWithApi() {
  return render(<HintSearchRenderer workId="w1" pageId="p1" />);
}

describe("ヒント一覧を見る（全件・ネタバレ警告つき）", () => {
  beforeEach(() => { stubApi(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("初期表示では API を一切叩かず、未開封ヒントのタイトルも DOM に無い", () => {
    renderWithApi();
    expect(sentBodies).toEqual([]);
    expect(html()).not.toContain(SECRET.listTitle);
    expect(html()).not.toContain("机の下にあるものについて");
    expect(html()).not.toContain("ある人物について");
  });

  it("「ヒント一覧を見る」導線がある（primary の緑ボタンではない）", () => {
    renderWithApi();
    const link = screen.getByRole("button", { name: "ヒント一覧を見る" });
    // primary CTA（filled = 緑塗り）と同じ見た目にしない。
    expect(link.className).not.toContain("bg-[color:var(--liff-line-green,#06C755)]");
  });

  it("押しただけでは一覧を表示せず、確認ダイアログを出す", async () => {
    renderWithApi();
    fireEvent.click(screen.getByRole("button", { name: "ヒント一覧を見る" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("heading", { name: "ヒント一覧を表示しますか？" })).toBeTruthy();
    expect(screen.getByText("ヒント一覧には今後の展開に関する内容が含まれる可能性があります。ネタバレを含む情報を表示してもよろしいですか？")).toBeTruthy();
    expect(screen.getByRole("button", { name: "戻る" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "それでも一覧を見る" })).toBeTruthy();

    // ダイアログを開いた時点では list API を呼んでいない = タイトルは手元に無い。
    expect(modesSent()).not.toContain("list");
    expect(html()).not.toContain(SECRET.listTitle);
    expect(html()).not.toContain("机の下にあるものについて");
  });

  it("「戻る」ではダイアログを閉じるだけで、list API を呼ばない", async () => {
    renderWithApi();
    fireEvent.click(screen.getByRole("button", { name: "ヒント一覧を見る" }));
    fireEvent.click(await screen.findByRole("button", { name: "戻る" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(modesSent()).not.toContain("list");
    expect(sentBodies).toEqual([]);
    // 一覧は一切表示されず、検索画面のまま。
    expect(screen.getByRole("heading", { name: "ヒントページ" })).toBeTruthy();
    expect(html()).not.toContain(SECRET.listTitle);
  });

  it("ESC でもキャンセル扱いになり、list API を呼ばない", async () => {
    renderWithApi();
    fireEvent.click(screen.getByRole("button", { name: "ヒント一覧を見る" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
    expect(modesSent()).not.toContain("list");
  });

  it("「それでも一覧を見る」で初めて list API を 1 回だけ呼ぶ", async () => {
    renderWithApi();
    fireEvent.click(screen.getByRole("button", { name: "ヒント一覧を見る" }));
    fireEvent.click(await screen.findByRole("button", { name: "それでも一覧を見る" }));

    expect(await screen.findByRole("heading", { name: "ヒント一覧" })).toBeTruthy();
    expect(modesSent()).toEqual(["list"]);
  });

  it("一覧はタイトルのみ。本文・答え・internal_title は返ってきていない", async () => {
    renderWithApi();
    fireEvent.click(screen.getByRole("button", { name: "ヒント一覧を見る" }));
    fireEvent.click(await screen.findByRole("button", { name: "それでも一覧を見る" }));
    await screen.findByRole("heading", { name: "ヒント一覧" });

    // 注意書き
    expect(screen.getByText("このページには今後の展開に関する内容が含まれます。")).toBeTruthy();
    // player-facing title は出る（全件）
    expect(screen.getByRole("button", { name: new RegExp(SECRET.listTitle) })).toBeTruthy();
    expect(screen.getByRole("button", { name: /机の下にあるものについて/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /ある人物について/ })).toBeTruthy();
    // 本文 / 答え / internal_title は 1 文字も無い（初期展開しない）
    expect(html()).not.toContain(SECRET.hint1);
    expect(html()).not.toContain(SECRET.hint2);
    expect(html()).not.toContain(SECRET.answer);
    expect(html()).not.toContain("P7");
    expect(html()).not.toContain("S.I.R.E.N");
  });

  it("一覧から 1 件選ぶと、そのヒントだけ detail API で取得する", async () => {
    renderWithApi();
    fireEvent.click(screen.getByRole("button", { name: "ヒント一覧を見る" }));
    fireEvent.click(await screen.findByRole("button", { name: "それでも一覧を見る" }));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(SECRET.listTitle) }));

    expect(await screen.findByText(SECRET.hint1)).toBeTruthy();
    // list → detail の 2 回だけ。detail は選んだ 1 件分のみ。
    expect(modesSent()).toEqual(["list", "detail"]);
    expect(sentBodies[1].id).toBe("e-keyboard");
    // 他のヒントの本文は取得していない
    expect(html()).not.toContain("机の下のヒント");
    expect(html()).not.toContain("人物のヒント");
    // 段階ヒント / spoiler badge / answer 確認フローは維持されている
    expect(html()).not.toContain(SECRET.hint2);
    expect(screen.getByText("ネタバレ度 低")).toBeTruthy();
    expect(screen.getByRole("button", { name: "答えを見る（ネタバレを含みます）" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ヒント一覧へ戻る" })).toBeTruthy();
  });

  it("「見たヒント」と「ヒント一覧」は別導線・別画面", async () => {
    renderWithApi();
    // 導線が 2 本並んでいる
    expect(screen.getByRole("button", { name: "これまでに見たヒント" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ヒント一覧を見る" })).toBeTruthy();

    // 見たヒント: 確認ダイアログ無しで開き、未開封は載らない（API も叩かない）
    fireEvent.click(screen.getByRole("button", { name: "これまでに見たヒント" }));
    expect(await screen.findByRole("heading", { name: "見たヒント" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sentBodies).toEqual([]);
    expect(html()).not.toContain(SECRET.listTitle);
    expect(html()).not.toContain("机の下にあるものについて");

    // ヒント一覧: 確認ダイアログを経て全件タイトルが出る
    fireEvent.click(screen.getByRole("button", { name: "キーワードを入力して探す" }));
    fireEvent.click(await screen.findByRole("button", { name: "ヒント一覧を見る" }));
    fireEvent.click(await screen.findByRole("button", { name: "それでも一覧を見る" }));
    expect(await screen.findByRole("heading", { name: "ヒント一覧" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /机の下にあるものについて/ })).toBeTruthy();
  });

  it("検索で開いたヒントは「見たヒント」に載り、未開封は載らない", async () => {
    renderWithApi();
    await search("キーボード");
    await screen.findByText(SECRET.hint1);
    fireEvent.click(screen.getByRole("button", { name: "別のキーワードで探す" }));
    fireEvent.click(await screen.findByRole("button", { name: "これまでに見たヒント" }));

    await screen.findByRole("heading", { name: "見たヒント" });
    expect(screen.getByText(SECRET.listTitle)).toBeTruthy();
    // 未開封の 2 件は載らない
    expect(html()).not.toContain("机の下にあるものについて");
    expect(html()).not.toContain("ある人物について");
    // 見たヒントの表示に list API は使わない
    expect(modesSent()).not.toContain("list");
  });
});
