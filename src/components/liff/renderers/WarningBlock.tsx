"use client";

import type { WarningSettings } from "@/types";

// ブロック単位のネタバレ / 注意 / 危険警告（CMS 表示名: バナー）。
// 親ブロック (LiffRenderer / HintSiteRenderer / AccordionBlock) からのみ表示される。
//
// PR-BLK3b: 強い amber/sky/red のベタ塗りをやめ、player に馴染む「淡いカード」に統一。
//   - 背景 = --liff-surface-subtle（かなり薄い面）/ 枠 = --liff-border / 本文 = --liff-primary-text。
//   - tone 差は強い背景色ではなく「左端の細いアクセント線」で控えめに表現。
//   - 既存トークンのみ使用（新トークン・hardcoded hex 追加なし）。tone 値/意味は不変。
//   ※ 添付画像のような tone 別の淡い色背景＋アイコンは additive な icon フィールド & banner token が
//     必要なため PR-BLK4a で対応（本 PR は色味を弱めることに限定）。
const TONE_ACCENT: Record<NonNullable<WarningSettings["tone"]>, string> = {
  spoiler: "var(--liff-border-strong)", // 中立（淡いグレー）
  info:    "var(--liff-border-strong)", // 中立（淡いグレー）
  danger:  "var(--liff-danger)",        // 注意系のみ控えめな赤アクセント
};

export function WarningBlock({ settings }: { settings: WarningSettings }) {
  if (!settings.body) return null;
  const tone = settings.tone ?? "spoiler";
  const accent = TONE_ACCENT[tone] ?? TONE_ACCENT.spoiler;
  return (
    <div
      className="bg-[color:var(--liff-surface-subtle)] border border-[color:var(--liff-border)] rounded-[10px] px-4 py-3 text-[14px] leading-[1.7] break-words text-[color:var(--liff-primary-text)]"
      // 左端 3px のアクセント線で tone を控えめに示す（色は既存トークン経由・hardcoded hex なし）。
      style={{ borderLeft: `3px solid ${accent}` }}
      role="note"
    >
      <p className="whitespace-pre-wrap">{settings.body}</p>
    </div>
  );
}
