"use client";

// src/components/liff/LocationHistoryRenderer.tsx
// LIFF Location モード — 自分のチェックイン履歴を表示する。
//
// MVP 仕様: PR #1 ではプレースホルダー（履歴取得 API を別 PR で実装する想定）。
// LINE ユーザー ID が取れない / API 未対応の場合でも落ちないように案内表示のみ行う。

import type { LiffPageConfigSettings } from "@/types";
import { LiffShareButton } from "./LiffShareButton";

export interface LocationHistoryRendererConfig {
  work_id:       string;
  title:         string | null;
  description:   string | null;
  settings_json: LiffPageConfigSettings;
}

interface Props {
  config: LocationHistoryRendererConfig;
  lineUserId?: string | null;
  /** プレビュー時はサンプル履歴表示にする */
  preview?: boolean;
}

export function LocationHistoryRenderer({ config, lineUserId, preview }: Props) {
  return (
    <div className="liff-font min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]">
      <main className="max-w-md mx-auto px-4 py-5 flex flex-col gap-4 pb-24">
        {(config.title || config.description) && (
          <div className="space-y-1.5">
            {config.title && (
              <h1 className="text-[20px] leading-tight font-bold tracking-tight break-words">
                {config.title}
              </h1>
            )}
            {config.description && (
              <p className="text-[14px] leading-relaxed text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words">
                {config.description}
              </p>
            )}
          </div>
        )}

        {/* ── 履歴セクション ──
            本格的な履歴取得 API は次の PR で追加予定。MVP では案内表示のみ。 */}
        {!preview && !lineUserId ? (
          <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[12px] px-4 py-6 text-center">
            <p className="text-[15px] leading-[1.6] text-[color:var(--liff-secondary-text)]">
              LINE にログインすると、これまでのチェックイン履歴を確認できます。
            </p>
          </div>
        ) : (
          <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[12px] px-4 py-6 text-center">
            <p className="text-3xl mb-2">📍</p>
            <p className="text-[15px] leading-[1.6] text-[color:var(--liff-secondary-text)]">
              チェックイン履歴表示は近日公開予定です。
            </p>
            <p className="text-[12px] leading-[1.6] text-[color:var(--liff-tertiary-text)] mt-2">
              （履歴取得 API 実装後、ここに地点名・日時・種別・成否が一覧表示されます）
            </p>
          </div>
        )}

        {config.settings_json.share_enabled && (
          <div className="pt-2">
            <LiffShareButton settings={config.settings_json} pageTitle={config.title || ""} preview={preview} />
          </div>
        )}
      </main>
    </div>
  );
}
