// src/__tests__/liff-code-reader.test.ts
//
// コードリーダーブロックの location_checkin 解決（resolveCheckinFromQr）の単体テスト。

import { describe, it, expect } from "vitest";
import { resolveCheckinFromQr } from "@/lib/liff/qr-resolve";

describe("resolveCheckinFromQr", () => {
  it("Whale チェックイン URL（work_id + location_id）→ 相対チェックインパスに解決", () => {
    const r = resolveCheckinFromQr("https://app.whale-studio.app/liff?work_id=W1&location_id=L1");
    expect(r.kind).toBe("checkin");
    if (r.kind === "checkin") {
      expect(r.workRef).toBe("W1");
      expect(r.locationRef).toBe("L1");
      expect(r.path).toBe("/liff?work_id=W1&location_id=L1");
    }
  });

  it("liff.state 形式 URL からも解決できる", () => {
    const state = encodeURIComponent("/liff?work_id=W2&location_id=L2");
    const r = resolveCheckinFromQr(`https://liff.line.me/123-abc?liff.state=${state}`);
    expect(r.kind).toBe("checkin");
    if (r.kind === "checkin") {
      expect(r.path).toBe("/liff?work_id=W2&location_id=L2");
    }
  });

  it("生コード + fallbackWorkId → コードを location_id として解決", () => {
    const r = resolveCheckinFromQr("loc-public-123", { fallbackWorkId: "WX" });
    expect(r.kind).toBe("checkin");
    if (r.kind === "checkin") {
      expect(r.workRef).toBe("WX");
      expect(r.locationRef).toBe("loc-public-123");
      expect(r.path).toBe("/liff?work_id=WX&location_id=loc-public-123");
    }
  });

  it("生コードで fallbackWorkId が無い → invalid（work が決まらない）", () => {
    expect(resolveCheckinFromQr("loc-only").kind).toBe("invalid");
  });

  it("URL の work_id を優先し、fallbackWorkId は補完のみ", () => {
    const r = resolveCheckinFromQr("https://app.whale-studio.app/liff?work_id=URLW&location_id=L9", { fallbackWorkId: "FALLBACK" });
    expect(r.kind).toBe("checkin");
    if (r.kind === "checkin") expect(r.workRef).toBe("URLW");
  });

  it("location 情報の無い URL → invalid", () => {
    expect(resolveCheckinFromQr("https://example.com/other").kind).toBe("invalid");
  });

  it("javascript: 等の非 http(s) → invalid（生コード扱いにしない）", () => {
    expect(resolveCheckinFromQr("javascript:alert(1)", { fallbackWorkId: "W" }).kind).toBe("invalid");
  });

  it("解決パスは常に現在オリジンの相対 /liff（外部ドメインへ遷移しない）", () => {
    const r = resolveCheckinFromQr("https://evil.example.com/liff?work_id=W&location_id=L");
    // location/work は抽出するが、遷移先は相対 /liff に再構成する
    expect(r.kind).toBe("checkin");
    if (r.kind === "checkin") expect(r.path.startsWith("/liff?")).toBe(true);
  });
});
