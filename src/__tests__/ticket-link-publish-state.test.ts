/**
 * src/__tests__/ticket-link-publish-state.test.ts
 *
 * チケット連携タブの「公開／非公開」操作で送るリクエスト body の回帰テスト。
 *
 * 背景（本番障害）:
 *   公開トグルが publish_status だけを送り is_enabled を送らなかったため、
 *   CMS 上は「公開中」でも DB は publish_status="published" / is_enabled=false のままだった。
 *   プレイヤー向けページ取得 API は is_enabled=true を要求するため、
 *   LIFF で開いても 404 LIFF_DISABLED になり、ページが表示できなかった。
 *
 * このリポジトリには testing-library / jsdom が無く（vitest environment="node"）、
 * React コンポーネントの操作テストは依存追加なしでは書けない。
 * そこで「送信 body を組み立てる純関数」を検証対象にし、
 * publish_status と is_enabled が常に整合することを固定する。
 */
import { describe, it, expect } from "vitest";
import { buildLiffPagePublishPatch } from "@/app/oas/[id]/works/[workId]/liff/_tabs-config";

describe("buildLiffPagePublishPatch — 公開状態と有効フラグを常に揃える", () => {
  it("非公開(draft) から公開すると published + is_enabled=true を送る", () => {
    expect(buildLiffPagePublishPatch("draft")).toEqual({
      publish_status: "published",
      is_enabled:     true,
    });
  });

  it("公開(published) から非公開にすると draft + is_enabled=false を送る", () => {
    expect(buildLiffPagePublishPatch("published")).toEqual({
      publish_status: "draft",
      is_enabled:     false,
    });
  });

  it("publish_status 未設定は「未公開」とみなして公開側へ倒す", () => {
    expect(buildLiffPagePublishPatch(null)).toEqual({
      publish_status: "published",
      is_enabled:     true,
    });
    expect(buildLiffPagePublishPatch(undefined)).toEqual({
      publish_status: "published",
      is_enabled:     true,
    });
  });

  it("archived からも公開できる（published + is_enabled=true）", () => {
    expect(buildLiffPagePublishPatch("archived")).toEqual({
      publish_status: "published",
      is_enabled:     true,
    });
  });

  it("is_enabled が publish_status と食い違う結果を返さない（不整合の禁止）", () => {
    for (const current of ["draft", "published", "archived", null, undefined]) {
      const patch = buildLiffPagePublishPatch(current);
      expect(patch.is_enabled).toBe(patch.publish_status === "published");
    }
  });

  it("body には publish_status と is_enabled 以外を含めない（意図しない上書きを防ぐ）", () => {
    expect(Object.keys(buildLiffPagePublishPatch("draft")).sort()).toEqual(
      ["is_enabled", "publish_status"],
    );
  });
});
