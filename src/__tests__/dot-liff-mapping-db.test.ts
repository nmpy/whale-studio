/**
 * src/__tests__/dot-liff-mapping-db.test.ts
 *
 * D.O.T（ドット）の「作品 → OA → liffId → 実機/リッチメニュー URL」が
 * D.O.T 自身のチャネルで閉じていることを **実 DB に対して** 検証する回帰テスト。
 *
 * 通常の CI / `vitest run` では **skip**（DB 不要）。実 DB 検証時のみ:
 *   DOT_LIFF_DB_TEST=1 vitest run src/__tests__/dot-liff-mapping-db.test.ts
 * ※ read-only（SELECT のみ）。本番 DB に対して実行しても書き込みは行わない。
 *
 * 守っている不変条件（本番障害の再発防止）:
 *   1. D.O.T work → D.O.T OA
 *   2. D.O.T OA   → D.O.T 専用 liffId（テスト用チャネルの LIFF ではない）
 *   3. D.O.T の生成 LIFF URL / リッチメニュー URI に **テスト用 LIFF ID が現れない**
 *   4. 「謎解きbot β版」OA は削除も改変もしない（存在確認のみ）
 *
 * LINE Developers Console 側の設定（チャネル名 / 友だち追加オプション）は
 * ここでは固定値化しない（Console は DB 外の状態のため）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getLiffIdForUrlGeneration } from "@/lib/liff/config";
import { buildLiffPageDeviceUrl } from "@/lib/liff/public-urls";

const RUN = process.env.DOT_LIFF_DB_TEST === "1";

/** D.O.T 公式アカウントの Basic ID（LINE Developers「Basic information」の値）。 */
const DOT_LINE_OA_ID = "739uljhc";
/** D.O.T 専用 LIFF ID（LINE Login チャネル 2010632002 = "Whale Studio - D.O.T"）。 */
const DOT_LIFF_ID = "2010632002-ZzzimCzc";
/** テスト用 LINE Login チャネル "whale-studio-test" (2010049684) の LIFF。D.O.T では絶対に使わない。 */
const TEST_CHANNEL_LIFF_ID = "2010049684-aJNy8Ljv";
const TEST_CHANNEL_ID = "2010049684";

const prisma = new PrismaClient();

describe.skipIf(!RUN)("D.O.T LIFF mapping (live DB, read-only)", () => {
  let oa: {
    id: string; title: string; lineOaId: string | null; liffId: string | null;
    works: { id: string; title: string; publicId: string | null }[];
  };

  beforeAll(async () => {
    const found = await prisma.oa.findUnique({
      where:  { lineOaId: DOT_LINE_OA_ID },
      select: {
        id: true, title: true, lineOaId: true, liffId: true,
        works: { select: { id: true, title: true, publicId: true } },
      },
    });
    if (!found) throw new Error(`D.O.T OA (lineOaId=${DOT_LINE_OA_ID}) が見つかりません`);
    oa = found;
  });

  afterAll(async () => { await prisma.$disconnect(); });

  it("D.O.T OA → D.O.T 専用 liffId（テスト用チャネルの LIFF ではない）", () => {
    expect(oa.liffId).toBe(DOT_LIFF_ID);
    expect(oa.liffId).not.toBe(TEST_CHANNEL_LIFF_ID);
    expect(oa.liffId ?? "").not.toContain(TEST_CHANNEL_ID);
  });

  it("D.O.T OA の liffId は env fallback ではなく DB に実体がある", () => {
    // URL 生成専用リゾルバ（env fallback なし）が値を返すこと。
    expect(getLiffIdForUrlGeneration(oa)).toBe(DOT_LIFF_ID);
  });

  it("D.O.T work → D.O.T OA（作品が別 OA に紐づいていない）", async () => {
    expect(oa.works.length).toBeGreaterThan(0);
    for (const w of oa.works) {
      const back = await prisma.work.findUnique({ where: { id: w.id }, select: { oaId: true } });
      expect(back?.oaId).toBe(oa.id);
    }
  });

  it("D.O.T work の LIFF ページから生成する実機 URL は D.O.T の liffId を使う", async () => {
    const pages = await prisma.liffPageConfig.findMany({
      where:  { work: { oaId: oa.id } },
      select: { id: true, publicId: true, workId: true, work: { select: { publicId: true } } },
    });
    expect(pages.length).toBeGreaterThan(0);

    for (const pg of pages) {
      const url = buildLiffPageDeviceUrl({
        liffId:       getLiffIdForUrlGeneration(oa),
        workId:       pg.workId,
        workPublicId: pg.work.publicId,
        pageId:       pg.id,
        pagePublicId: pg.publicId,
      });
      expect(url).toContain(`https://liff.line.me/${DOT_LIFF_ID}/`);
      expect(url).not.toContain(TEST_CHANNEL_ID);
    }
  });

  it("D.O.T のリッチメニュー URI にテスト用 LIFF ID が保存されていない", async () => {
    const areas = await prisma.richMenuArea.findMany({
      where:  { richMenu: { oaId: oa.id }, actionUri: { not: null } },
      select: { actionUri: true, richMenu: { select: { name: true } } },
    });

    for (const a of areas) {
      const uri = a.actionUri ?? "";
      expect(uri, `richMenu="${a.richMenu.name}" uri=${uri}`).not.toContain(TEST_CHANNEL_ID);
      // liff.line.me を指す URI は D.O.T の liffId でなければならない。
      if (uri.startsWith("https://liff.line.me/")) {
        expect(
          uri.startsWith(`https://liff.line.me/${DOT_LIFF_ID}`),
          `richMenu="${a.richMenu.name}" uri=${uri} は D.O.T の liffId で始まっていない`,
        ).toBe(true);
      }
    }
  });

  it("テスト用 OA「謎解きbot β版」は削除せず残っている（改変しない）", async () => {
    const beta = await prisma.oa.findFirst({
      where:  { title: { contains: "謎解きbot" } },
      select: { id: true, title: true, liffId: true },
    });
    expect(beta).not.toBeNull();
  });
});
