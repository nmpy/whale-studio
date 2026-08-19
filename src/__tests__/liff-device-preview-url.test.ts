/**
 * src/__tests__/liff-device-preview-url.test.ts
 *
 * 管理画面「実機で確認する」/ リッチメニューへ貼る **実機 LIFF URL** のビルダーを検証する。
 *
 * 背景（本番障害・D.O.T）:
 *   このパネルの実機 LIFF URL は `process.env.NEXT_PUBLIC_LIFF_ID`（全 OA 共通・テスト用
 *   LINE Login チャネル `2010049684-aJNy8Ljv` = "whale-studio-test"）で生成されていた。
 *   運用者がその URL を D.O.T のリッチメニューへ貼った結果、プレイヤーの初回起動時に
 *   テストチャネルの同意画面（= リンク先の「謎解きbot β版」友だち追加）が出ていた。
 *
 * したがってビルダーは:
 *   - 渡された liffId（= 対象 OA の Oa.liffId）だけを使う
 *   - env へフォールバックしない（未設定なら空文字を返し、UI が「未設定」を出す）
 */
import { describe, it, expect, afterEach } from "vitest";
import { buildLiffPageDeviceUrl, buildLiffPageSubPath } from "@/lib/liff/public-urls";

/** 本番で誤用されていたテスト用 LIFF ID。これが URL に出たら回帰。 */
const TEST_CHANNEL_LIFF_ID = "2010049684-aJNy8Ljv";
/** D.O.T 専用 LIFF ID（LINE Login チャネル 2010632002 "Whale Studio - D.O.T"）。 */
const DOT_LIFF_ID = "2010632002-ZzzimCzc";

const savedEnv = process.env.NEXT_PUBLIC_LIFF_ID;
afterEach(() => {
  if (savedEnv === undefined) delete process.env.NEXT_PUBLIC_LIFF_ID;
  else process.env.NEXT_PUBLIC_LIFF_ID = savedEnv;
});

describe("buildLiffPageSubPath", () => {
  it("publicId が揃えば短縮 sub-path（/liff は含めない）", () => {
    expect(buildLiffPageSubPath({ workId: "w-uuid", workPublicId: "q6v7188co7", pagePublicId: "k4sn8iz3i3" }))
      .toBe("/w/q6v7188co7/p/k4sn8iz3i3");
  });

  it("workPublicId のみなら作品ホーム sub-path", () => {
    expect(buildLiffPageSubPath({ workId: "w-uuid", workPublicId: "q6v7188co7" })).toBe("/w/q6v7188co7");
  });

  it("publicId が無ければ UUID ルートへフォールバック", () => {
    expect(buildLiffPageSubPath({ workId: "w-uuid", pageId: "p-uuid" })).toBe("/work/w-uuid/pages/p-uuid");
    expect(buildLiffPageSubPath({ workId: "w-uuid" })).toBe("/work/w-uuid");
  });
});

describe("buildLiffPageDeviceUrl", () => {
  it("渡された OA の liffId で実機 LIFF URL を組み立てる", () => {
    expect(buildLiffPageDeviceUrl({
      liffId: DOT_LIFF_ID, workId: "0b1a0869-c546-4f1c-ba9b-32f8f25e5c15",
      workPublicId: "q6v7188co7", pagePublicId: "k4sn8iz3i3",
    })).toBe(`https://liff.line.me/${DOT_LIFF_ID}/w/q6v7188co7/p/k4sn8iz3i3`);
  });

  it("NEXT_PUBLIC_LIFF_ID へフォールバックしない（liffId 未設定なら空文字）", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = TEST_CHANNEL_LIFF_ID;

    for (const liffId of [null, undefined, "", "   "]) {
      const url = buildLiffPageDeviceUrl({ liffId, workId: "w-uuid", workPublicId: "q6v7188co7", pagePublicId: "k4sn8iz3i3" });
      expect(url).toBe("");
      expect(url).not.toContain(TEST_CHANNEL_LIFF_ID);
    }
  });

  it("env にテスト用 LIFF ID があっても、OA の liffId が優先され env の値は混入しない", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = TEST_CHANNEL_LIFF_ID;

    const url = buildLiffPageDeviceUrl({
      liffId: DOT_LIFF_ID, workId: "w-uuid", workPublicId: "q6v7188co7", pagePublicId: "k4sn8iz3i3",
    });
    expect(url).toContain(DOT_LIFF_ID);
    expect(url).not.toContain(TEST_CHANNEL_LIFF_ID);
    // "2010049684"（チャネル ID 単体）も混入していないこと。
    expect(url).not.toContain("2010049684");
  });

  it("workId が空なら URL を作らない", () => {
    expect(buildLiffPageDeviceUrl({ liffId: DOT_LIFF_ID, workId: "" })).toBe("");
  });
});

/**
 * 恒久ルール（Whale Studio 全体）:
 *   Work → その Work に紐づく OA → Oa.liffId → 生成 URL
 * の経路のみを使い、OA をまたいで LIFF ID が混線しないこと。
 * 新しい LIFF URL 生成機能を追加するときも、この 2 本を必ず満たすこと。
 */
describe("作品別 LIFF URL の非混線（恒久ルール）", () => {
  const WORK_A = { liffId: "2010632002-ZzzimCzc", workId: "w-a", workPublicId: "q6v7188co7", pagePublicId: "k4sn8iz3i3" };
  const WORK_B = { liffId: "2010342756-WWXmBJ7w", workId: "w-b", workPublicId: "j6bk7g05zl", pagePublicId: "pua9ns1cn3" };

  it("Work A → OA A の liffId / Work B → OA B の liffId が入れ替わらない", () => {
    const a = buildLiffPageDeviceUrl(WORK_A);
    const b = buildLiffPageDeviceUrl(WORK_B);

    expect(a).toBe(`https://liff.line.me/${WORK_A.liffId}/w/${WORK_A.workPublicId}/p/${WORK_A.pagePublicId}`);
    expect(b).toBe(`https://liff.line.me/${WORK_B.liffId}/w/${WORK_B.workPublicId}/p/${WORK_B.pagePublicId}`);

    // 相手側の liffId / publicId が混入しないこと。
    expect(a).not.toContain(WORK_B.liffId);
    expect(a).not.toContain(WORK_B.workPublicId);
    expect(b).not.toContain(WORK_A.liffId);
    expect(b).not.toContain(WORK_A.workPublicId);
  });

  it("env にテスト LIFF ID があっても、どちらの作品の URL にも混入しない", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = TEST_CHANNEL_LIFF_ID;

    for (const w of [WORK_A, WORK_B]) {
      const url = buildLiffPageDeviceUrl(w);
      expect(url).toContain(w.liffId);
      expect(url).not.toContain(TEST_CHANNEL_LIFF_ID);
      expect(url).not.toContain("2010049684");
    }
  });

  it("片方の OA が liffId 未設定でも、もう片方の liffId を借りない（空文字）", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = TEST_CHANNEL_LIFF_ID;

    const unconfigured = buildLiffPageDeviceUrl({ ...WORK_B, liffId: null });
    expect(unconfigured).toBe("");
    expect(unconfigured).not.toContain(WORK_A.liffId);
    expect(unconfigured).not.toContain(TEST_CHANNEL_LIFF_ID);
  });
});
