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
      {title && <h3 className="text-base font-semibold text-gray-900 mb-2">{title}</h3>}
      {limited.length === 0 ? (
        <div className="bg-amber-50 rounded-lg p-4 text-center">
          <p className="text-sm text-amber-700">
            {settings.empty_message || "ヒントはまだありません"}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {limited.map((hint, idx) => (
            <li key={hint.id} className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg">
              <span className="text-amber-500 font-bold text-sm shrink-0">
                ヒント{idx + 1}
              </span>
              <span className="text-sm text-gray-700">{hint.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
