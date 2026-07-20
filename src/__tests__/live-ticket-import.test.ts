// src/__tests__/live-ticket-import.test.ts
// ESCAPE.ID 取込の純ロジック（列マッピング/種別正規化/日時/team名/行検証/結果CSV）のテスト。
import { describe, it, expect } from "vitest";
import {
  mapEscapeIdHeaders, resolveTicketGroupType, parseShowDateTime, buildTicketTeamName,
  extractTicketRow, normalizeTicketRow, buildTicketResultCsv, TICKET_CSV_HEADERS,
  type TicketResultRow,
} from "@/lib/live-ticket-import";

const ESCAPE_HEADERS = ["公演日", "公演時間", "購入日時", "チケット種別", "ユーザー名", "メールアドレス", "システム側チケットID"];

describe("mapEscapeIdHeaders", () => {
  it("ESCAPE.ID の 7 列を自動検出する", () => {
    const m = mapEscapeIdHeaders(ESCAPE_HEADERS);
    expect(m.show_date).toBe("公演日");
    expect(m.show_time).toBe("公演時間");
    expect(m.purchased_at).toBe("購入日時");
    expect(m.ticket_type).toBe("チケット種別");
    expect(m.user_name).toBe("ユーザー名");
    expect(m.email).toBe("メールアドレス");
    expect(m.ticket_id).toBe("システム側チケットID");
  });
  it("表記揺れ（券種 / お名前 / Email / チケットID）も検出", () => {
    const m = mapEscapeIdHeaders(["開催日", "開始時刻", "券種", "お名前", "Email", "チケットID"]);
    expect(m.show_date).toBe("開催日");
    expect(m.show_time).toBe("開始時刻");
    expect(m.ticket_type).toBe("券種");
    expect(m.user_name).toBe("お名前");
    expect(m.email).toBe("Email");
    expect(m.ticket_id).toBe("チケットID");
  });
  it("override（ヘッダー→field）が最優先", () => {
    const m = mapEscapeIdHeaders(["col_a", "col_b"], { col_a: "ticket_id", col_b: "email" });
    expect(m.ticket_id).toBe("col_a");
    expect(m.email).toBe("col_b");
  });
});

describe("resolveTicketGroupType", () => {
  it("完全一致・数字抽出・不明", () => {
    expect(resolveTicketGroupType("2名")).toBe("two");
    expect(resolveTicketGroupType("2名券")).toBe("two");   // 数字抽出
    expect(resolveTicketGroupType("4名様")).toBe("four");
    expect(resolveTicketGroupType("four")).toBe("four");
    expect(resolveTicketGroupType("4")).toBe("four");
    expect(resolveTicketGroupType("ペア")).toBeNull();
    expect(resolveTicketGroupType("1名")).toBeNull();
    expect(resolveTicketGroupType("3名")).toBeNull();
    expect(resolveTicketGroupType("")).toBeNull();
    expect(resolveTicketGroupType(null)).toBeNull();
  });
});

describe("parseShowDateTime / buildTicketTeamName", () => {
  it("YYYY/MM/DD + HH:MM を JST Date に", () => {
    const d = parseShowDateTime("2026/08/17", "14:00");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe(new Date("2026-08-17T14:00:00+09:00").toISOString());
  });
  it("不正日付は null", () => {
    expect(parseShowDateTime("不明", "14:00")).toBeNull();
    expect(parseShowDateTime("", "14:00")).toBeNull();
  });
  it("team名は日時+Ticket（個人名なし）", () => {
    expect(buildTicketTeamName("2026/08/17", "14:00", "1234")).toBe("2026-08-17 14:00 Ticket 1234");
    expect(buildTicketTeamName("", "", "9999")).toBe("Ticket 9999");
  });
});

describe("extractTicketRow / normalizeTicketRow", () => {
  const mapping = mapEscapeIdHeaders(ESCAPE_HEADERS);
  const row = {
    "公演日": "2026/08/17", "公演時間": "14:00", "購入日時": "2026/08/01 10:00",
    "チケット種別": "2名券", "ユーザー名": "山田太郎", "メールアドレス": "a@example.com", "システム側チケットID": "TCK-0001",
  };
  it("有効行: ticketId/reservationNumber/groupType/teamName/reservedAt を正規化", () => {
    const s = normalizeTicketRow(extractTicketRow(row, mapping), 2);
    expect(s.valid).toBe(true);
    expect(s.ticketId).toBe("TCK-0001");
    expect(s.reservationNumber).toBe("TCK-0001");   // = ticketId
    expect(s.groupType).toBe("two");
    expect(s.purchaserName).toBe("山田太郎");
    expect(s.teamName).toBe("2026-08-17 14:00 Ticket TCK-0001");
    expect(s.reservedAt).not.toBeNull();
    expect(s.errors).toHaveLength(0);
  });
  it("ticketId 空は error（valid=false）", () => {
    const s = normalizeTicketRow(extractTicketRow({ ...row, "システム側チケットID": "" }, mapping), 3);
    expect(s.valid).toBe(false);
    expect(s.errors.join()).toContain("チケットIDが空");
  });
  it("メール形式不正は warning（valid は維持）", () => {
    const s = normalizeTicketRow(extractTicketRow({ ...row, "メールアドレス": "not-an-email" }, mapping), 4);
    expect(s.valid).toBe(true);
    expect(s.warnings.join()).toContain("メールアドレス");
  });
  it("不明種別は groupType=null + warning", () => {
    const s = normalizeTicketRow(extractTicketRow({ ...row, "チケット種別": "特別席" }, mapping), 5);
    expect(s.groupType).toBeNull();
    expect(s.warnings.join()).toContain("判定できません");
  });
});

describe("buildTicketResultCsv", () => {
  const rows: TicketResultRow[] = [
    { showDate: "2026/08/17", showTime: "14:00", purchasedAt: "2026/08/01", ticketType: "2名券", userName: "山田太郎", email: "a@example.com", ticketId: "TCK-1", url: "https://liff.line.me/x/ticket?t=abc", expiresAt: "2026-08-20T00:00:00.000Z", result: "issued", error: "" },
    { showDate: "", showTime: "", purchasedAt: "", ticketType: "", userName: "=cmd()", email: "", ticketId: "TCK-2", url: null, expiresAt: null, result: "failed", error: "Sessionがありません" },
  ];
  it("UTF-8 BOM 付き・ヘッダー・失敗行も含む・CSV injection をエスケープ", () => {
    const csv = buildTicketResultCsv(rows);
    expect(csv.charCodeAt(0)).toBe(0xfeff);                 // BOM
    expect(csv).toContain(TICKET_CSV_HEADERS.join(","));    // ヘッダー
    expect(csv).toContain("https://liff.line.me/x/ticket?t=abc"); // 発行行の URL
    expect(csv).toContain("失敗");                          // 失敗行も含む
    expect(csv).toContain("'=cmd()");                       // 数式インジェクション無効化（先頭 ' 付与）
    expect(csv).toContain("\r\n");                          // CRLF
  });
});
