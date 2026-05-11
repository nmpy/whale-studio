"use client";

// src/components/liff/LiffShareButton.tsx
// LIFF ページに表示するシェアボタン。
//
// 動作仕様:
//   1. settings.share_enabled が true のときだけ呼び出し元が表示する（このコンポーネントは前提として on のときのみ render される想定）
//   2. クリック時に LIFF SDK の shareTargetPicker を呼ぶ
//      - 事前に `liff.isApiAvailable("shareTargetPicker")` でガード
//      - メッセージは settings.share_message があればそれ、なければ「ページタイトル + URL」の単一 text
//   3. shareTargetPicker が使えない / 失敗 / キャンセル / LINE 外ブラウザでも画面が壊れないようにする
//   4. 利用不可時は URL コピーのフォールバックを表示する
//
// LINE Developers コンソール側の注意:
//   - Share Target Picker は LIFF アプリ単位で「シェアターゲットピッカーを利用する」設定を有効化する必要がある。
//     管理画面 (https://developers.line.biz) → 該当 LIFF → 「Scopes」「Permissions」を確認すること。
//   - `liff.isApiAvailable("shareTargetPicker")` が false を返す主な原因:
//       * LIFF アプリ側で機能が無効化されている
//       * LINE アプリ外（外部ブラウザ）で開かれている
//       * LIFF SDK 初期化が完了していない
//     どの場合でも本コンポーネントはクラッシュしない実装にしている。

import { useState } from "react";
import type { LiffPageConfigSettings } from "@/types";

interface Props {
  settings: LiffPageConfigSettings;
  /** LIFF ページタイトル（share_message 未設定時のフォールバック） */
  pageTitle: string;
  /** プレビュー時は実行せずトースト表示にとどめる */
  preview?: boolean;
}

type ShareStatus = "idle" | "sending" | "success" | "cancelled" | "unsupported" | "error";

const DEFAULT_LABEL = "友だちにシェアする";

/** SSR 環境でも壊れない安全な現在 URL 取得 */
function getCurrentUrl(): string {
  if (typeof window === "undefined") return "";
  return window.location.href;
}

function buildMessageText(settings: LiffPageConfigSettings, pageTitle: string): string {
  const custom = settings.share_message?.trim();
  if (custom) return custom;
  // デフォルト: ページタイトル + 現在 URL
  const url = getCurrentUrl();
  return [pageTitle, url].filter(Boolean).join("\n");
}

export function LiffShareButton({ settings, pageTitle, preview }: Props) {
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showCopyFallback, setShowCopyFallback] = useState(false);

  const label = settings.share_button_label?.trim() || DEFAULT_LABEL;

  const messageText = (): string => buildMessageText(settings, pageTitle);

  const copyUrlToClipboard = async () => {
    const url = getCurrentUrl();
    if (!url) {
      setFeedback("URL を取得できませんでした");
      return;
    }
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setFeedback("URL をコピーしました");
        return;
      }
    } catch {
      // ignore — フォールバックに進む
    }
    // 古いブラウザや権限が無いケースでは execCommand("copy") にフォールバック
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setFeedback("URL をコピーしました");
    } catch {
      setFeedback("コピーに失敗しました。手動でコピーしてください: " + url);
    }
  };

  const handleClick = async () => {
    setFeedback(null);
    setShowCopyFallback(false);

    // プレビューモード: API を呼ばずに案内のみ
    if (preview) {
      setStatus("success");
      setFeedback("（プレビュー）友だち選択画面が開きます");
      return;
    }

    setStatus("sending");
    try {
      // LIFF SDK を動的 import（外部ブラウザでも import 自体は通る）
      const liff = (await import("@line/liff")).default;

      // 初期化済みかは isApiAvailable がガードしてくれるが、念のため try で囲んでクラッシュ防止
      const available = (() => {
        try {
          return liff.isApiAvailable("shareTargetPicker");
        } catch {
          return false;
        }
      })();

      if (!available) {
        setStatus("unsupported");
        setFeedback("この環境ではシェア機能を利用できません。URL をコピーして共有してください。");
        setShowCopyFallback(true);
        return;
      }

      const res = await liff.shareTargetPicker([
        { type: "text", text: messageText() },
      ]);

      // res?.status === "success" のとき送信完了、null の場合はキャンセル
      // 環境によって res が undefined のこともある（古い SDK）
      if (res && (res as { status?: string }).status === "success") {
        setStatus("success");
        setFeedback("送信しました");
      } else if (res === null || res === undefined) {
        // キャンセルとして扱う（落とさない）
        setStatus("cancelled");
        setFeedback(null);
      } else {
        setStatus("success");
        setFeedback("送信しました");
      }
    } catch (err) {
      // shareTargetPicker は permission denied / network 失敗などで throw する
      setStatus("error");
      setFeedback("シェアに失敗しました。URL をコピーして共有してください。");
      setShowCopyFallback(true);
      // eslint-disable-next-line no-console
      console.warn("[LiffShareButton] shareTargetPicker error:", err);
    }
  };

  const isSending = status === "sending";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isSending}
        aria-label={label}
        className="w-full h-12 px-4 rounded-[10px] text-white font-bold text-[15px] tracking-tight transition-opacity disabled:opacity-50 active:opacity-90"
        style={{ background: "var(--liff-line-green, #06C755)" }}
      >
        {isSending ? "シェア中..." : label}
      </button>

      {feedback && (
        <p
          className={`text-[13px] leading-[1.6] ${
            status === "error" || status === "unsupported"
              ? "text-[color:var(--liff-danger,#E22B2B)]"
              : "text-[color:var(--liff-secondary-text,#666666)]"
          }`}
          role="status"
          aria-live="polite"
        >
          {feedback}
        </p>
      )}

      {showCopyFallback && (
        <button
          type="button"
          onClick={copyUrlToClipboard}
          className="w-full h-11 px-4 rounded-[10px] text-[14px] font-bold tracking-tight border border-[color:var(--liff-line-green,#06C755)] text-[color:var(--liff-line-green,#06C755)] bg-[color:var(--liff-surface,#FFFFFF)] active:opacity-80"
        >
          URL をコピーする
        </button>
      )}
    </div>
  );
}
