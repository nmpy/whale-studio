/**
 * src/__tests__/destination-response-canonical.test.ts
 *
 * destinations API のレスポンス（`toDestinationResponse`）が返す `resolved_url` が
 * canonical な LIFF URL になることを固定する。
 *
 * `resolved_url` は運用者がリッチメニューエディタで選んで**そのまま rich menu の URI として
 * 保存する値**の正本。ここが誤ると本番設定に焼き付くため、
 *   1. LIFF ID は Work → OA → Oa.liffId のみ（env / 共通 / test LIFF へ落ちない）
 *   2. path は用途別 canonical route（Work スコープなので作品ホーム `/w/{workPublicId}`）
 * の 2 層をどちらも検証する。
 */
import { describe, it, expect, afterEach } from "vitest";
import { toDestinationResponse } from "@/lib/destination-utils";

const TEST_CHANNEL_LIFF_ID = "2010049684-aJNy8Ljv";
const OA_LIFF = "2010632002-ZzzimCzc";

const savedEnv = process.env.NEXT_PUBLIC_LIFF_ID;
afterEach(() => {
  if (savedEnv === undefined) delete process.env.NEXT_PUBLIC_LIFF_ID;
  else process.env.NEXT_PUBLIC_LIFF_ID = savedEnv;
});

/** DB 行の最小形（toDestinationResponse の入力）。 */
function row(over: Partial<Parameters<typeof toDestinationResponse>[0]> = {}) {
  return {
    id: "dest-1",
    workId: "work-uuid",
    key: "start",
    name: "開始画面",
    description: null,
    destinationType: "liff",
    liffTargetType: "work_main",
    urlOrPath: null,
    queryParamsJson: {} as unknown,
    isEnabled: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

describe("toDestinationResponse — resolved_url が canonical", () => {
  it("liffId + workPublicId → /w/{workPublicId}", () => {
    const res = toDestinationResponse(row(), { liffId: OA_LIFF, workPublicId: "wp0001" });
    expect(res.resolved_url).toBe(`https://liff.line.me/${OA_LIFF}/w/wp0001`);
    expect(res.work_public_id).toBe("wp0001");
  });

  it("query_params は維持され、workId は query に入らない", () => {
    const res = toDestinationResponse(row({ queryParamsJson: { param1: "sns" } }), {
      liffId: OA_LIFF,
      workPublicId: "wp0001",
    });
    expect(res.resolved_url).toBe(`https://liff.line.me/${OA_LIFF}/w/wp0001?param1=sns`);
    expect(res.resolved_url).not.toContain("workId=");
  });

  it("workPublicId が無い旧データは legacy /work/{workId}", () => {
    const res = toDestinationResponse(row(), { liffId: OA_LIFF });
    expect(res.resolved_url).toBe(`https://liff.line.me/${OA_LIFF}/work/work-uuid`);
    expect(res.resolved_url).not.toContain("?workId=");
  });

  it("Oa.liffId 未設定なら resolved_url は null（env の test LIFF に落ちない）", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = TEST_CHANNEL_LIFF_ID;

    const res = toDestinationResponse(row(), { workPublicId: "wp0001" });
    expect(res.resolved_url).toBeNull();

    const res2 = toDestinationResponse(row(), { liffId: null, workPublicId: "wp0001" });
    expect(res2.resolved_url).toBeNull();
  });

  it("env に test LIFF があっても resolved_url へ混入しない", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = TEST_CHANNEL_LIFF_ID;

    const res = toDestinationResponse(row(), { liffId: OA_LIFF, workPublicId: "wp0001" });
    expect(res.resolved_url).toContain(OA_LIFF);
    expect(res.resolved_url).not.toContain("2010049684");
  });

  it("page 情報を持たないので /p/... を生成しない", () => {
    const res = toDestinationResponse(row(), { liffId: OA_LIFF, workPublicId: "wp0001" });
    expect(res.resolved_url).not.toContain("/p/");
  });

  it("bare LIFF URL にならない", () => {
    const res = toDestinationResponse(row(), { liffId: OA_LIFF, workPublicId: "wp0001" });
    expect(/^https:\/\/liff\.line\.me\/[^/?]+\/?$/.test(res.resolved_url ?? "")).toBe(false);
  });

  it("OA をまたいで混線しない（Work A / Work B）", () => {
    const a = toDestinationResponse(row({ workId: "work-a" }), { liffId: "2010632002-ZzzimCzc", workPublicId: "wpa" });
    const b = toDestinationResponse(row({ workId: "work-b" }), { liffId: "2010342756-WWXmBJ7w", workPublicId: "wpb" });

    expect(a.resolved_url).toBe("https://liff.line.me/2010632002-ZzzimCzc/w/wpa");
    expect(b.resolved_url).toBe("https://liff.line.me/2010342756-WWXmBJ7w/w/wpb");
    expect(a.resolved_url).not.toContain("wpb");
    expect(b.resolved_url).not.toContain("wpa");
  });

  it("liff 以外の型は liffId 不要で従来どおり", () => {
    const ext = toDestinationResponse(
      row({ destinationType: "external_url", liffTargetType: null, urlOrPath: "https://example.test/x" }),
    );
    expect(ext.resolved_url).toBe("https://example.test/x");
  });
});
