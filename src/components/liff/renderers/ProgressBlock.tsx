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

  return (
    <div>
      {title && <h3 className="text-base font-semibold text-gray-900 mb-2">{title}</h3>}
      {settings.display_format === "text" ? (
        <p className="text-sm text-gray-700">
          {current} / {total} フェーズ完了
        </p>
      ) : (
        <div>
          <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: "#06C755" }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1 text-right">
            {settings.show_denominator !== false ? `${current} / ${total}` : `${pct}%`}
          </p>
        </div>
      )}
    </div>
  );
}
