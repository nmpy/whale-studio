"use client";

import type { ProgressSettings } from "@/types";

export function ProgressBlock({
  title,
  settings,
  current,
  total,
}: {
  title?: string | null;
  settings: ProgressSettings;
  current: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  // PR-BLK3: バー幅は 0〜100% に丸める（current>total / 異常値でもバーが溢れない・視覚安全）。
  const barPct = Math.min(100, Math.max(0, pct));

  return (
    <div>
      {title && (
        <h3 className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2 break-words">
          {title}
        </h3>
      )}
      {settings.display_format === "text" ? (
        <p className="text-[15px] leading-[1.6] text-[color:var(--liff-primary-text)]">
          {current} / {total} フェーズ完了
        </p>
      ) : (
        <div>
          <div className="bg-[color:var(--liff-border)] rounded-full h-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${barPct}%`, background: "var(--liff-line-green, #06C755)" }}
            />
          </div>
          <p className="text-[12px] text-[color:var(--liff-secondary-text)] mt-1 text-right">
            {settings.show_denominator !== false ? `${current} / ${total}` : `${pct}%`}
          </p>
        </div>
      )}
    </div>
  );
}
