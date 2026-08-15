// src/components/liff/hint-search/client.ts
//
// 検索型ヒントページのデータ取得層。renderer は必ずこの interface 越しにデータへ触る。
//
//   - 実機 (LIFF) : createApiHintSearchClient — サーバー API を叩き、必要な分だけ受け取る。
//                   未検索のヒント / 選んでいない枝の内容はクライアントへ一切降ってこない。
//   - CMS プレビュー: createLocalHintSearchClient — 編集中の settings をその場で検索する
//                   （保存前でも見た目を確認できるようにするため）。検索ロジックは
//                   サーバーと同じ `@/lib/liff/hint-search` を共有するので挙動が二重化しない。

import {
  normalizeHintSearchEntries,
  normalizeHintSearchGuide,
  resolveGuidePath,
  searchHintEntries,
  toDetail,
  toListItem,
  toResultItem,
  HINT_SEARCH_GUIDE_DEFAULT_QUESTION,
  type HintSearchDetail,
  type HintSearchResultItem,
} from "@/lib/liff/hint-search";

export interface HintSearchSearchResult {
  items: HintSearchResultItem[];
  /** ヒットが 1 件のときだけ入る（往復を減らすため同梱される）。 */
  detail: HintSearchDetail | null;
}

export interface HintSearchGuideStep {
  /** これまでに選んだ選択肢のラベル（パンくず）。 */
  breadcrumb: string[];
  /** 次に出す質問文。葉に到達した場合は null。 */
  question: string | null;
  /** 選択肢（ラベルのみ）。葉に到達した場合は空配列。 */
  options: Array<{ label: string }>;
  /** 葉に到達したときのヒント詳細。 */
  detail: HintSearchDetail | null;
}

export interface HintSearchClient {
  search(query: string): Promise<HintSearchSearchResult>;
  detail(id: string): Promise<HintSearchDetail>;
  /** 答え本文。プレイヤーが確認画面で明示同意した後にだけ呼ぶこと。 */
  answer(id: string): Promise<string>;
  /**
   * 全ヒントのプレイヤー向けタイトル一覧。
   * ⚠️ ネタバレ警告ダイアログで「それでも一覧を見る」を押した後にだけ呼ぶこと。
   *    初期表示・ダイアログ表示・キャンセル時には絶対に呼ばない。
   */
  list(): Promise<HintSearchResultItem[]>;
  /** 質問ツリーを 1 階層進める。path=[] がルート（質問1）。 */
  guide(path: number[]): Promise<HintSearchGuideStep>;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!json?.success || !json.data) {
    throw new Error(json?.error?.message ?? "ヒントを取得できませんでした");
  }
  return json.data;
}

/** 実機用。workId / pageId は URL に出ている公開 ID をそのまま使える。 */
export function createApiHintSearchClient(
  workId: string,
  pageId: string,
  preview = false,
): HintSearchClient {
  const url = `/api/liff/works/${encodeURIComponent(workId)}/pages/${encodeURIComponent(pageId)}/hint-search`;
  return {
    // 検索語は query string ではなく body で送る（アクセスログ / リファラに残さない）。
    search: (query) => postJson<HintSearchSearchResult>(url, { mode: "search", q: query, preview }),
    detail: (id) =>
      postJson<{ detail: HintSearchDetail }>(url, { mode: "detail", id, preview }).then((d) => d.detail),
    answer: (id) =>
      postJson<{ answer: string }>(url, { mode: "answer", id, preview }).then((d) => d.answer),
    list:   () =>
      postJson<{ items: HintSearchResultItem[] }>(url, { mode: "list", preview }).then((d) => d.items),
    guide:  (path) => postJson<HintSearchGuideStep>(url, { mode: "guide", path, preview }),
  };
}

interface LocalSource {
  entries?: unknown;
  guideOptions?: unknown;
  guideQuestion?: unknown;
}

/** CMS プレビュー用。編集中の settings_json をそのまま検索する。 */
export function createLocalHintSearchClient(source: LocalSource): HintSearchClient {
  const entries = normalizeHintSearchEntries(source.entries);
  const guideRoot = normalizeHintSearchGuide(source.guideOptions);
  const rootQuestion = typeof source.guideQuestion === "string" && source.guideQuestion.trim() !== ""
    ? source.guideQuestion.trim()
    : HINT_SEARCH_GUIDE_DEFAULT_QUESTION;

  const find = (id: string) => entries.find((e) => e.id === id);

  return {
    async search(query) {
      const matches = searchHintEntries(entries, query);
      return {
        items:  matches.map((m) => toResultItem(m.entry)),
        detail: matches.length === 1 ? toDetail(matches[0].entry) : null,
      };
    },
    async detail(id) {
      const entry = find(id);
      if (!entry) throw new Error("ヒントが見つかりませんでした");
      return toDetail(entry);
    },
    async answer(id) {
      const entry = find(id);
      if (!entry?.answer) throw new Error("答えは登録されていません");
      return entry.answer;
    },
    async list() {
      return entries.map(toListItem);
    },
    async guide(path) {
      const resolved = resolveGuidePath(guideRoot, path);
      if (!resolved.ok) throw new Error("選択肢が見つかりませんでした");
      const node = resolved.node;
      const options = node ? node.options : guideRoot;
      if (options.length === 0 && node?.hintId) {
        const entry = find(node.hintId);
        if (!entry) throw new Error("ヒントが見つかりませんでした");
        return { breadcrumb: resolved.breadcrumb, question: null, options: [], detail: toDetail(entry) };
      }
      return {
        breadcrumb: resolved.breadcrumb,
        question:   node ? (node.question ?? HINT_SEARCH_GUIDE_DEFAULT_QUESTION) : rootQuestion,
        options:    options.map((o) => ({ label: o.label })),
        detail:     null,
      };
    },
  };
}
