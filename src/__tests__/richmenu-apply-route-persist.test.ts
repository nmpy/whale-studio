/**
 * src/__tests__/richmenu-apply-route-persist.test.ts
 *
 * apply route が渡す persist（DB 更新）の契約を静的に固定する。
 *
 * ここで守りたいのは 2 点:
 *   - `rich_menus.line_rich_menu_id` と `oas.rich_menu_id` を **同一 transaction** で更新する
 *     （片方だけ新 ID になった状態を作らない）
 *   - DB 更新は `applyRichMenuConfig` の **内側**（persist）で行う
 *     ＝ setDefault 成功後に DB が失敗したとき、旧 default へ rollback できる
 *
 * route は withAuth / Prisma / LINE API に深く依存していて単体実行が重いので、
 * ソースの構造を検証する（実挙動は richmenu-apply-failure-safe.test.ts が担保）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE = readFileSync(
  join(process.cwd(), "src/app/api/rich-menus/[id]/apply/route.ts"),
  "utf-8",
);

describe("Test 9 — DB 2 箇所は同一 transaction", () => {
  it("richMenu.update と oa.update が 1 つの $transaction にまとまっている", () => {
    const tx = ROUTE.match(/prisma\.\$transaction\(\[[\s\S]*?\]\)/);
    expect(tx, "$transaction([...]) が見つからない").not.toBeNull();
    const body = tx![0];
    expect(body).toContain("prisma.richMenu.update");
    expect(body).toContain("prisma.oa.update");
    expect(body).toContain("lineRichMenuId");
    expect(body).toContain("richMenuId");
  });

  it("transaction の外で片方だけ update していない", () => {
    // $transaction ブロックを除いた本文に richMenu.update / oa.update が残っていないこと。
    const withoutTx = ROUTE.replace(/prisma\.\$transaction\(\[[\s\S]*?\]\)/g, "«TX»");
    expect(withoutTx).not.toContain("prisma.richMenu.update");
    expect(withoutTx).not.toContain("prisma.oa.update");
  });

  it("DB 更新後に 2 箇所の read-back を行っている", () => {
    expect(ROUTE).toContain("prisma.richMenu.findUnique");
    expect(ROUTE).toContain("prisma.oa.findUnique");
    expect(ROUTE).toMatch(/read-back\s*不一致/);
  });
});

describe("DB 更新は applyRichMenuConfig の内側（persist）で行う", () => {
  it("persist コールバックとして渡している", () => {
    expect(ROUTE).toMatch(/applyRichMenuConfig\(\{[\s\S]*?persist:\s*async \(/);
  });

  it("transaction が persist の内側にある（= apply の後段で単独実行していない）", () => {
    const applyStart = ROUTE.indexOf("applyRichMenuConfig({");
    const persistStart = ROUTE.indexOf("persist: async (", applyStart);
    const txStart = ROUTE.indexOf("prisma.$transaction([", persistStart);
    expect(applyStart).toBeGreaterThan(-1);
    expect(persistStart).toBeGreaterThan(applyStart);
    expect(txStart).toBeGreaterThan(persistStart);
  });

  it("旧メニュー削除を route 側で先に呼んでいない", () => {
    expect(ROUTE).not.toContain("deleteRichMenu");
  });
});

describe("Error response — 一次原因が運用者に伝わる", () => {
  it("RichMenuApplyError の operatorMessage を返している", () => {
    expect(ROUTE).toContain("RichMenuApplyError");
    expect(ROUTE).toContain("err.operatorMessage");
  });

  it("画像検証エラーは 400、それ以外は 500", () => {
    expect(ROUTE).toMatch(/image_validation[\s\S]*?\?\s*400\s*:\s*500/);
  });

  it("既存の error response 契約（code / step / message）を維持している", () => {
    expect(ROUTE).toContain('code:    "APPLY_ERROR"');
    expect(ROUTE).toMatch(/step:\s*err\.stage/);
  });
});
