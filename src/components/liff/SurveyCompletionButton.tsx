"use client";

// src/components/liff/SurveyCompletionButton.tsx
//
// アンケートの「送信完了画面」と「回答済み画面」の両方に表示する、CMS 設定の完了後ボタン。
// 動作（settings.survey_completion_button_action）:
//   - liff_home : 作品メニューホーム（.../w/{workPublicId}）へ遷移（現在 URL から導出）
//   - open_url  : 指定 URL を開く（LIFF 内は liff.openWindow、外部は window.open）
//   - close     : liff.closeWindow()
// preview（CMS プレビュー）では実際の遷移 / close はしない（導線の見た目だけ確認）。
// 判定・既定補完は純関数 survey-completion に集約。ここは副作用のみ。

import { useState } from "react";
import { LiffActionButton } from "./ui";
import type { LiffPageConfigSettings } from "@/types";
import { resolveCompletionButton, deriveLiffHomeHref } from "@/lib/liff/survey-completion";

interface LiffLike {
  isInClient: () => boolean;
  openWindow: (opts: { url: string; external?: boolean }) => void;
  closeWindow: () => void;
}

async function loadLiff(): Promise<LiffLike> {
  const mod = await import("@line/liff");
  return mod.default as unknown as LiffLike;
}

export function SurveyCompletionButton({
  settings,
  preview = false,
}: {
  settings: LiffPageConfigSettings;
  preview?: boolean;
}) {
  const btn = resolveCompletionButton(settings);
  const [busy, setBusy] = useState(false);

  if (!btn.show) return null;

  async function handle() {
    if (busy) return;
    // CMS プレビューでは実遷移・close しない（画面確認のみ）。
    if (preview) return;
    setBusy(true);
    try {
      if (btn.action === "liff_home") {
        const home = deriveLiffHomeHref(typeof window !== "undefined" ? window.location.pathname : null);
        if (home) window.location.assign(home);
        return; // 遷移するので後続不要
      }
      if (btn.action === "open_url" && btn.url) {
        try {
          const liff = await loadLiff();
          if (liff.isInClient()) {
            liff.openWindow({ url: btn.url, external: true });
            return;
          }
        } catch {
          // liff 未使用（外部ブラウザ）→ window.open にフォールバック
        }
        window.open(btn.url, "_blank", "noopener,noreferrer");
        return;
      }
      if (btn.action === "close") {
        try {
          const liff = await loadLiff();
          liff.closeWindow();
        } catch {
          // 外部ブラウザ等では閉じられない（no-op）
        }
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5">
      <LiffActionButton type="button" variant="filled" fullWidth onClick={handle} loading={busy}>
        {btn.label}
      </LiffActionButton>
    </div>
  );
}
