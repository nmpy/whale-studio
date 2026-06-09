/**
 * src/__tests__/liff-gps-status.test.ts
 *
 * src/lib/liff/gps-status.ts（GPS チェックインの状態→表示の純関数）を検証する。
 *
 * 検証観点:
 *   - classifyGeolocationError: PERMISSION_DENIED / POSITION_UNAVAILABLE / TIMEOUT / その他
 *   - attemptStatusFor: 状態 → 試行ログ status（ログ対象外は null）
 *   - gpsStatusPresentation: tone / retry / QR フォールバック / out_of_range の距離表記 / success
 */

import { describe, it, expect } from "vitest";
import {
  classifyGeolocationError,
  attemptStatusFor,
  gpsStatusPresentation,
} from "@/lib/liff/gps-status";

// GeolocationPositionError 互換の最小オブジェクト
const geoErr = (code: number) => ({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });

describe("classifyGeolocationError", () => {
  it("PERMISSION_DENIED → denied", () => { expect(classifyGeolocationError(geoErr(1))).toBe("denied"); });
  it("POSITION_UNAVAILABLE → unavailable", () => { expect(classifyGeolocationError(geoErr(2))).toBe("unavailable"); });
  it("TIMEOUT → timeout", () => { expect(classifyGeolocationError(geoErr(3))).toBe("timeout"); });
  it("未知コード → error", () => { expect(classifyGeolocationError(geoErr(99))).toBe("error"); });
});

describe("attemptStatusFor（試行ログ status）", () => {
  it("denied / blocked → permission_denied", () => {
    expect(attemptStatusFor("denied")).toBe("permission_denied");
    expect(attemptStatusFor("blocked")).toBe("permission_denied");
  });
  it("unavailable → gps_unavailable / timeout → timeout / error → unknown_error", () => {
    expect(attemptStatusFor("unavailable")).toBe("gps_unavailable");
    expect(attemptStatusFor("timeout")).toBe("timeout");
    expect(attemptStatusFor("error")).toBe("unknown_error");
  });
  it("success / out_of_range / idle はログ対象外 → null", () => {
    expect(attemptStatusFor("success")).toBeNull();
    expect(attemptStatusFor("out_of_range")).toBeNull();
    expect(attemptStatusFor("idle")).toBeNull();
  });
});

describe("gpsStatusPresentation", () => {
  it("idle: 事前説明・retry/QR なし・neutral", () => {
    const p = gpsStatusPresentation("idle");
    expect(p.tone).toBe("neutral");
    expect(p.showRetry).toBe(false);
    expect(p.showQrFallback).toBe(false);
    expect(p.message).toContain("常時追跡は行いません");
  });

  it("denied: danger・retry あり・QR フォールバックあり", () => {
    const p = gpsStatusPresentation("denied");
    expect(p.tone).toBe("danger");
    expect(p.showRetry).toBe(true);
    expect(p.showQrFallback).toBe(true);
    expect(p.title).toBe("位置情報の利用が許可されていません");
  });

  it("blocked: 設定変更を促す（danger・retry・QR）", () => {
    const p = gpsStatusPresentation("blocked");
    expect(p.tone).toBe("danger");
    expect(p.showRetry).toBe(true);
    expect(p.message).toContain("設定");
  });

  it("timeout: warn・retry・QR フォールバック", () => {
    const p = gpsStatusPresentation("timeout");
    expect(p.tone).toBe("warn");
    expect(p.showRetry).toBe(true);
    expect(p.showQrFallback).toBe(true);
  });

  it("out_of_range: warn・retry・距離/範囲/地点名を含む・QRフォールバックなし", () => {
    const p = gpsStatusPresentation("out_of_range", { locationName: "駅前", distanceMeters: 1500, radiusMeters: 50 });
    expect(p.tone).toBe("warn");
    expect(p.showRetry).toBe(true);
    expect(p.showQrFallback).toBe(false);
    expect(p.message).toContain("駅前");
    expect(p.message).toContain("半径50m");
    expect(p.message).toContain("約1.5km"); // 1000m 以上は km 表記
    expect(p.message).toContain("もう少し");
  });

  it("out_of_range: 1000m 未満は m 表記", () => {
    const p = gpsStatusPresentation("out_of_range", { distanceMeters: 320, radiusMeters: 50 });
    expect(p.message).toContain("約320m");
  });

  it("success: success トーン・transition 案内", () => {
    const p = gpsStatusPresentation("success", { successMessage: "やったね", hasTransition: true });
    expect(p.tone).toBe("success");
    expect(p.title).toBe("チェックイン完了！");
    expect(p.message).toContain("やったね");
    expect(p.message).toContain("物語が進行します");
  });

  it("unavailable / error: detailMessage で本文上書き可", () => {
    expect(gpsStatusPresentation("unavailable", { detailMessage: "電波が弱いです" }).message).toBe("電波が弱いです");
    expect(gpsStatusPresentation("error", { detailMessage: "サーバーエラー" }).message).toBe("サーバーエラー");
  });
});
