// src/__tests__/owner-error-log.test.ts
// スタジオ全体エラーログ（Phase 2）の純粋ロジックのテスト。
// DB 依存（query/resolve-service/summary の集計本体・migration）は typecheck / 認可 / Preview が担保する。
import { describe, it, expect } from "vitest";
import {
  TYPE_BY_SOURCE, SOURCE_BY_TYPE, TYPE_LABEL,
  causeTitle, sanitizeDetail, playerOf, toErrorLogItem, type RawErrorLogRow,
} from "@/lib/owner-error-log/normalize";
import {
  normalizeStatus, normalizePeriod, normalizeType, normalizePage, parseFilters,
} from "@/lib/owner-error-log/filters";
import { periodStartUTC } from "@/lib/owner-error-log/period";
import { pickTopCause } from "@/lib/owner-error-log/summary";
import { buildErrorLogCsv, errorLogCsvFileName } from "@/lib/owner-error-log/csv";
import { isValidSource } from "@/lib/owner-error-log/resolve-service";
import type { OwnerErrorLogItem } from "@/lib/owner-error-log/types";

describe("normalize: source ↔ type の対応", () => {
  it("双方向で一致する", () => {
    for (const [source, type] of Object.entries(TYPE_BY_SOURCE)) {
      expect(SOURCE_BY_TYPE[type]).toBe(source);
    }
  });
});

describe("causeTitle: 既知の状態値からの原因名", () => {
  it("Beacon は再送/通常で出し分け", () => {
    expect(causeTitle("beacon_event", "failed", true)).toBe("Beacon 再送に失敗");
    expect(causeTitle("beacon_event", "failed", false)).toBe("Beacon アクションに失敗");
  });
  it("Checkin は既知コードを日本語化、未知はフォールバック", () => {
    expect(causeTitle("checkin_attempt", "out_of_range", false)).toBe("チェックイン範囲外");
    expect(causeTitle("checkin_attempt", "permission_denied", false)).toBe("位置情報の許可なし");
    expect(causeTitle("checkin_attempt", "some_new_code", false)).toBe("現地チェックインに失敗");
    expect(causeTitle("checkin_attempt", null, false)).toBe("現地チェックインに失敗");
  });
  it("メッセージは単一原因", () => {
    expect(causeTitle("scheduled_line_message", "failed", false)).toBe("メッセージ送信に失敗");
  });
});

describe("sanitizeDetail: 秘匿情報の除去・上限・null", () => {
  it("null / 空 / 空白は null", () => {
    expect(sanitizeDetail(null)).toBeNull();
    expect(sanitizeDetail(undefined)).toBeNull();
    expect(sanitizeDetail("   ")).toBeNull();
  });
  it("Bearer トークン / JWT を伏せる", () => {
    expect(sanitizeDetail("failed Bearer abc.def_123-XYZ")).not.toContain("abc.def");
    expect(sanitizeDetail("token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9zzzzzzzz")).toContain("(token)");
  });
  it("secret=... / access_token: ... を伏せる", () => {
    expect(sanitizeDetail("channel_secret=SUPERSECRETVALUE1234")).not.toContain("SUPERSECRETVALUE");
    expect(sanitizeDetail("access_token: aabbccddeeff")).not.toContain("aabbccddeeff");
  });
  it("URL / DB URL を伏せる", () => {
    expect(sanitizeDetail("see https://internal.example.com/x?token=1")).toContain("(url)");
    expect(sanitizeDetail("postgresql://u:p@h:5432/db down")).toContain("(db-url)");
  });
  it("生 LINE userId / 内部 UUID を伏せる", () => {
    expect(sanitizeDetail("user U0123456789abcdef0123456789abcdef failed")).not.toContain("U0123456789abcdef0123456789abcdef");
    expect(sanitizeDetail("oa 123e4567-e89b-42d3-a456-426614174000 err")).not.toContain("123e4567-e89b-42d3-a456-426614174000");
  });
  it("改行を 1 行化し 80 文字で切り詰め", () => {
    const long = "エラー: " + "あ".repeat(200);
    const out = sanitizeDetail(long)!;
    expect(out.length).toBeLessThanOrEqual(81); // 80 + "…"
    expect(out.endsWith("…")).toBe(true);
    expect(sanitizeDetail("line1\nline2\tline3")).toBe("line1 line2 line3");
  });
});

describe("playerOf: 匿名タグ / 生 userId 非露出", () => {
  it("lineUserId ありは匿名タグ、生 ID は含まない", () => {
    const raw = "U0123456789abcdef0123456789abcdef";
    const tag = playerOf(raw, "oa-1")!;
    expect(tag).toMatch(/^プレイヤー #[0-9A-Z]{6}$/);
    expect(tag).not.toContain(raw);
  });
  it("OA が違えば別タグ（名寄せ防止）", () => {
    const raw = "Uabcabcabcabcabcabcabcabcabcabc12";
    expect(playerOf(raw, "oa-1")).not.toBe(playerOf(raw, "oa-2"));
  });
  it("lineUserId 無しは null", () => {
    expect(playerOf(null, "oa-1")).toBeNull();
    expect(playerOf(undefined, "oa-1")).toBeNull();
  });
});

describe("toErrorLogItem: View Model 化", () => {
  const base: RawErrorLogRow = {
    source: "beacon_event", sourceId: "b1", occurredAt: new Date("2026-07-10T00:00:00Z"),
    oaId: "oa-1", lineUserId: "Uffffffffffffffffffffffffffffffff", causeCode: "failed",
    detail: "beacon error", isRedelivery: false, resolvedAt: null,
  };
  it("未解決: resolvedAt null → isResolved false", () => {
    const it = toErrorLogItem(base, "アカウントA");
    expect(it.isResolved).toBe(false);
    expect(it.resolvedAt).toBeNull();
    expect(it.type).toBe("beacon");
    expect(it.accountName).toBe("アカウントA");
    expect(it.title).toBe("Beacon アクションに失敗");
    expect(it.player).toMatch(/^プレイヤー #[0-9A-Z]{6}$/);
    expect(it.occurredAt).toBe("2026-07-10T00:00:00.000Z");
  });
  it("解決済み: resolvedAt あり → isResolved true", () => {
    const it = toErrorLogItem({ ...base, resolvedAt: new Date("2026-07-11T00:00:00Z") }, "A");
    expect(it.isResolved).toBe(true);
    expect(it.resolvedAt).toBe("2026-07-11T00:00:00.000Z");
  });
  it("内部 DB モデル（work/oa relation 等）を含まない View Model", () => {
    const it = toErrorLogItem(base, "A");
    expect(Object.keys(it).sort()).toEqual(
      ["accountName", "detail", "isResolved", "oaId", "occurredAt", "player", "resolvedAt", "source", "sourceId", "title", "type"]
    );
  });
});

describe("filters: 正規化（不正値は安全な既定）", () => {
  it("状態: 既定 unresolved・不正は unresolved", () => {
    expect(normalizeStatus(undefined)).toBe("unresolved");
    expect(normalizeStatus("weird")).toBe("unresolved");
    expect(normalizeStatus("resolved")).toBe("resolved");
    expect(normalizeStatus("all")).toBe("all");
  });
  it("期間: 既定 7d", () => {
    expect(normalizePeriod(undefined)).toBe("7d");
    expect(normalizePeriod("x")).toBe("7d");
    expect(normalizePeriod("month")).toBe("month");
    expect(normalizePeriod("all")).toBe("all");
  });
  it("種別: 既定 all", () => {
    expect(normalizeType(undefined)).toBe("all");
    expect(normalizeType("beacon")).toBe("beacon");
    expect(normalizeType("nope")).toBe("all");
  });
  it("ページ: 不正は 1・小数は切り捨て", () => {
    expect(normalizePage(undefined)).toBe(1);
    expect(normalizePage("0")).toBe(1);
    expect(normalizePage("-3")).toBe(1);
    expect(normalizePage("abc")).toBe(1);
    expect(normalizePage("3")).toBe(3);
    expect(normalizePage("2.9")).toBe(2);
  });
  it("parseFilters: oa は実在のみ採用", () => {
    const valid = new Set(["oa-1", "oa-2"]);
    expect(parseFilters({ oa: "oa-1" }, valid).oaId).toBe("oa-1");
    expect(parseFilters({ oa: "oa-x" }, valid).oaId).toBeNull();
    expect(parseFilters({}, valid).oaId).toBeNull();
    const f = parseFilters({ status: "all", type: "message", period: "30d", page: "2", oa: "oa-2" }, valid);
    expect(f).toEqual({ status: "all", oaId: "oa-2", type: "message", period: "30d", page: 2 });
  });
});

describe("period: JST 日境界", () => {
  const now = new Date("2026-07-17T02:00:00Z"); // JST 11:00
  it("all は下限なし（null）", () => {
    expect(periodStartUTC("all", now)).toBeNull();
  });
  it("7d < 30d の開始で、いずれも now 以前", () => {
    const s7 = periodStartUTC("7d", now)!;
    const s30 = periodStartUTC("30d", now)!;
    const sm = periodStartUTC("month", now)!;
    expect(s30.getTime()).toBeLessThan(s7.getTime());
    expect(s7.getTime()).toBeLessThan(now.getTime());
    expect(sm.getTime()).toBeLessThanOrEqual(s7.getTime());
    // 7d の開始は JST 前日以前の 00:00 相当（= UTC 15:00）
    expect(new Date(s7.getTime() + 9 * 3600e3).getUTCHours()).toBe(0);
  });
});

describe("summary: 最多の原因（同数は安定優先・0 は —）", () => {
  it("最大の種別を返す", () => {
    expect(pickTopCause(5, 2, 1)).toBe("Beacon");
    expect(pickTopCause(1, 9, 3)).toBe("現地チェックイン");
    expect(pickTopCause(0, 0, 4)).toBe("メッセージ");
  });
  it("同数は Beacon > 現地 > メッセージ", () => {
    expect(pickTopCause(3, 3, 3)).toBe("Beacon");
    expect(pickTopCause(0, 2, 2)).toBe("現地チェックイン");
  });
  it("全 0 は —", () => {
    expect(pickTopCause(0, 0, 0)).toBe("—");
  });
});

describe("CSV: BOM / エスケープ / インジェクション対策 / 秘匿情報非露出", () => {
  const mk = (over: Partial<OwnerErrorLogItem> = {}): OwnerErrorLogItem => ({
    source: "beacon_event", sourceId: "b1", occurredAt: "2026-07-10T00:00:00.000Z",
    oaId: "oa-1", accountName: "アカウントA", type: "beacon", title: "Beacon アクションに失敗",
    detail: null, player: "プレイヤー #A1B2C3", isResolved: false, resolvedAt: null, ...over,
  });
  it("UTF-8 BOM + CRLF + ヘッダ", () => {
    const csv = buildErrorLogCsv([mk()], new Map());
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain("日時,アカウント,種別,内容,プレイヤー,詳細,状態,解決日時,解決者");
  });
  it("数式インジェクションを無効化（先頭 = + - @）", () => {
    const csv = buildErrorLogCsv([mk({ title: "=SUM(A1:A2)" })], new Map());
    expect(csv).toContain("'=SUM(A1:A2)");
    expect(csv).not.toMatch(/,=SUM/);
  });
  it("カンマ/改行/引用符を含む値は quote エスケープ", () => {
    const csv = buildErrorLogCsv([mk({ accountName: 'A,B "x"' })], new Map());
    expect(csv).toContain('"A,B ""x"""');
  });
  it("解決者は解決済みのみ・resolvedByName から解決（生 userId は渡さない）", () => {
    const resolved = mk({ isResolved: true, resolvedAt: "2026-07-11T00:00:00.000Z" });
    const csv = buildErrorLogCsv([resolved], new Map([["beacon_event:b1", "運営 太郎"]]));
    expect(csv).toContain("運営 太郎");
    const unresolvedCsv = buildErrorLogCsv([mk()], new Map());
    const lastCol = unresolvedCsv.trim().split("\r\n")[1].split(",").pop();
    expect(lastCol).toBe(""); // 未解決は解決者空
  });
  it("生 LINE userId が detail に混ざっても正規化で除去済み", () => {
    const raw: RawErrorLogRow = {
      source: "scheduled_line_message", sourceId: "s1", occurredAt: new Date("2026-07-10T00:00:00Z"),
      oaId: "oa-1", lineUserId: null, causeCode: "failed",
      detail: "push failed for U0123456789abcdef0123456789abcdef", isRedelivery: false, resolvedAt: null,
    };
    const item = toErrorLogItem(raw, "A");
    const csv = buildErrorLogCsv([item], new Map());
    expect(csv).not.toContain("U0123456789abcdef0123456789abcdef");
  });
  it("ファイル名は JST 実行日", () => {
    expect(errorLogCsvFileName(new Date("2026-07-17T02:00:00Z"))).toBe("whale-studio-error-log-2026-07-17.csv");
  });
});

describe("resolve-service: source allowlist", () => {
  it("既知 3 種のみ有効", () => {
    expect(isValidSource("beacon_event")).toBe(true);
    expect(isValidSource("checkin_attempt")).toBe(true);
    expect(isValidSource("scheduled_line_message")).toBe(true);
    expect(isValidSource("user_progress")).toBe(false);
    expect(isValidSource("")).toBe(false);
    expect(isValidSource(null)).toBe(false);
    expect(isValidSource(123)).toBe(false);
  });
});
