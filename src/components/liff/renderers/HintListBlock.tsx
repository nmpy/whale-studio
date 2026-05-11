"use client";

import type { HintListSettings } from "@/types";

export interface Hint {
  id: string;
  text: string;
}

export function HintListBlock({
  title,
  settings,
  hints,
}: {
  title?: string | null;
  settings: HintListSettings;
  hints: Hint[];
}) {
  const limited = hints.slice(0, settings.max_display_count ?? 100);

  return (
    <div>
      {title && (
        <h3 className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2 break-words">
          {title}
        </h3>
      )}
      {limited.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-[12px] p-4 text-center">
          <p className="text-[14px] text-amber-800">
            {settings.empty_message || "ヒントはまだありません"}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {limited.map((hint, idx) => (
            <li key={hint.id} className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-[12px]">
              <span className="text-amber-700 font-bold text-[13px] shrink-0">
                ヒント{idx + 1}
              </span>
              <span className="text-[15px] leading-[1.6] text-[color:var(--liff-primary-text)]">{hint.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
