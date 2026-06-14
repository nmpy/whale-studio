"use client";

// src/components/liff/renderers/RiddleListBlock.tsx
//
// 「謎・問題」ブロック — そのプレイヤーが到達済みの謎・問題を一覧表示する。
// データは GET /api/liff/works/[workId]/puzzles?line_user_id=... から取得（現在フェーズの puzzle のみ）。
// 未到達の問題・他プレイヤーの履歴・ネタバレ(answer等)は API 側で除外済み。
// プレビュー / lineUserId 未取得 / 0件 でも落ちず案内表示にする。

import { useEffect, useState } from "react";
import type { RiddleListSettings } from "@/types";
import { useLiffPlayerContext } from "../LiffPlayerContext";

interface PuzzleItem {
  id:         string;
  body:       string;
  phase_name: string | null;
  status:     string;
}

export function RiddleListBlock({
  title,
  settings,
}: {
  title?: string | null;
  settings: RiddleListSettings;
}) {
  const ctx = useLiffPlayerContext();
  const [puzzles, setPuzzles] = useState<PuzzleItem[] | null>(null);

  const heading = settings.title?.trim() || title?.trim() || "謎・問題";
  // プレビュー / 未ログインは fetch せず案内表示（実機ログイン時のみ取得）。
  const isPreview = !ctx || ctx.preview === true || !ctx.lineUserId || !ctx.workId;

  useEffect(() => {
    if (isPreview || !ctx?.workId || !ctx?.lineUserId) return;
    let cancelled = false;
    fetch(`/api/liff/works/${ctx.workId}/puzzles?line_user_id=${encodeURIComponent(ctx.lineUserId)}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setPuzzles(Array.isArray(j?.data?.puzzles) ? j.data.puzzles : []); })
      .catch(() => { if (!cancelled) setPuzzles([]); });
    return () => { cancelled = true; };
  }, [isPreview, ctx?.workId, ctx?.lineUserId]);

  const limit = settings.max_count && settings.max_count > 0 ? settings.max_count : undefined;
  const shown = (puzzles ?? []).slice(0, limit);

  return (
    <div>
      {heading && (
        <h3 className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2 break-words">
          {heading}
        </h3>
      )}

      {isPreview ? (
        <p className="text-[13px] leading-[1.7] text-[color:var(--liff-tertiary-text,#8C8C8C)] py-2">
          プレイヤーが到達した謎・問題がここに一覧表示されます。
        </p>
      ) : puzzles === null ? (
        <p className="text-[13px] text-[color:var(--liff-tertiary-text,#8C8C8C)] py-2">読み込み中...</p>
      ) : shown.length === 0 ? (
        <p className="text-[14px] text-[color:var(--liff-tertiary-text,#8C8C8C)] text-center py-4">
          表示できる謎・問題はまだありません。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((p) => (
            <li
              key={p.id}
              className="rounded-[12px] border border-[#eef2f5] bg-[color:var(--liff-surface,#fff)] px-4 py-3"
            >
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {p.phase_name && (
                  <span className="text-[11px] text-[color:var(--liff-secondary-text)]">{p.phase_name}</span>
                )}
                {settings.show_status !== false && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#E0F2F1] text-[#0F766E]">
                    出題中
                  </span>
                )}
              </div>
              {p.body && (
                <p className="text-[14px] leading-[1.7] text-[color:var(--liff-primary-text)] whitespace-pre-wrap break-words">
                  {p.body}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
