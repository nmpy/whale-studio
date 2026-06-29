// src/__tests__/admin-help-select-knowledge.test.ts
// ヘルプAIの knowledge 選択ロジックの検証。
import { describe, it, expect } from "vitest";
import { selectKnowledge } from "@/lib/admin-help/select-knowledge";

const ids = (q: string, path?: string, ctx?: string) => selectKnowledge(q, path, ctx).map((k) => k.id);

describe("selectKnowledge", () => {
  it("「クイックリプライとは？」→ quick_reply を含む", () => {
    expect(ids("クイックリプライとは？")).toContain("quick_reply");
  });
  it("「ヒントを出したい」→ puzzle_hint を含む", () => {
    expect(ids("ヒントを出したい")).toContain("puzzle_hint");
  });
  it("「画像タップでフェーズ遷移」→ image_action を含む", () => {
    expect(ids("画像タップでフェーズ遷移したい")).toContain("image_action");
  });
  it("pathname が /messages 系 → messages を含む（現在画面優先）", () => {
    expect(ids("これは何", "/oas/x/works/y/messages")).toContain("messages");
  });
  it("pathname が /liff 系 → liff_pages を含む", () => {
    expect(ids("公開したい", "/oas/x/works/y/liff")).toContain("liff_pages");
  });
  it("関連なし → general のみ", () => {
    expect(ids("こんにちは")).toEqual(["general"]);
  });
  it("毎回全件は渡さない（最大5カテゴリ）", () => {
    const r = ids("メッセージ クイックリプライ ヒント 画像タップ LIFF お知らせ 通数 予約", "/messages");
    expect(r.length).toBeLessThanOrEqual(5);
  });
  it("マッチありでも general を補助として含む", () => {
    expect(ids("クイックリプライ")).toContain("general");
  });
  it("contextType がカテゴリ名なら採用", () => {
    expect(ids("これは何", undefined, "announcement")).toContain("announcement");
  });
});
