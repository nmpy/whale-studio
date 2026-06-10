"use client";

// src/app/liff/_beacon-scanner.tsx
// Web Bluetooth Beacon 自動検知コンポーネント（Progressive Enhancement）
//
// 対応環境が限定的なため、非対応時は graceful degradation し、
// QR チェックインを常にメインの逃げ道として維持する。
// 表示は LIFF 体験画面の共通コンポーネント（LiffResultState / LiffLoadingState）にトーンを合わせる。

import { useState, useCallback } from "react";
import { LiffResultState, LiffLoadingState } from "@/components/liff/experience";
import { LiffButton } from "@/components/liff/primitives/LiffButton";

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

/** Web Bluetooth 対応状況を判定 */
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
        // BLE 広告イベントから iBeacon データを抽出
        const adEvent = event as { manufacturerData?: Map<number, DataView> };
        if (!adEvent.manufacturerData) return;

        // Apple iBeacon: company ID 0x004C
        const appleData = adEvent.manufacturerData.get(0x004c);
        if (!appleData || appleData.byteLength < 23) return;

        // iBeacon パケット解析
        const uuid = [
          hex(appleData, 2, 6), hex(appleData, 6, 8),
          hex(appleData, 8, 10), hex(appleData, 10, 12),
          hex(appleData, 12, 18),
        ].join("-").toLowerCase();

        const major = appleData.getUint16(18, false);
        const minor = appleData.getUint16(20, false);

        // 期待する UUID と照合
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

  // 非対応端末: 控えめな案内のみ（QR が常にメイン導線）。
  if (support === "unsupported") {
    return (
      <div style={{ textAlign: "center", padding: "12px 0", fontSize: 12, color: "var(--liff-tertiary-text,#8C8C8C)" }}>
        この端末 / ブラウザでは自動検知に対応していません
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--liff-border,#EAEAEA)", paddingTop: 16 }}>
      <p style={{ fontSize: 12, color: "var(--liff-tertiary-text,#8C8C8C)", textAlign: "center", margin: "0 0 12px" }}>または</p>

      {status === "idle" && (
        <LiffButton type="button" variant="outline" size="sm" onClick={handleScan}>
          近くのビーコンを検知
        </LiffButton>
      )}

      {status === "scanning" && (
        <LiffLoadingState title="ビーコンを探しています" description="このまま少しだけお待ちください。" />
      )}

      {status === "detected" && (
        <LiffResultState variant="success" title="ビーコンを検知しました" />
      )}

      {status === "error" && (
        <LiffResultState
          variant="warning"
          icon="📡"
          title="ビーコンが見つかりませんでした"
          description={errorMsg ?? undefined}
          primaryActionLabel="もう一度試す"
          onPrimaryAction={() => { setStatus("idle"); setErrorMsg(null); }}
        />
      )}
    </div>
  );
}

function hex(dv: DataView, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) s += dv.getUint8(i).toString(16).padStart(2, "0");
  return s;
}
