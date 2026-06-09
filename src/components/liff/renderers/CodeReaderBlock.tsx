"use client";

// src/components/liff/renderers/CodeReaderBlock.tsx
//
// コードリーダー（QR読み取り）ブロック。
//  - 行（「チェックインする」+ chevron）をタップするとボトムシートが開く。
//  - 実機 LIFF: liff.scanCodeV2() でQR読み取り。
//      - after_scan="location_checkin": 既存チェックイン導線 /liff?work_id=..&location_id=.. へ遷移
//        （検証・チェックイン・履歴更新は既存フローを再利用）。
//      - after_scan="show_result": 読み取り値を表示するのみ。
//  - プレビュー/エディタ（ctx.preview）: カメラを起動せず、グレーのプレースホルダを表示。
//  - scanCodeV2 が使えない環境ではエラーで落とさず案内文言を表示する。

import { useCallback, useEffect, useRef, useState } from "react";
import type { CodeReaderSettings } from "@/types";
import { useLiffPlayerContext } from "@/components/liff/LiffPlayerContext";
import { isScanCancelError, truncateQrValue } from "@/lib/liff/qr";
import { resolveCheckinFromQr } from "@/lib/liff/qr-resolve";

interface Props {
  settings: CodeReaderSettings;
  /** LiffRenderer から渡る。プレビュー/エディタではカメラを起動しない。 */
  preview?: boolean;
  blockId?: string;
}

type Phase = "scanning" | "navigating" | "done" | "error";

function ChevronRight() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function CodeReaderBlock({ settings, preview }: Props) {
  const ctx = useLiffPlayerContext();
  const isPreview = !!preview || !!ctx?.preview;

  const label      = settings.label?.trim() || "チェックインする";
  const modalTitle = settings.modal_title?.trim() || "コードリーダー";
  const description = settings.description?.trim() || "";
  const afterScan  = settings.after_scan ?? "location_checkin";

  const [open, setOpen]   = useState(false);
  const [phase, setPhase] = useState<Phase>("scanning");
  const [message, setMessage] = useState("");
  const [resultValue, setResultValue] = useState<string | null>(null);
  const scanningRef = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    scanningRef.current = false;
  }, []);

  const handleValue = useCallback((raw: string) => {
    if (afterScan === "show_result") {
      setResultValue(truncateQrValue(raw));
      setMessage("読み取りました");
      setPhase("done");
      return;
    }
    // location_checkin: 既存チェックイン導線へ遷移（検証・チェックイン・履歴は既存フローが処理）。
    const r = resolveCheckinFromQr(raw, { fallbackWorkId: ctx?.workId });
    if (r.kind !== "checkin") {
      setMessage("このQRコードは利用できません。");
      setPhase("error");
      return;
    }
    setMessage("チェックイン画面を開いています…");
    setPhase("navigating");
    if (typeof window !== "undefined") window.location.assign(r.path);
  }, [afterScan, ctx?.workId]);

  const runScan = useCallback(async () => {
    if (isPreview || scanningRef.current) return;
    scanningRef.current = true;
    setPhase("scanning");
    setMessage("");
    setResultValue(null);
    try {
      const liff = (await import("@line/liff")).default;
      const available =
        typeof liff.isApiAvailable === "function" &&
        liff.isApiAvailable("scanCodeV2") &&
        typeof liff.scanCodeV2 === "function";
      if (!available) {
        setMessage("この環境ではコードリーダーを利用できません。LINEアプリから開いてください。");
        setPhase("error");
        return;
      }
      const result = await liff.scanCodeV2();
      const raw = result?.value ?? null;
      if (!raw) {
        // キャンセル相当 → エラーにせず閉じる。
        close();
        return;
      }
      handleValue(raw);
    } catch (err) {
      if (isScanCancelError(err)) {
        close();
        return;
      }
      // 起動失敗（Scan QR 未設定 / 初期化未完了等）。詳細は出さず案内に寄せる。
      setMessage("コードリーダーを起動できませんでした。LINEアプリから開き、LIFF設定をご確認ください。");
      setPhase("error");
    } finally {
      scanningRef.current = false;
    }
  }, [isPreview, handleValue, close]);

  // シートを開いたら（実機のみ）自動でスキャン開始。
  useEffect(() => {
    if (open && !isPreview) void runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openSheet = useCallback(() => {
    setPhase("scanning");
    setMessage("");
    setResultValue(null);
    setOpen(true);
  }, []);

  return (
    <>
      {/* ── 行（タップでシートを開く） ── */}
      <button
        type="button"
        onClick={openSheet}
        className="liff-font flex items-center justify-between w-full min-h-[52px] py-3 text-left bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]"
      >
        <span className="text-[16px] font-bold">{label}</span>
        <span className="text-[color:var(--liff-tertiary-text)]"><ChevronRight /></span>
      </button>

      {/* ── ボトムシート ── */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={modalTitle}
          className="fixed inset-0 z-50 flex items-end justify-center"
        >
          {/* overlay */}
          <button
            type="button"
            aria-label="閉じる"
            onClick={close}
            className="absolute inset-0 bg-black/50"
          />
          {/* sheet */}
          <div className="liff-font relative w-full max-w-md bg-white rounded-t-2xl shadow-2xl pb-[max(20px,env(safe-area-inset-bottom))]"
               style={{ minHeight: "70vh" }}>
            <div className="relative flex items-center justify-center h-14 border-b border-gray-100">
              <span className="text-[15px] font-bold text-gray-900">{modalTitle}</span>
              <button
                type="button"
                onClick={close}
                aria-label="閉じる"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-500"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="px-4 pt-5 flex flex-col items-center">
              {description && (
                <p className="text-[13px] text-gray-500 leading-relaxed text-center mb-4">{description}</p>
              )}

              {/* QR 読み込みエリア */}
              <div
                className="w-full max-w-[260px] aspect-square rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-center"
              >
                {isPreview ? (
                  <span className="text-[13px] text-gray-400">QR読み込み画面</span>
                ) : phase === "scanning" ? (
                  <span className="text-[13px] text-gray-400">カメラを起動しています…</span>
                ) : phase === "navigating" || phase === "done" ? (
                  <span className="text-[28px]" aria-hidden="true">✅</span>
                ) : (
                  <span className="text-[28px]" aria-hidden="true">⚠️</span>
                )}
              </div>

              {/* 状態メッセージ */}
              {!isPreview && message && (
                <p
                  className={`mt-4 text-[13px] leading-relaxed text-center ${phase === "error" ? "text-rose-700" : "text-gray-700"}`}
                >
                  {message}
                </p>
              )}
              {!isPreview && phase === "done" && resultValue && (
                <p className="mt-2 text-[12px] text-gray-500 break-all text-center">{resultValue}</p>
              )}

              {/* 再試行（エラー時） */}
              {!isPreview && phase === "error" && (
                <button
                  type="button"
                  onClick={runScan}
                  className="mt-5 px-5 py-2.5 rounded-full text-[13px] font-bold text-white bg-brand hover:bg-brand-deep"
                >
                  もう一度読み取る
                </button>
              )}

              {isPreview && (
                <p className="mt-4 text-[12px] text-gray-400 text-center">
                  プレビューではカメラは起動しません（実機 LINE で読み取りできます）
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
