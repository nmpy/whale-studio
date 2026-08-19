/**
 * src/__tests__/destination-url-builder-liff.test.ts
 *
 * 遷移先URL（destination）の liff 型が **env の共通 LIFF ID に汚染されない**ことを固定する。
 *
 * 背景（本番障害）:
 *   `resolveDestinationUrl` は `opts.liffId ?? process.env.NEXT_PUBLIC_LIFF_ID` で
 *   liffId を決めていた。この関数の戻り値は destination の `resolved_url` になり、
 *   リッチメニューエディタで選ぶと**そのまま rich menu の URI として保存される**。
 *   env にはテスト用ログインチャネル `2010049684-aJNy8Ljv`（whale-studio-test /
 *   謎解きbot β版）の LIFF が入っていたため、対象 OA と無関係な LIFF URL が
 *   一見正常な見た目で本番設定に焼き付く経路になっていた。
 *   （D.O.T と Whale Studio 自社 OA のリッチメニューで実際に発生）
 *
 * 恒久ルール:
 *   作品固有 LIFF URL は Work → その Work の OA → Oa.liffId の経路のみ。
 *   運用者が本番設定へ転記する URL 生成では env / 共通 / テスト LIFF へ
 *   フォールバックしない。解決できないなら「生成不能」（null）にする。
 */
import { describe, it, expect, afterEach } from "vitest";
import { resolveDestinationUrl, resolveDestinationUrlFromApi } from "@/lib/destination-url-builder";

/** 本番 env に入っていたテスト用 LIFF ID。生成 URL に出たら回帰。 */
const TEST_CHANNEL_LIFF_ID = "2010049684-aJNy8Ljv";
const OA_A_LIFF = "2010632002-ZzzimCzc"; // D.O.T
const OA_B_LIFF = "2010342756-WWXmBJ7w"; // Whale Studio

const savedLiff = process.env.NEXT_PUBLIC_LIFF_ID;
const savedBase = process.env.NEXT_PUBLIC_BASE_URL;
afterEach(() => {
  if (savedLiff === undefined) delete process.env.NEXT_PUBLIC_LIFF_ID;
  else process.env.NEXT_PUBLIC_LIFF_ID = savedLiff;
  if (savedBase === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = savedBase;
});

const liffDest = (workId: string, workPublicId?: string | null) =>
  ({ destinationType: "liff", workId, workPublicId });
/** canonical: 作品ホーム */
const home = (liffId: string, wp: string) => `https://liff.line.me/${liffId}/w/${wp}`;

describe("Test 1 — env contamination 防止", () => {
  it("NEXT_PUBLIC_LIFF_ID がセットされていても、liffId 未指定なら URL を生成しない", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = TEST_CHANNEL_LIFF_ID;

    expect(resolveDestinationUrl(liffDest("w-1"))).toBeNull();
    expect(resolveDestinationUrl(liffDest("w-1"), {})).toBeNull();
  });

  it("liffId が null / 空 / 空白でも env へフォールバックしない", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = TEST_CHANNEL_LIFF_ID;

    for (const liffId of [null, undefined, "", "   "]) {
      const url = resolveDestinationUrl(liffDest("w-1"), { liffId });
      expect(url).toBeNull();
      expect(String(url)).not.toContain(TEST_CHANNEL_LIFF_ID);
      expect(String(url)).not.toContain("2010049684");
    }
  });

  it("env がセットされていても、渡した Oa.liffId が使われ env 値は混入しない", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = TEST_CHANNEL_LIFF_ID;

    const url = resolveDestinationUrl(liffDest("w-1"), { liffId: OA_A_LIFF });
    expect(url).toContain(OA_A_LIFF);
    expect(url).not.toContain(TEST_CHANNEL_LIFF_ID);
    expect(url).not.toContain("2010049684");
  });

  it("snake_case 版（API 形式）も同じく env へフォールバックしない", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = TEST_CHANNEL_LIFF_ID;

    const dest = { destination_type: "liff", work_id: "w-1" };
    expect(resolveDestinationUrlFromApi(dest)).toBeNull();

    const url = resolveDestinationUrlFromApi(dest, { liffId: OA_B_LIFF });
    expect(url).toContain(OA_B_LIFF);
    expect(url).not.toContain("2010049684");
  });
});

describe("Test 2 — OA をまたいだ混線防止", () => {
  it("Work A → Oa.liffId A / Work B → Oa.liffId B が入れ替わらない", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = TEST_CHANNEL_LIFF_ID;

    const a = resolveDestinationUrl(liffDest("work-a", "wpa111"), { liffId: OA_A_LIFF });
    const b = resolveDestinationUrl(liffDest("work-b", "wpb222"), { liffId: OA_B_LIFF });

    expect(a).toBe(home(OA_A_LIFF, "wpa111"));
    expect(b).toBe(home(OA_B_LIFF, "wpb222"));

    expect(a).not.toContain(OA_B_LIFF);
    expect(a).not.toContain("wpb222");
    expect(b).not.toContain(OA_A_LIFF);
    expect(b).not.toContain("wpa111");
  });

  it("片方の OA が liffId 未設定でも、もう片方の liffId を借りない", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = TEST_CHANNEL_LIFF_ID;

    const configured = resolveDestinationUrl(liffDest("work-a", "wpa111"), { liffId: OA_A_LIFF });
    const unconfigured = resolveDestinationUrl(liffDest("work-b", "wpb222"), { liffId: null });

    expect(configured).toContain(OA_A_LIFF);
    expect(unconfigured).toBeNull();
    expect(String(unconfigured)).not.toContain(OA_A_LIFF);
    expect(String(unconfigured)).not.toContain(TEST_CHANNEL_LIFF_ID);
  });
});

describe("Test 3 — 既存挙動の維持（liff 以外は変えない）", () => {
  it("query_params は canonical path の query として維持される（workId は入れない）", () => {
    const url = resolveDestinationUrl(
      { destinationType: "liff", workId: "w-1", workPublicId: "wp123", queryParamsJson: { param1: "sns" } },
      { liffId: OA_A_LIFF },
    );
    expect(url).toBe(`${home(OA_A_LIFF, "wp123")}?param1=sns`);
    expect(url).not.toContain("workId=");
  });

  it("internal_url は baseUrl（アプリ自身の origin）で解決する — liffId 不要", () => {
    process.env.NEXT_PUBLIC_BASE_URL = "https://app.example.test";
    const url = resolveDestinationUrl({ destinationType: "internal_url", workId: "w-1", urlOrPath: "/liff/w/abc" });
    expect(url).toBe("https://app.example.test/liff/w/abc");
  });

  it("external_url はそのまま使う — liffId 不要", () => {
    const url = resolveDestinationUrl({ destinationType: "external_url", workId: "w-1", urlOrPath: "https://example.test/x" });
    expect(url).toBe("https://example.test/x");
  });

  it("未知の destinationType は null", () => {
    expect(resolveDestinationUrl({ destinationType: "unknown", workId: "w-1" }, { liffId: OA_A_LIFF })).toBeNull();
  });
});


describe("Test 4 — canonical work URL", () => {
  it("workPublicId があれば /w/{workPublicId}（bare にも ?workId= にもしない）", () => {
    const url = resolveDestinationUrl(liffDest("w-uuid", "abc123"), { liffId: "xxx" });
    expect(url).toBe("https://liff.line.me/xxx/w/abc123");
  });

  it("query が無いときは ? を付けない", () => {
    const url = resolveDestinationUrl(
      { destinationType: "liff", workId: "w-uuid", workPublicId: "abc123", queryParamsJson: {} },
      { liffId: "xxx" },
    );
    expect(url).toBe("https://liff.line.me/xxx/w/abc123");
    expect(url).not.toContain("?");
  });
});

describe("Test 5 — publicId が無い旧データは legacy UUID route へ", () => {
  it("workPublicId が null / undefined なら /work/{workId}", () => {
    for (const wp of [null, undefined]) {
      const url = resolveDestinationUrl(liffDest("w-uuid", wp), { liffId: OA_A_LIFF });
      expect(url).toBe(`https://liff.line.me/${OA_A_LIFF}/work/w-uuid`);
      expect(url).not.toContain("?workId=");
      // bare LIFF URL ではない
      expect(url).not.toBe(`https://liff.line.me/${OA_A_LIFF}`);
    }
  });

  it("legacy route でも query は維持される", () => {
    const url = resolveDestinationUrl(
      { destinationType: "liff", workId: "w-uuid", queryParamsJson: { param1: "sns" } },
      { liffId: OA_A_LIFF },
    );
    expect(url).toBe(`https://liff.line.me/${OA_A_LIFF}/work/w-uuid?param1=sns`);
  });
});

describe("Test 6 — 禁止形式を生成しない", () => {
  const cases = [
    { label: "publicId あり", dest: liffDest("w-uuid", "abc123") },
    { label: "publicId なし", dest: liffDest("w-uuid") },
    { label: "query あり", dest: { destinationType: "liff", workId: "w-uuid", workPublicId: "abc123", queryParamsJson: { a: "1" } } },
  ];

  it("?workId= / ?work_id= を含まない", () => {
    for (const c of cases) {
      const url = resolveDestinationUrl(c.dest, { liffId: OA_A_LIFF }) ?? "";
      expect(url, c.label).not.toContain("?workId=");
      expect(url, c.label).not.toContain("?work_id=");
    }
  });

  it("bare LIFF URL（liffId 直下・path なし）にならない", () => {
    for (const c of cases) {
      const url = resolveDestinationUrl(c.dest, { liffId: OA_A_LIFF }) ?? "";
      expect(/^https:\/\/liff\.line\.me\/[^/?]+\/?$/.test(url), c.label).toBe(false);
    }
  });

  it("page 情報が無いので /p/... を捏造しない", () => {
    for (const c of cases) {
      const url = resolveDestinationUrl(c.dest, { liffId: OA_A_LIFF }) ?? "";
      expect(url, c.label).not.toContain("/p/");
    }
  });
});

describe("Test 7 — URL エンコード", () => {
  it("query 値の記号・日本語・空白がエンコードされる", () => {
    const url = resolveDestinationUrl(
      { destinationType: "liff", workId: "w", workPublicId: "wp",
        queryParamsJson: { q: "a b&c=d", jp: "謎解き" } },
      { liffId: "xxx" },
    );
    expect(url).toBe("https://liff.line.me/xxx/w/wp?q=a+b%26c%3Dd&jp=%E8%AC%8E%E8%A7%A3%E3%81%8D");
    // 復元できること（= 二重エンコードしていない）
    const parsed = new URL(url!);
    expect(parsed.searchParams.get("q")).toBe("a b&c=d");
    expect(parsed.searchParams.get("jp")).toBe("謎解き");
    expect(parsed.pathname).toBe("/xxx/w/wp");
  });

  it("値が空文字の query も落とさない（既存挙動の維持）", () => {
    const url = resolveDestinationUrl(
      { destinationType: "liff", workId: "w", workPublicId: "wp", queryParamsJson: { empty: "" } },
      { liffId: "xxx" },
    );
    expect(url).toBe("https://liff.line.me/xxx/w/wp?empty=");
  });
});

describe("Test 8 — snake_case（API 形式）でも canonical", () => {
  it("work_public_id を使って /w/{work_public_id} になる", () => {
    const url = resolveDestinationUrlFromApi(
      { destination_type: "liff", work_id: "w-uuid", work_public_id: "abc123", query_params_json: { param1: "sns" } },
      { liffId: OA_B_LIFF },
    );
    expect(url).toBe(`https://liff.line.me/${OA_B_LIFF}/w/abc123?param1=sns`);
    expect(url).not.toContain("?workId=");
  });

  it("work_public_id が無ければ legacy /work/{work_id}", () => {
    const url = resolveDestinationUrlFromApi(
      { destination_type: "liff", work_id: "w-uuid" },
      { liffId: OA_B_LIFF },
    );
    expect(url).toBe(`https://liff.line.me/${OA_B_LIFF}/work/w-uuid`);
  });
});
