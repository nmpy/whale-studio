// src/__tests__/liff-qr.test.ts
//
// slice 4: QR スキャナの純関数（qr.ts）とイベント種別（liff-events.ts）のテスト。
// UI 状態遷移は QrScanner のレンダリングテストで別途検証する。

import { describe, it, expect } from "vitest";
import { qrScanGuidance, truncateQrValue, isScanCancelError, interpretQrComplete } from "@/lib/liff/qr";
import { isValidLiffEventType, LIFF_EVENT_TYPES } from "@/lib/liff-events";

describe("qrScanGuidance", () => {
  it("全条件 OK なら canScan=true・notice なし", () => {
    const g = qrScanGuidance({ scanQrEnabled: true, isInClient: true, scanCodeV2Available: true });
    expect(g.canScan).toBe(true);
    expect(g.notice).toBeUndefined();
  });

  it("scanQrEnabled=false → QR 未有効の案内（最優先）", () => {
    const g = qrScanGuidance({ scanQrEnabled: false, isInClient: true, scanCodeV2Available: true });
    expect(g.canScan).toBe(false);
    expect(g.notice?.title).toContain("利用できません");
  });

  it("scanQrEnabled=false は他条件より優先される", () => {
    // 外ブラウザ かつ scanCodeV2 非対応 でも、まず scanQrEnabled の案内を返す。
    const g = qrScanGuidance({ scanQrEnabled: false, isInClient: false, scanCodeV2Available: false });
    expect(g.notice?.title).toBe("QR読み取りは利用できません");
  });

  it("LIFF 外ブラウザ → LINE アプリで開く案内", () => {
    const g = qrScanGuidance({ scanQrEnabled: true, isInClient: false, scanCodeV2Available: true });
    expect(g.canScan).toBe(false);
    expect(g.notice?.title).toContain("LINE アプリ");
  });

  it("scanCodeV2 非対応 → その旨の案内", () => {
    const g = qrScanGuidance({ scanQrEnabled: true, isInClient: true, scanCodeV2Available: false });
    expect(g.canScan).toBe(false);
    expect(g.notice?.title).toContain("QR 読み取りを利用できません");
  });
});

describe("truncateQrValue", () => {
  it("null / undefined / 空文字 / 空白のみ → null", () => {
    expect(truncateQrValue(null)).toBeNull();
    expect(truncateQrValue(undefined)).toBeNull();
    expect(truncateQrValue("")).toBeNull();
    expect(truncateQrValue("   ")).toBeNull();
  });

  it("前後空白を除去する", () => {
    expect(truncateQrValue("  hello  ")).toBe("hello");
  });

  it("max 以内ならそのまま", () => {
    expect(truncateQrValue("abc", 10)).toBe("abc");
  });

  it("max を超えると切り詰めて … を付与", () => {
    const out = truncateQrValue("abcdefghij", 5);
    expect(out).toBe("abcde…");
  });

  it("default max は 200", () => {
    const long = "x".repeat(250);
    const out = truncateQrValue(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(201); // 200 文字 + …
    expect(out!.endsWith("…")).toBe(true);
  });
});

describe("isScanCancelError", () => {
  it("cancel / abort / user cancelled / closed を含むメッセージは true", () => {
    expect(isScanCancelError(new Error("User cancelled the scan"))).toBe(true);
    expect(isScanCancelError(new Error("scan aborted"))).toBe(true);
    expect(isScanCancelError(new Error("window closed"))).toBe(true);
    expect(isScanCancelError("operation cancelled")).toBe(true);
  });

  it("無関係なエラーは false", () => {
    expect(isScanCancelError(new Error("network error"))).toBe(false);
    expect(isScanCancelError(undefined)).toBe(false);
    expect(isScanCancelError({})).toBe(false);
  });
});

describe("LIFF_EVENT_TYPES (slice 4 追加分)", () => {
  const newTypes = [
    "liff_init_success", "liff_init_failed",
    "session_success", "session_failed",
    "gps_checkin_success", "gps_checkin_failed",
    "qr_scan_success", "qr_scan_failed", "qr_scan_cancelled",
  ];

  it("新イベント種別がすべて有効と判定される", () => {
    for (const t of newTypes) {
      expect(isValidLiffEventType(t)).toBe(true);
      expect(LIFF_EVENT_TYPES).toContain(t);
    }
  });

  it("未知の種別は無効", () => {
    expect(isValidLiffEventType("unknown_event")).toBe(false);
    expect(isValidLiffEventType(123)).toBe(false);
    expect(isValidLiffEventType(null)).toBe(false);
  });

  it("既存イベント種別は維持されている（後方互換）", () => {
    for (const t of ["page_view", "checkin_success", "checkin_failed", "button_click"]) {
      expect(isValidLiffEventType(t)).toBe(true);
    }
  });

  it("QR 成功メッセージ送信イベントが有効", () => {
    for (const t of ["qr_message_send_started", "qr_message_send_success", "qr_message_send_failed", "qr_message_send_skipped", "qr_message_duplicate"]) {
      expect(isValidLiffEventType(t)).toBe(true);
    }
  });
});

describe("interpretQrComplete (PR 2/2)", () => {
  it("2xx + data.sent=true → sent", () => {
    const r = interpretQrComplete(200, { success: true, data: { ok: true, sent: true, message: "送信しました" } });
    expect(r.outcome).toBe("sent");
    expect(r.message).toBe("送信しました");
  });

  it("2xx + alreadyProcessed=true → already_processed", () => {
    const r = interpretQrComplete(200, { success: true, data: { ok: true, sent: false, alreadyProcessed: true } });
    expect(r.outcome).toBe("already_processed");
  });

  it("2xx + code=message_not_configured → message_not_configured", () => {
    const r = interpretQrComplete(200, { success: true, data: { ok: true, sent: false, code: "message_not_configured" } });
    expect(r.outcome).toBe("message_not_configured");
  });

  it("2xx + code=qr_not_matched / data.ok=false → unmatched", () => {
    expect(interpretQrComplete(200, { success: true, data: { ok: false, sent: false, code: "qr_not_matched" } }).outcome).toBe("unmatched");
    expect(interpretQrComplete(200, { success: true, data: { ok: false } }).outcome).toBe("unmatched");
  });

  it("2xx + service_suspended → failed（文言はサーバー優先）", () => {
    const r = interpretQrComplete(200, { success: true, data: { ok: true, sent: false, code: "service_suspended", message: "利用できません" } });
    expect(r.outcome).toBe("failed");
    expect(r.message).toBe("利用できません");
  });

  it("401 → failed（LINE連携エラー）", () => {
    const r = interpretQrComplete(401, { success: false, error: { code: "UNAUTHORIZED" } });
    expect(r.outcome).toBe("failed");
    expect(r.message).toContain("LINE連携");
  });

  it("403 FEATURE_DISABLED → failed（QR未有効の文言）", () => {
    const r = interpretQrComplete(403, { success: false, error: { code: "FEATURE_DISABLED" } });
    expect(r.outcome).toBe("failed");
    expect(r.message).toContain("有効になっていません");
  });

  it("502 SEND_FAILED → failed（汎用送信失敗文言）", () => {
    const r = interpretQrComplete(502, { success: false, error: { code: "SEND_FAILED" } });
    expect(r.outcome).toBe("failed");
    expect(r.message).toContain("送信に失敗");
  });

  it("body が null / 想定外でも failed に倒れる（白画面にしない）", () => {
    expect(interpretQrComplete(500, null).outcome).toBe("failed");
    expect(interpretQrComplete(200, {}).outcome).toBe("failed");
  });
});
