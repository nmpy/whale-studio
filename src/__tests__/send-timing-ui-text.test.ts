/**
 * src/__tests__/send-timing-ui-text.test.ts
 *
 * 送信タイミング UI 文言の回帰固定。
 * 「通常」は "フェーズ遷移時に送信" ではなく "表示順に自動送信" の意味に統一する
 * （通常メッセージはフェーズ入場時だけでなく、キーワード応答後・正解後・QR選択後の後続としても送られる）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FORM_PATH = join(
  process.cwd(),
  "src/app/oas/[id]/works/[workId]/messages/_form.tsx",
);
const src = readFileSync(FORM_PATH, "utf8");

describe("送信タイミング UI 文言", () => {
  it("「通常（フェーズ遷移時に送信）」という誤解を招くラベルが残っていない", () => {
    expect(src).not.toContain("通常（フェーズ遷移時に送信）");
  });

  it("「通常（表示順に自動送信）」ラベルが使われている", () => {
    expect(src).toContain("通常（表示順に自動送信）");
  });

  it("通常メッセージの説明が「表示順に自動送信」の意味になっている", () => {
    expect(src).toContain("表示順に自動送信されます");
  });

  it("QR Step2 に、通話リクエスト等は送信タイミングを『応答』にする案内がある", () => {
    expect(src).toContain("送信タイミングを「応答」にして保存");
  });
});
