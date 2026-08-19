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

const liffDest = (workId: string) => ({ destinationType: "liff", workId });

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

    const a = resolveDestinationUrl(liffDest("work-a"), { liffId: OA_A_LIFF });
    const b = resolveDestinationUrl(liffDest("work-b"), { liffId: OA_B_LIFF });

    expect(a).toBe(`https://liff.line.me/${OA_A_LIFF}?workId=work-a`);
    expect(b).toBe(`https://liff.line.me/${OA_B_LIFF}?workId=work-b`);

    expect(a).not.toContain(OA_B_LIFF);
    expect(a).not.toContain("work-b");
    expect(b).not.toContain(OA_A_LIFF);
    expect(b).not.toContain("work-a");
  });

  it("片方の OA が liffId 未設定でも、もう片方の liffId を借りない", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = TEST_CHANNEL_LIFF_ID;

    const configured = resolveDestinationUrl(liffDest("work-a"), { liffId: OA_A_LIFF });
    const unconfigured = resolveDestinationUrl(liffDest("work-b"), { liffId: null });

    expect(configured).toContain(OA_A_LIFF);
    expect(unconfigured).toBeNull();
    expect(String(unconfigured)).not.toContain(OA_A_LIFF);
    expect(String(unconfigured)).not.toContain(TEST_CHANNEL_LIFF_ID);
  });
});

describe("Test 3 — 既存挙動の維持（liff 以外は変えない）", () => {
  it("query_params は従来どおり付与される", () => {
    const url = resolveDestinationUrl(
      { destinationType: "liff", workId: "w-1", queryParamsJson: { foo: "bar" } },
      { liffId: OA_A_LIFF },
    );
    expect(url).toBe(`https://liff.line.me/${OA_A_LIFF}?workId=w-1&foo=bar`);
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
