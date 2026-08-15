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
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { HintSearchRenderer } from "@/components/liff/HintSearchRenderer";

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

describe("ヒント一覧（開封済みのみ）", () => {
  it("何も開いていなければ空状態で、ヒントタイトルは出ない", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "これまでに開いたヒントを見る" }));
    expect(await screen.findByRole("heading", { name: "ヒント一覧" })).toBeTruthy();
    expect(screen.getByText(/まだ開いたヒントはありません/)).toBeTruthy();
    expect(html()).not.toContain(SECRET.listTitle);
    expect(html()).not.toContain(SECRET.hint1);
  });

  it("開いたヒントだけが一覧に載り、開示状況が表示される", async () => {
    renderPage();
    await search("キーボード");
    await screen.findByText(SECRET.hint1);
    fireEvent.click(screen.getByRole("button", { name: "別のキーワードで探す" }));
    fireEvent.click(await screen.findByRole("button", { name: "これまでに開いたヒントを見る" }));

    expect(await screen.findByRole("heading", { name: "ヒント一覧" })).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("button", { name: "これまでに開いたヒントを見る" }));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(SECRET.listTitle) }));

    expect(await screen.findByText(SECRET.hint2)).toBeTruthy();
    expect(screen.getByRole("button", { name: "ヒント一覧へ戻る" })).toBeTruthy();
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
