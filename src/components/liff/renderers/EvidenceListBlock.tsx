"use client";

import type { EvidenceListSettings } from "@/types";

export interface Evidence {
  id: string;
  name: string;
  discovered: boolean;
}

export function EvidenceListBlock({
  title,
  settings,
  evidences,
}: {
  title?: string | null;
  settings: EvidenceListSettings;
  evidences: Evidence[];
}) {
  const filtered = settings.hide_undiscovered
    ? evidences.filter((e) => e.discovered)
    : evidences;
  const limited = filtered.slice(0, settings.max_display_count ?? 100);

  return (
    <div>
      {title && <h3 className="text-base font-semibold text-gray-900 mb-2">{title}</h3>}
      {limited.length === 0 ? (
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-400">
            {settings.empty_message || "まだ証拠はありません"}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {limited.map((ev) => (
            <li
              key={ev.id}
              className={`flex items-center gap-3 p-3 rounded-lg border ${
                ev.discovered ? "bg-white border-gray-200" : "bg-gray-50 border-gray-100"
              }`}
            >
              <span className="text-lg">{ev.discovered ? "🔓" : "🔒"}</span>
              <span className={`text-sm ${ev.discovered ? "text-gray-900" : "text-gray-400"}`}>
                {ev.discovered ? ev.name : "???"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
