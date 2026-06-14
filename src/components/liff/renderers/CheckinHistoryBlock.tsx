"use client";

// src/components/liff/renderers/CheckinHistoryBlock.tsx
//
// 「チェックイン履歴」ブロック — そのプレイヤー本人のチェックイン履歴を一覧表示する。
// 既存の location ページ種別と同じ API・ロジック（LocationHistoryRenderer の LocationHistoryList）を再利用する。
// workId / lineUserId / preview は LiffPlayerContext から取得する（他ブロックと同じ）。
// プレビュー / 未ログイン / 0 件 でも落ちず案内・空状態を表示する。
// X API / スクレイピングは使わない（自前のチェックイン記録のみ）。

import type { CheckinHistorySettings } from "@/types";
import { useLiffPlayerContext } from "../LiffPlayerContext";
import { LocationHistoryList } from "../LocationHistoryRenderer";

export function CheckinHistoryBlock({
  title,
  settings,
  preview,
}: {
  title?: string | null;
  settings: CheckinHistorySettings;
  preview?: boolean;
}) {
  const ctx = useLiffPlayerContext();
  const heading = settings.title?.trim() || title?.trim() || "";
  const isPreview = !!preview || !ctx || ctx.preview === true;
  const maxCount = settings.max_count && settings.max_count > 0 ? settings.max_count : undefined;

  return (
    <div>
      {heading && (
        <h3 className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2 break-words">
          {heading}
        </h3>
      )}
      {settings.description?.trim() && (
        <p className="text-[13px] leading-[1.7] text-[color:var(--liff-secondary-text)] whitespace-pre-wrap break-words mb-2">
          {settings.description}
        </p>
      )}
      <LocationHistoryList
        workId={ctx?.workId ?? ""}
        lineUserId={ctx?.lineUserId}
        preview={isPreview}
        maxCount={maxCount}
      />
    </div>
  );
}
