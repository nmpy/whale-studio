/**
 * src/__tests__/start-chain-expand.test.ts
 *
 * expandKeywordChain の検証（開始メッセージ連続送信の2通目以降が落ちないことの回帰）。
 *
 * 背景: 開始(kind="start")メッセージが nextMessageId で継続メッセージ(kind="normal")を
 *   持つ場合、startTrigger 経路は kind="start" のみ取得 + buildKeywordMessages(chain walk なし)
 *   のため head しか送れていなかった。expandKeywordChain で継続を展開して両方送る。
 */
import { describe, it, expect } from "vitest";
import { expandKeywordChain, buildKeywordMessages, type KeywordMessageRecord } from "@/lib/line";

function rec(id: string, over: Partial<KeywordMessageRecord> = {}): KeywordMessageRecord {
  return {
    id,
    messageType:     "text",
    body:            `body-${id}`,
    assetUrl:        null,
    altText:         null,
    flexPayloadJson: null,
    quickReplies:    null,
    nextMessageId:   null,
    sortOrder:       0,
    character:       null,
    ...over,
  };
}
const fetcher = (db: Map<string, KeywordMessageRecord>) =>
  async (id: string): Promise<KeywordMessageRecord | null> => db.get(id) ?? null;

describe("expandKeywordChain", () => {
  it("nextMessageId 連鎖を辿って継続メッセージを含める（順序保持）", async () => {
    const head = rec("m1", { body: "深い深い海の底。", nextMessageId: "m2" });
    const cont = rec("m2", { body: "……もしもし。 だれか、聞こえる？" });
    const out = await expandKeywordChain([head], fetcher(new Map([["m2", cont]])));
    expect(out.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("継続なし(nextMessageId=null)は head のみ", async () => {
    const out = await expandKeywordChain([rec("m1")], fetcher(new Map()));
    expect(out.map((m) => m.id)).toEqual(["m1"]);
  });

  it("head が freeInput プロンプトなら walk せず head のみ", async () => {
    const head = rec("m1", { nextMessageId: "m2", freeInputEnabled: true });
    const out = await expandKeywordChain([head], fetcher(new Map([["m2", rec("m2")]])));
    expect(out.map((m) => m.id)).toEqual(["m1"]);
  });

  it("継続が freeInput の場合はそれを含めて停止", async () => {
    const head = rec("m1", { nextMessageId: "m2" });
    const m2   = rec("m2", { nextMessageId: "m3", freeInputEnabled: true });
    const out  = await expandKeywordChain([head], fetcher(new Map([["m2", m2], ["m3", rec("m3")]])));
    expect(out.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("循環参照は安全に停止（重複追加しない）", async () => {
    const head = rec("m1", { nextMessageId: "m2" });
    const m2   = rec("m2", { nextMessageId: "m1" });
    const out  = await expandKeywordChain([head], fetcher(new Map([["m2", m2]])));
    expect(out.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("fetch=null（削除/非アクティブ）で停止", async () => {
    const head = rec("m1", { nextMessageId: "m2" });
    const out  = await expandKeywordChain([head], fetcher(new Map()));
    expect(out.map((m) => m.id)).toEqual(["m1"]);
  });

  it("cap で打ち切る", async () => {
    const mk = (n: number) => rec(`m${n}`, { nextMessageId: n < 10 ? `m${n + 1}` : null });
    const db = new Map<string, KeywordMessageRecord>();
    for (let n = 2; n <= 10; n++) db.set(`m${n}`, mk(n));
    const out = await expandKeywordChain([mk(1)], fetcher(db), 3);
    expect(out.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("展開後の2通を buildKeywordMessages に渡すと2通とも送信対象（実機順）", async () => {
    const head = rec("m1", { body: "深い深い海の底。 くじらは、砂の上で小さく光るものを見つけました。", nextMessageId: "m2" });
    const cont = rec("m2", { body: "……もしもし。 だれか、聞こえる？" });
    const expanded = await expandKeywordChain([head], fetcher(new Map([["m2", cont]])));
    const msgs = buildKeywordMessages(expanded);
    expect(msgs).toHaveLength(2);
    expect((msgs[0] as { text: string }).text).toContain("深い深い海の底");
    expect((msgs[1] as { text: string }).text).toContain("もしもし");
  });
});
