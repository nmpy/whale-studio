"use client";

// src/components/liff/TicketLinkReportButton.tsx
//
// 登録完了画面の「報告する」ボタン。
// 送信処理は #597 の sendCompletionLineMessage をそのまま再利用する
// （多重送信防止 / preview 非送信 / LIFF 外 fallback / closeWindow は共通実装に委ねる）。
//
// 重要:
//   - LINE へ送るのは **message のみ**。label は画面表示専用で送信しない（別フィールド）。
//   - 送信の成否で TicketLink の状態は変えない。送信失敗でも登録は完了扱い。

import { useState } from "react";
import { LiffActionButton } from "./ui";
import { sendCompletionLineMessage, type LiffLike } from "./completion-line-message";

export const REPORT_SEND_FAILED_MESSAGE =
  "チケット連携は完了しています。\nLINEへの報告メッセージのみ送信できませんでした。\nトークルームへ戻り、手動で「報告する」と送信してください。";

interface Props {
  /** 画面に出す文言。**送信本文ではない**。 */
  label: string;
  /** LINE トークへ送る本文。空なら送信しない。 */
  message: string | null | undefined;
  /** CMS プレビュー時は実送信しない。 */
  preview?: boolean;
  /** テスト用の LIFF 注入。 */
  load?: () => Promise<LiffLike>;
}

export function TicketLinkReportButton({ label, message, preview, load }: Props) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<"sent" | "failed" | null>(null);

  async function handleClick() {
    // 多重タップ防止: 送信中および送信成功後は再実行しない。
    if (sending || result === "sent") return;
    setSending(true);
    try {
      const r = await sendCompletionLineMessage({ message, preview, load });
      // "skipped"（空文言）はユーザー起因の失敗ではないため、失敗表示にしない。
      setResult(r === "sent" || r === "skipped" ? "sent" : "failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-4">
      <LiffActionButton
        type="button"
        onClick={handleClick}
        disabled={sending || result === "sent"}
        aria-busy={sending}
      >
        {sending ? "送信中…" : label}
      </LiffActionButton>

      {result === "sent" && (
        <p className="mt-2 text-sm text-[color:var(--liff-text-sub,#666)]">送信しました。</p>
      )}
      {result === "failed" && (
        <p className="mt-2 whitespace-pre-line text-sm text-[color:var(--liff-text-sub,#666)]">
          {REPORT_SEND_FAILED_MESSAGE}
        </p>
      )}
    </div>
  );
}
