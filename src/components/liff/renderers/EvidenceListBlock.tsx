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
      {title && (
        <h3 className="text-[16px] font-bold text-[color:var(--liff-primary-text)] mb-2 break-words">
          {title}
        </h3>
      )}
      {limited.length === 0 ? (
        <div className="bg-[color:var(--liff-background)] rounded-[12px] p-4 text-center">
          <p className="text-[14px] text-[color:var(--liff-tertiary-text)]">
            {settings.empty_message || "まだ証拠はありません"}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {limited.map((ev) => (
            <li
              key={ev.id}
              className={`flex items-center gap-3 p-3 rounded-[12px] border ${
                ev.discovered
                  ? "bg-[color:var(--liff-surface)] border-[color:var(--liff-border)]"
                  : "bg-[color:var(--liff-background)] border-[color:var(--liff-border)]"
              }`}
            >
              <span className="text-lg">{ev.discovered ? "🔓" : "🔒"}</span>
              <span
                className={`text-[15px] ${
                  ev.discovered
                    ? "text-[color:var(--liff-primary-text)]"
                    : "text-[color:var(--liff-tertiary-text)]"
                }`}
              >
                {ev.discovered ? ev.name : "???"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
