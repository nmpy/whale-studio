"use client";

// src/components/liff/WerewolfRenderer.tsx
//
// 人狼 / 配役閲覧モード — Phase 1 の暫定 placeholder。
//
// Phase 1 のスコープ:
//   - pageType="werewolf" の LIFF ページが表示されたときに「準備中」案内を出すだけ
//   - 実機 LIFF / Studio プレビューの双方で同じ見た目で表示される
//
// Phase 2 で置き換える内容:
//   - プレイ予定タイトル一覧 (アコーディオン)
//   - QR `/liff/r/[token]` 経由の個別配役カード表示
//   - ゲーム開始状態に応じた gating
//
// ※ Phase 1 では DB に WerewolfTitle が登録されても、プレイヤー側には出さない。
//   GM が編集を進めている間 (Phase 2 リリース前) は「準備中」のままにする。

import type { LiffPageConfigSettings } from "@/types";
import { liffRootClass, liffDescriptionAlignClass } from "./liff-style-helpers";

export interface WerewolfRendererConfig {
  work_title?:   string | null;
  title:         string | null;
  description:   string | null;
  settings_json: LiffPageConfigSettings;
}

interface Props {
  config: WerewolfRendererConfig;
  preview?: boolean;
}

export function WerewolfRenderer({ config }: Props) {
  const settings = config.settings_json;

  return (
    <div className={`liff-font ${liffRootClass(settings)} bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
      <div className="liff-player-main pt-2 pb-8 flex flex-col gap-4">
        {config.description && (
          <p className={`text-[14px] leading-relaxed text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words ${liffDescriptionAlignClass(settings)}`}>
            {config.description}
          </p>
        )}

        {/* Phase 1 暫定 — Phase 2 で実装 */}
        <div className="bg-[color:var(--liff-surface)] border border-[color:var(--liff-border)] rounded-[12px] px-5 py-8 text-center">
          <p className="text-3xl mb-3" aria-hidden="true">🐺</p>
          <p className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2">
            配役閲覧モード
          </p>
          <p className="text-[14px] leading-[1.7] text-[color:var(--liff-secondary-text)]">
            このページは準備中です。
            <br />
            ゲーム当日に GM から配布される QR コードを<wbr />読み込んで配役を確認してください。
          </p>
        </div>
      </div>
    </div>
  );
}
