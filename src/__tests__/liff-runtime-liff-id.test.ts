/**
 * src/__tests__/liff-runtime-liff-id.test.ts
 *
 * LIFF Runtime の per-OA 初期化（クライアント側の解釈）の回帰テスト。
 *
 * 背景（本番障害）:
 *   作品ホーム / 個別ページが全 OA 共通の NEXT_PUBLIC_LIFF_ID で liff.init() していたため、
 *   対象 OA の Messaging チャネルと別プロバイダーのログインチャネルでトークンが発行され、
 *   得られた lineUserId がその OA で解決できず GET /v2/bot/profile/{userId} が 404 →
 *   友だち追加済みでも「友だち追加してください」になっていた。
 */
import { describe, it, expect } from "vitest";
import {
  resolveRuntimeLiffId,
  toUseLiffSdkArg,
  RUNTIME_LIFF_NOT_CONFIGURED_MESSAGE,
} from "@/lib/liff/runtime-liff-id";

// 例示値（実 DB 依存ではない）。BELLKISH 相当の OA 固有 LIFF ID。
const OA_LIFF_ID  = "2010632019-YRm96VSK";
// 全 OA 共通の env に焼き込まれていた値（レガシー）。
const ENV_LIFF_ID = "2010049684-aJNy8Ljv";

describe("resolveRuntimeLiffId — Oa.liffId 優先", () => {
  it("source='oa' なら その liffId で初期化してよい（env より Oa.liffId を優先した結果）", () => {
    const r = resolveRuntimeLiffId({ liffId: OA_LIFF_ID, liffIdSource: "oa" });
    expect(r).toEqual({
      kind: "ready",
      liffId: OA_LIFF_ID,
      source: "oa",
      isLegacyEnvFallback: false,
    });
  });

  it("source='oa' のとき env の値は結果に混入しない", () => {
    const r = resolveRuntimeLiffId({ liffId: OA_LIFF_ID, liffIdSource: "oa" });
    expect(r.kind).toBe("ready");
    if (r.kind === "ready") expect(r.liffId).not.toBe(ENV_LIFF_ID);
  });

  it("【レガシーフォールバック】Oa.liffId が NULL のときだけ source='env' で初期化を許可する", () => {
    const r = resolveRuntimeLiffId({ liffId: ENV_LIFF_ID, liffIdSource: "env" });
    expect(r).toEqual({
      kind: "ready",
      liffId: ENV_LIFF_ID,
      source: "env",
      isLegacyEnvFallback: true,
    });
  });

  it("source='none' は設定エラー（誤った ID で初期化しない）", () => {
    expect(resolveRuntimeLiffId({ liffId: null, liffIdSource: "none" }))
      .toEqual({ kind: "not_configured", reason: "missing" });
  });

  it("liffId が空文字 / 空白のみは設定エラー", () => {
    expect(resolveRuntimeLiffId({ liffId: "", liffIdSource: "oa" }).kind).toBe("not_configured");
    expect(resolveRuntimeLiffId({ liffId: "   ", liffIdSource: "oa" }).kind).toBe("not_configured");
  });

  it("liffId はあるが source が不明値なら初期化しない（fail closed）", () => {
    expect(resolveRuntimeLiffId({ liffId: OA_LIFF_ID, liffIdSource: "bogus" }))
      .toEqual({ kind: "not_configured", reason: "unknown_source" });
    expect(resolveRuntimeLiffId({ liffId: OA_LIFF_ID }).kind).toBe("not_configured");
  });

  it("null / undefined（config 取得失敗）は設定エラー", () => {
    expect(resolveRuntimeLiffId(null).kind).toBe("not_configured");
    expect(resolveRuntimeLiffId(undefined).kind).toBe("not_configured");
  });

  it("前後空白は trim して初期化に使う", () => {
    const r = resolveRuntimeLiffId({ liffId: `  ${OA_LIFF_ID}  `, liffIdSource: "oa" });
    expect(r.kind === "ready" && r.liffId).toBe(OA_LIFF_ID);
  });

  it("複数 OA で別々の liffId をそのまま返す（混線しない）", () => {
    const a = resolveRuntimeLiffId({ liffId: "1111111111-aaaa", liffIdSource: "oa" });
    const b = resolveRuntimeLiffId({ liffId: "2222222222-bbbb", liffIdSource: "oa" });
    expect(a.kind === "ready" && a.liffId).toBe("1111111111-aaaa");
    expect(b.kind === "ready" && b.liffId).toBe("2222222222-bbbb");
  });

  it("設定エラー文言に LIFF ID / 内部情報を含めない", () => {
    expect(RUNTIME_LIFF_NOT_CONFIGURED_MESSAGE).not.toContain(OA_LIFF_ID);
    expect(RUNTIME_LIFF_NOT_CONFIGURED_MESSAGE).not.toContain(ENV_LIFF_ID);
    expect(RUNTIME_LIFF_NOT_CONFIGURED_MESSAGE).not.toMatch(/liff/i);
  });
});

describe("toUseLiffSdkArg — 解決待ちでは liff.init() を呼ばせない", () => {
  it("未解決(null) は null を返す → useLiffSDK は init しない", () => {
    expect(toUseLiffSdkArg(null)).toBeNull();
  });

  it("設定エラーでも null を返す（env フォールバックへ落ちない）", () => {
    expect(toUseLiffSdkArg({ kind: "not_configured", reason: "missing" })).toBeNull();
    expect(toUseLiffSdkArg({ kind: "not_configured", reason: "unknown_source" })).toBeNull();
  });

  it("**undefined は決して返さない**（undefined は env フォールバック許可を意味するため）", () => {
    const cases = [
      null,
      { kind: "not_configured", reason: "missing" } as const,
      { kind: "ready", liffId: OA_LIFF_ID, source: "oa", isLegacyEnvFallback: false } as const,
    ];
    for (const c of cases) expect(toUseLiffSdkArg(c)).not.toBeUndefined();
  });

  it("解決済みならその liffId を返す", () => {
    expect(toUseLiffSdkArg({
      kind: "ready", liffId: OA_LIFF_ID, source: "oa", isLegacyEnvFallback: false,
    })).toBe(OA_LIFF_ID);
  });
});
