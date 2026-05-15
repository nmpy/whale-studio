"use client";

// src/components/liff/LiffStudioFooter.tsx
//
// LIFF プレイヤー画面の最下部に表示する共通クレジット表記。
//
// 仕様:
//   - 文言: "Powered by Whale Studio" 固定
//   - sticky / fixed ではなく通常の <footer> として本文末尾に流す
//   - 全ページ共通 (LiffMenuHomeRenderer / LiffSinglePageRenderer の末尾に置く)
//   - 控えめなトーン: 中央寄せ・小さめフォント・薄いグレー・上部余白多め
//   - 左右 padding は `.liff-player-main` で 16px を保証
//
// ホワイトラベル運用想定: 呼び出し側で `settings.show_whale_studio_credit === false`
// のときに非表示にする。本コンポーネント自体は表示するかどうかを判定しない (= 呼び側責務)。

export function LiffStudioFooter() {
  return (
    <footer className="liff-player-main pt-10 pb-6">
      <p className="text-center text-[11px] tracking-[0.04em] text-[color:var(--liff-tertiary-text,#8C8C8C)]">
        Powered by Whale Studio
      </p>
    </footer>
  );
}

/** 表示判定ヘルパー — settings に `show_whale_studio_credit: false` がある場合のみ非表示。
 *  未指定 / true / undefined はすべて表示する。 */
export function shouldShowWhaleStudioCredit(
  settings: { show_whale_studio_credit?: boolean } | null | undefined
): boolean {
  return settings?.show_whale_studio_credit !== false;
}
