"use client";

// src/components/liff/PuzzleRenderer.tsx
// LIFF「謎・問題」ページ（page_type="puzzle"）。
//
// 薄い renderer: 既存の `riddle_list` ブロック（RiddleListBlock）をページ本体として再利用するだけ。
//   - データ取得 / status / show_status / max_count / preview / spoiler-safe は RiddleListBlock 側に一任。
//   - ページ見出し（title / description）は LiffSinglePageRenderer のページヘッダーが担当するため、
//     ここでは重複表示しない。
//   - 新規 API fetch / 解答・ヒント・詳細・solved 集計 UI は持たない。
//
// player context（workId / lineUserId）は親 LiffSinglePageRenderer の LiffPlayerProvider が供給する。

import type { LiffPageConfigSettings, RiddleListSettings } from "@/types";
import { liffRootClass } from "./liff-style-helpers";
import { RiddleListBlock } from "./renderers/RiddleListBlock";

export interface PuzzleRendererConfig {
  work_title?:   string | null;
  title:         string | null;
  description:   string | null;
  settings_json: LiffPageConfigSettings;
}

export function PuzzleRenderer({ config }: { config: PuzzleRendererConfig; preview?: boolean }) {
  const settings = config.settings_json;
  // ページ設定 JSON を RiddleListSettings として渡す（title / max_count / show_status は任意・未設定は既定）。
  const riddleSettings = (settings ?? {}) as unknown as RiddleListSettings;

  return (
    <div className={`liff-font ${liffRootClass(settings)} min-h-screen bg-[color:var(--liff-background)] text-[color:var(--liff-primary-text)]`}>
      {/* ページ title / description は LiffSinglePageRenderer のページ見出し側で 1 度だけ表示する。 */}
      <main className="liff-player-main pt-5 pb-24">
        <RiddleListBlock title={null} settings={riddleSettings} />
      </main>
    </div>
  );
}
