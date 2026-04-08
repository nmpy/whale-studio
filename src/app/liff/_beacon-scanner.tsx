"use client";

// src/app/liff/_beacon-scanner.tsx
// Web Bluetooth Beacon 自動検知コンポーネント（Progressive Enhancement）
//
// 対応環境が限定的なため、非対応時は graceful degradation し、
// QR チェックインを常にメインの逃げ道として維持する。

import { useState, useCallback } from "react";

// ── 型定義 ──
export type BeaconSupportStatus = "supported" | "unsupported" | "unknown";
export type BeaconScanStatus = "idle" | "scanning" | "detected" | "error";

export interface BeaconCandidate {
  uuid: string;
  major?: number;
  minor?: number;
  rssi?: number;
}

interface BeaconScannerProps {
  /** 検知したい beacon UUID リスト（location の beacon_uuid 一覧） */
  expectedUuids: string[];
  /** Beacon 検知時のコールバック */
  onDetected: (candidate: BeaconCandidate) => void;
}

/** Web Bluetooth 対応状況を��定 */
export function getBeaconSupport(): BeaconSupportStatus {
  if (typeof navigator === "undefined") return "unknown";
  if (!("bluetooth" in navigator)) return "unsupported";
  return "supported";
}

export function BeaconScanner({ expectedUuids, onDetected }: BeaconScannerProps) {
  const support = getBeaconSupport();
  const [status, setStatus] = useState<BeaconScanStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleScan = useCallback(async () => {
    if (support !== "supported") return;

    setStatus("scanning");
    setErrorMsg(null);

    try {
      // Web Bluetooth API でビーコンスキャン
      // 注意: 多くの LIFF ブラウザでは利用不可
      const nav = navigator as Navigator & {
        bluetooth?: {
          requestLEScan?: (options: {
            filters?: Array<{ manufacturerData?: Array<{ companyIdentifier: number }> }>;
            acceptAllAdvertisements?: boolean;
          }) => Promise<{ stop: () => void }>;
          addEventListener?: (event: string, handler: (e: unknown) => void) => void;
          removeEventListener?: (event: string, handler: (e: unknown) => void) => void;
        };
      };

      if (!nav.bluetooth?.requestLEScan) {
        setStatus("error");
        setErrorMsg("この環境では Beacon スキャンに対応していません");
        return;
      }

      const scan = await nav.bluetooth.requestLEScan({
        acceptAllAdvertisements: true,
      });

      // 10秒後にスキャン停止
      const timeout = setTimeout(() => {
        scan.stop();
        setStatus((s) => s === "scanning" ? "error" : s);
        setErrorMsg("ビーコンが見つかりませんでした");
      }, 10000);

      const handler = (event: unknown) => {
        // BLE 広告���ベントから iBeacon データを抽出
        const adEvent = event as { manufacturerData?: Map<number, DataView> };
        if (!adEvent.manufacturerData) return;

        // Apple iBeacon: company ID 0x004C
        const appleData = adEvent.manufacturerData.get(0x004c);
        if (!appleData || appleData.byteLength < 23) return;

        // iBeacon パケッ��解析
        const uuid = [
          hex(appleData, 2, 6), hex(appleData, 6, 8),
          hex(appleData, 8, 10), hex(appleData, 10, 12),
          hex(appleData, 12, 18),
        ].join("-").toLowerCase();

        const major = appleData.getUint16(18, false);
        const minor = appleData.getUint16(20, false);

        // 期待する UUID ���照合
        if (expectedUuids.some((u) => u.toLowerCase() === uuid)) {
          scan.stop();
          clearTimeout(timeout);
          setStatus("detected");
          onDetected({ uuid, major, minor });
        }
      };

      nav.bluetooth.addEventListener?.("advertisementreceived", handler);
    } catch (err) {
      console.error("[BeaconScanner]", err);
      setStatus("error");
      setErrorMsg(err instanceof Error && err.name === "NotAllowedError"
        ? "Bluetooth の使用が許可されていません"
        : "ビーコンスキャンに失敗しました");
    }
  }, [support, expectedUuids, onDetected]);

  if (support === "unsupported") {
    return (
      <div style={{ textAlign: "center", padding: "12px 0", fontSize: 12, color: "#9ca3af" }}>
        この端末 / ブラウザでは���動検知に対応していません
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center", padding: "16px 0" }}>
      <div style={{ borderTop: "1px solid #e5e7eb", marginBottom: 16, paddingTop: 16 }}>
        <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>または</p>
      </div>

      {status === "idle" && (
        <button
          type="button"
          onClick={handleScan}
          style={{
            padding: "10px 20px", background: "#f3f4f6", color: "#374151",
            border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 13,
            fontWeight: 500, cursor: "pointer",
          }}
        >
          近くのビーコンを検知
        </button>
      )}

      {status === "scanning" && (
        <div>
          <div style={{ width: 28, height: 28, border: "3px solid #e5e7eb", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 8px" }} />
          <p style={{ fontSize: 13, color: "#6b7280" }}>ビーコンを検���中...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {status === "detected" && (
        <p style={{ fontSize: 13, color: "#16a34a", fontWeight: 600 }}>ビーコンを検知しました</p>
      )}

      {status === "error" && (
        <div>
          <p style={{ fontSize: 13, color: "#dc2626", marginBottom: 8 }}>{errorMsg}</p>
          <button
            type="button"
            onClick={() => { setStatus("idle"); setErrorMsg(null); }}
            style={{ fontSize: 12, color: "#6b7280", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            もう一度試す
          </button>
        </div>
      )}
    </div>
  );
}

function hex(dv: DataView, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) s += dv.getUint8(i).toString(16).padStart(2, "0");
  return s;
}
